import { t as tr } from '../services/i18nService.js';
import ApiKeyManager from './apiKeyManager.js';
import Logger from './Logger.js';
import { musicTools } from '../schema/musicTools.js';
import { devTools } from '../schema/devTools.js';
import * as MusicFunctions from '../utils/musicFunctions.js';
import * as DevFunctions from '../utils/devFunctions.js';
import * as ChatHelper from '../helpers/chatHelper.js';
import { loadSystemPrompt } from '../helpers/promptHelper.js';
import { poru } from '../utils/LavalinkManager.js';
import MusicSetting from '../models/MusicSetting.js';
import MusicLog from '../models/MusicLog.js';
import geminiModelService from '../services/geminiModelService.js';

class GeminiManager {
    constructor() {
        this.logger = {
            info: (msg) => Logger.info(tr('logs.geminimanager.info_gemini', { msg: msg })),
            warn: (msg) => Logger.warn(tr('logs.geminimanager.warn_gemini', { msg: msg })),
            error: (msg) => Logger.error(tr('logs.geminimanager.error_gemini', { msg: msg })),
            log: (msg) => Logger.info(tr('logs.geminimanager.info_gemini', { msg: msg }))
        };
        // Tools definition
        this.tools = [{ functionDeclarations: [...musicTools, ...devTools] }];

        // Function mapping
        this.functions = {
            'play_music': MusicFunctions.play_music,
            'control_playback': MusicFunctions.control_playback,
            'adjust_audio_settings': MusicFunctions.adjust_audio_settings,
            'manage_radio': MusicFunctions.manage_radio,
            'show_music_panel': MusicFunctions.show_music_panel,
            'agent_code': DevFunctions.agent_code,
            'web_search': DevFunctions.web_search
        };
    }


    async chat(message) {
        const context = {
            guild: message.guild,
            channel: message.channel,
            user: message.author,
            message: message
        };

        const userId = message.author.id;
        const channelId = message.channel.id;
        const guildId = message.guild?.id;
        const displayName = message.member?.displayName || message.author.globalName || message.author.username || 'User';

        // 1. Get Session & History (Ngữ cảnh phòng chat nhóm chung - Multi-participant Channel Session theo chuẩn Google AI Studio)
        const chatSession = await ChatHelper.getChatSession(channelId, userId);
        const baseHistory = await ChatHelper.getHistory(userId, chatSession);

        // 2. Add Current User Message with Speaker Prefix ([DisplayName]: content)
        let fullUserText = message.cleanContent || '';

        // ── Thu thập attachment từ tin nhắn hiện tại + tin nhắn được reply ──
        let allAttachments = [...(message.attachments?.values() || [])];
        const hasImageInCurrent = allAttachments.some(a => /^image\//i.test(a.contentType || ''));
        if (!hasImageInCurrent && message.reference?.messageId) {
            try {
                const referenced = await message.channel.messages.fetch(message.reference.messageId);
                if (referenced?.attachments?.size > 0) {
                    allAttachments.push(...referenced.attachments.values());
                }
            } catch (_) { /* tin nhắn gốc đã bị xóa hoặc không truy cập được */ }
        }

        // ── Xử lý file text đính kèm (code/text) ──
        const attachedFileTexts = [];
        for (const att of allAttachments) {
            if (/\.(js|bak|txt|json|py|md|ts|html|css)$/i.test(att.name)) {
                try {
                    const res = await fetch(att.url);
                    if (res.ok) {
                        const fileContent = await res.text();
                        attachedFileTexts.push(`[Tệp đính kèm: ${att.name}]\n\`\`\`javascript\n${fileContent}\n\`\`\``);
                    }
                } catch (attErr) {
                    console.error(tr('logs.geminimanager.error_khong_the_doc_file_dinh_kem'), attErr.message);
                }
            }
        }
        if (attachedFileTexts.length > 0) {
            fullUserText = `${fullUserText}\n\n${attachedFileTexts.join('\n\n')}`.trim();
        }

        // ── Xử lý ảnh: tải từ Discord CDN → base64 → inlineData cho Gemini Vision ──
        const imageParts = [];
        const MAX_VISION_BYTES = 8 * 1024 * 1024; // 8 MB tổng cho ảnh mỗi lượt
        let visionBytes = 0;
        for (const att of allAttachments) {
            const mime = (att.contentType || '').split(';')[0].trim();
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) continue;
            if (visionBytes >= MAX_VISION_BYTES) break;
            try {
                const res = await fetch(att.url);
                if (!res.ok) continue;
                const arrayBuffer = await res.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                if (buffer.length + visionBytes > MAX_VISION_BYTES) continue;
                visionBytes += buffer.length;
                imageParts.push({ inlineData: { mimeType: mime, data: buffer.toString('base64') } });
                fullUserText += `\n[Ảnh đính kèm: ${att.name}; loại: ${mime}]`;
                this.logger.info(tr('logs.geminimanager.info_vision_image_loaded', { name: att.name, size: Math.round(buffer.length / 1024) }));
            } catch (imgErr) {
                this.logger.warn(tr('logs.geminimanager.warn_vision_image_failed', { name: att.name, error: imgErr.message }));
            }
        }

        // ── Tách turn: persistedUserTurn (lưu DB, không chứa ảnh) vs requestUserTurn (gửi Gemini, có ảnh) ──
        const persistedUserTurn = {
            role: 'user',
            parts: [{ text: `[${displayName}]: ${fullUserText}` }],
            authorId: userId,
            authorName: displayName
        };
        const requestParts = [{ text: `[${displayName}]: ${fullUserText}` }, ...imageParts];
        const requestUserTurn = {
            role: 'user',
            parts: requestParts,
            authorId: userId,
            authorName: displayName
        };

        // 3. Prepare Music Data for Context
        let musicStatus = "Đang rảnh rỗi (Chưa vào voice)";
        let currentTrack = "Không có";
        let queuePreview = "Trống";
        let volume = 100;
        let loopMode = "Off";
        let radioMode = "???";

        if (guildId) {
            const player = poru?.players?.get(guildId);
            const settings = await MusicSetting.findOne({ guildId });

            if (settings) {
                volume = settings.volume; // Default volume from DB
                // radioMode = settings.radioEnabled ? "On" : "Off"; (If you have this field)
            }

            if (player) {
                // Volume from active player is more accurate
                volume = player.volume;

                if (player.isPlaying) musicStatus = "Đang phát nhạc";
                else if (player.isPaused) musicStatus = "Đang tạm dừng";
                else musicStatus = "Đang chờ (Idle)";

                if (player.currentTrack) {
                    const info = player.currentTrack.info;
                    currentTrack = `[${info.title}](${info.uri}) - ${info.author}`;
                }

                // Queue Preview (First 3 songs)
                if (player.queue.length > 0) {
                    queuePreview = player.queue.slice(0, 3)
                        .map((track, i) => `${i + 1}. ${track.info.title}`)
                        .join('\n');
                    if (player.queue.length > 3) queuePreview += `\n... và ${player.queue.length - 3} bài nữa`;
                }

                // Loop State
                if (player.loop === 'TRACK') loopMode = "Loop track (1 bài)";
                else if (player.loop === 'QUEUE') loopMode = "Loop queue (Toàn bộ)";
            }
        }

        // 3b. Prepare User History (Music Habits)
        let listeningHistorySummary = "Chưa có dữ liệu lịch sử nghe nhạc.";
        try {
            // Get last 50 songs requested by this user
            const logs = await MusicLog.find({ requesterId: userId })
                .sort({ playedAt: -1 })
                .limit(50)
                .lean();

            if (logs.length > 0) {
                // Find Top 3 Songs & Artists
                const songCounts = {};
                const artistCounts = {};
                const hourCounts = {}; // For time habit

                logs.forEach(log => {
                    // Song
                    songCounts[log.trackTitle] = (songCounts[log.trackTitle] || 0) + 1;
                    // Artist (if available)
                    if (log.trackAuthor) {
                        artistCounts[log.trackAuthor] = (artistCounts[log.trackAuthor] || 0) + 1;
                    }
                    // Time habit
                    if (log.playedAt) {
                        const hour = new Date(log.playedAt).getHours();
                        let timeRange = "Ban ngày";
                        if (hour >= 5 && hour < 12) timeRange = "Buổi sáng";
                        else if (hour >= 12 && hour < 18) timeRange = "Buổi chiều";
                        else if (hour >= 18 && hour < 23) timeRange = "Buổi tối";
                        else timeRange = "Đêm khuya";
                        hourCounts[timeRange] = (hourCounts[timeRange] || 0) + 1;
                    }
                });

                const sortedSongs = Object.entries(songCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
                const sortedArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
                const topTime = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];

                const topSongsStr = sortedSongs.map(s => `- ${s[0]} (${s[1]} lần)`).join('\n');
                const topArtistsStr = sortedArtists.map(s => `${s[0]}`).join(', ');
                const habitStr = topTime ? `Thường nghe nhạc vào: ${topTime[0]}` : "";

                listeningHistorySummary = `
- **Thói quen:** ${habitStr}
- **Nghệ sĩ yêu thích:** ${topArtistsStr || "Chưa rõ"}
- **Bài hát nghe nhiều nhất:**
${topSongsStr || "- Chưa có bài nào nổi bật"}
`;
            }
        } catch (err) {
            console.error(tr('logs.geminimanager.error_error_fetching_musiclog'), err);
            listeningHistorySummary = "Không thể lấy dữ liệu lịch sử lúc này.";
        }


        // 3c. Prepare Available Commands & Sandbox Features
        let availableFeaturesSummary = "Chưa có danh sách lệnh.";
        const client = message.client || message.channel?.client || message.guild?.client;
        if (client?.commands?.size > 0) {
            const features = [];
            for (const [name, cmd] of client.commands.entries()) {
                const desc = cmd.data?.description || 'Tính năng';
                const tag = cmd.isSandbox ? '[Sandbox Feature]' : '[Hệ thống]';
                features.push(`- /${name} (${tag}): ${desc}`);
            }
            availableFeaturesSummary = features.join('\n');
        }

        // 4. Prepare System Prompt Replacements
        const replacements = {
            '{{user}}': message.member?.displayName || message.author.globalName || message.author.username || 'User',
            '{{user_name}}': message.member?.displayName || message.author.username || 'User',
            '{{user_id}}': userId,
            '{{server_name}}': message.guild?.name || 'DM',
            '{{guild_name}}': message.guild?.name || 'Direct Message',
            '{{channel_name}}': message.channel.name || 'Private Chat',
            '{{current_time}}': new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
            '{{time}}': new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), // Alias
            '{{bot_name}}': message.client?.user?.username || 'Dolia',

            // Music Context
            '{{music_status}}': musicStatus,
            '{{current_track}}': currentTrack,
            '{{queue_preview}}': queuePreview,
            '{{volume}}': volume,
            '{{loop_mode}}': loopMode,
            '{{radio_mode}}': radioMode,
            '{{listening_history_summary}}': listeningHistorySummary,

            // Available Commands & Sandbox Features
            '{{available_features}}': availableFeaturesSummary
        };

        const systemInstruction = loadSystemPrompt(replacements);

        const candidates = await geminiModelService.getCandidateModels('flash-lite');
        let lastError = null;

        for (const modelId of candidates) {
            try {
                // Tạo bản sao độc lập cho turn hiện tại và danh sách newTurns
                const contents = [...baseHistory.map(h => ({ role: h.role, parts: [...h.parts] })), requestUserTurn];
                const newTurns = [persistedUserTurn];

                let functionCallAttempts = 0;
                let finalResponseText = null;
                let preCallText = null;
                let lastToolResult = null;
                let attachedFiles = [];
                let alreadySentToChannel = false;

                // Loop for Function Calling (Max 5 turns)
                while (functionCallAttempts < 5) {
                    const response = await ApiKeyManager.execute(modelId, async (key) => {
                        const ai = ApiKeyManager.getClient(key);
                        return await ai.models.generateContent({
                            model: modelId,
                            contents: contents,
                            config: {
                                tools: this.tools,
                                systemInstruction: systemInstruction,
                                temperature: 0.7,
                                topK: 40,
                                topP: 0.95
                            }
                        });
                    }, { timeoutMs: 35000 });

                    const candidate = response.candidates?.[0];
                    const content = candidate?.content;
                    const responseParts = content?.parts || [];

                    // Lấy text không phải thought từ turn này nếu có
                    const textParts = responseParts
                        .filter(p => p.text && !p.thought)
                        .map(p => p.text)
                        .join('\n')
                        .trim();

                    const hasFunctionCall = responseParts.some(p => p.functionCall);

                    if (hasFunctionCall) {
                        if (textParts) {
                            preCallText = textParts;
                        }

                        const callNames = responseParts
                            .filter(p => p.functionCall)
                            .map(p => p.functionCall.name)
                            .join(', ');

                        this.logger.info(tr('logs.geminimanager.info_function_calls_detected', { callNames: callNames }));

                        // A. Save Model Call Turn
                        const modelCallTurn = {
                            role: 'model',
                            parts: responseParts
                        };
                        contents.push(modelCallTurn);
                        newTurns.push(modelCallTurn);

                        // B. Execute Functions & Prepare Response
                        const functionResponseParts = [];

                        for (const part of responseParts) {
                            if (part.functionCall) {
                                const call = part.functionCall;
                                const fn = this.functions[call.name];
                                let apiResponse;

                                if (fn) {
                                    try {
                                        const args = { ...call.args, ...context };
                                        const result = await fn(args);
                                        apiResponse = { result: result };
                                        lastToolResult = result;
                                    } catch (error) {
                                        apiResponse = { error: error.message };
                                        console.error(tr('logs.geminimanager.error_error_executing', { name: call.name }), error);
                                    }
                                } else {
                                    apiResponse = { error: `Function ${call.name} not found` };
                                }

                                // IMPORTANT: Include 'id' in functionResponse
                                functionResponseParts.push({
                                    functionResponse: {
                                        name: call.name,
                                        response: apiResponse,
                                        id: call.id
                                    }
                                });
                            }
                        }

                        // C. Save User Response Turn
                        const functionResponseTurn = {
                            role: 'user',
                            parts: functionResponseParts
                        };
                        contents.push(functionResponseTurn);
                        newTurns.push(functionResponseTurn);

                        // D. TỐI ƯU HÓA 2-REQUEST: Bỏ qua Request 3 nếu Agent đã thực thi xong và có phản hồi Persona hoàn chỉnh
                        const hasAgentCall = responseParts.some(p => p.functionCall?.name === 'agent_code');
                        if (hasAgentCall && lastToolResult) {
                            let agentReplyText = null;
                            let agentFiles = [];
                            let alreadySent = false;

                            if (typeof lastToolResult === 'string') {
                                try {
                                    const parsed = JSON.parse(lastToolResult);
                                    agentReplyText = parsed.reply || parsed.message || parsed.description || parsed.summary || parsed.status || null;
                                    if (Array.isArray(parsed.files)) agentFiles = parsed.files;
                                    else if (parsed.data?.video) agentFiles = [parsed.data.video];
                                    alreadySent = !!parsed.alreadySent;
                                } catch (_) {
                                    agentReplyText = lastToolResult;
                                }
                            } else if (typeof lastToolResult === 'object') {
                                agentReplyText = lastToolResult.reply || lastToolResult.message || lastToolResult.description || lastToolResult.summary || lastToolResult.status || null;
                                if (Array.isArray(lastToolResult.files)) agentFiles = lastToolResult.files;
                                else if (lastToolResult.data?.video) agentFiles = [lastToolResult.data.video];
                                alreadySent = !!lastToolResult.alreadySent;
                            }

                            if (agentFiles.length > 0) attachedFiles = agentFiles;
                            if (alreadySent) alreadySentToChannel = true;

                            if ((agentReplyText && typeof agentReplyText === 'string' && agentReplyText.trim()) || agentFiles.length > 0 || alreadySent) {
                                this.logger.info(tr('logs.geminimanager.info_geminimanager_toi_uu_2_request_tra_ve'));
                                finalResponseText = (typeof agentReplyText === 'string') ? agentReplyText : "";
                                break;
                            }
                        }

                    } else {
                        // No function call -> Final Text Response
                        finalResponseText = textParts || response.text || "";
                        break;
                    }
                    functionCallAttempts++;
                }

                // Fallback thông minh: Nếu sau khi gọi tool mà model không sinh thêm text mới
                if (!finalResponseText || typeof finalResponseText !== 'string' || !finalResponseText.trim()) {
                    if (preCallText) {
                        finalResponseText = preCallText;
                    } else if (lastToolResult) {
                        if (typeof lastToolResult === 'string') {
                            try {
                                const parsed = JSON.parse(lastToolResult);
                                finalResponseText = parsed.reply || parsed.summary || parsed.message || parsed.description || lastToolResult;
                            } catch (_) {
                                finalResponseText = lastToolResult;
                            }
                        } else if (typeof lastToolResult === 'object') {
                            finalResponseText = lastToolResult.reply || lastToolResult.summary || lastToolResult.message || JSON.stringify(lastToolResult);
                        }
                    } else {
                        finalResponseText = tr('messages.geminimanager.text_dolia_da_ghi_nhan_va_xu_ly');
                    }
                }

                if (typeof finalResponseText !== 'string') {
                    finalResponseText = String(finalResponseText);
                }

                // Lọc bỏ các thông số nội bộ và tên file không mong muốn khỏi lời nhắn của Dolia
                finalResponseText = finalResponseText
                    .replace(/[-*•]?\s*(?:Đầu ra|Output|File output|Tên file):\s*[^\n\r]+/gi, '')
                    .replace(/\b[a-zA-Z0-9_\-\\\/]+(?:\/|\\)[a-zA-Z0-9_\-]+\.(mp4|avi|mov|mkv|webm|png|jpg|jpeg|gif|json|py|js)\b/gi, '')
                    .replace(/\b[a-zA-Z0-9_\-]*\.(mp4|avi|mov|mkv|webm)\b/gi, '')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();

                if (!finalResponseText) {
                    finalResponseText = tr('messages.geminimanager.text_tada_dolia_da_hoan_thanh_xong_tac');
                }

                // Lưu text phản hồi cuối cùng vào DB
                newTurns.push({
                    role: 'model',
                    parts: [{ text: finalResponseText }]
                });

                // 4. Save new turns to DB
                if (newTurns.length > 0) {
                    await ChatHelper.saveInteraction(chatSession, newTurns, { id: userId, name: displayName });
                }

                // Model phản hồi thành công -> gỡ cooldown nếu có và return
                geminiModelService.reportModelSuccess(modelId);
                if (attachedFiles.length > 0 || alreadySentToChannel) {
                    return {
                        reply: finalResponseText,
                        files: attachedFiles,
                        alreadySent: alreadySentToChannel
                    };
                }
                return finalResponseText;

            } catch (err) {
                lastError = err;
                geminiModelService.reportModelFailure(modelId, err.message, 2 * 60 * 1000);
                this.logger.warn(tr('logs.geminimanager.warn_model_gap_su_co_dang_thu_model', { modelId: modelId, message: err.message }));
            }
        }

        throw lastError || new Error('Tất cả các model Gemini đều không khả dụng lúc này.');
    }
}

export default new GeminiManager();