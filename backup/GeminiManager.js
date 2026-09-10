import { GoogleGenAI } from '@google/genai';
import ApiKeyManager from './apiKeyManager.js';
import Logger from './Logger.js';
import { musicTools } from '../schema/musicTools.js';
import * as MusicFunctions from '../utils/musicFunctions.js';
import * as ChatHelper from '../helpers/chatHelper.js';
import { loadSystemPrompt } from '../helpers/promptHelper.js';
import { poru } from '../utils/LavalinkManager.js';
import MusicSetting from '../models/MusicSetting.js';
import MusicLog from '../models/MusicLog.js';

class GeminiManager {
    constructor() {
        this.logger = {
            info: (msg) => Logger.info(`[Gemini] ${msg}`),
            warn: (msg) => Logger.warn(`[Gemini] ${msg}`),
            error: (msg) => Logger.error(`[Gemini] ${msg}`),
            log: (msg) => Logger.info(`[Gemini] ${msg}`)
        };
        this.modelId = 'gemini-3-flash-preview';

        // Tools definition (Direct array for Interactions API)
        this.tools = musicTools;

        // Function mapping
        this.functions = {
            'play_music': MusicFunctions.play_music,
            'control_playback': MusicFunctions.control_playback,
            'adjust_audio_settings': MusicFunctions.adjust_audio_settings,
            'manage_radio': MusicFunctions.manage_radio,
            'show_music_panel': MusicFunctions.show_music_panel
        };
    }

    async chat(message) {
        const context = {
            guild: message.guild,
            channel: message.channel,
            user: message.author
        };

        const userId = message.author.id;
        const channelId = message.channel.id;
        const guildId = message.guild?.id;

        // 1. Get Session (Only for ID)
        const chatSession = await ChatHelper.getChatSession(userId, channelId);

        // Note: usage of ChatHelper.getHistory is REMOVED for API call.
        // We rely entirely on chatSession.lastInteractionId for context.

        // 2. Prepare Music Data for Context (System Prompt Injection)
        let musicStatus = "Đang rảnh rỗi (Chưa vào voice)";
        let currentTrack = "Không có";
        let queuePreview = "Trống";
        let volume = 100;
        let loopMode = "Off";
        let radioMode = "???";

        if (guildId) {
            const player = poru.players.get(guildId);
            const settings = await MusicSetting.findOne({ guildId });

            if (settings) {
                volume = settings.volume;
            }

            if (player) {
                volume = player.volume;

                if (player.isPlaying) musicStatus = "Đang phát nhạc";
                else if (player.isPaused) musicStatus = "Đang tạm dừng";
                else musicStatus = "Đang chờ (Idle)";

                if (player.currentTrack) {
                    const info = player.currentTrack.info;
                    currentTrack = `[${info.title}](${info.uri}) - ${info.author}`;
                }

                if (player.queue.length > 0) {
                    queuePreview = player.queue.slice(0, 3)
                        .map((track, i) => `${i + 1}. ${track.info.title}`)
                        .join('\n');
                    if (player.queue.length > 3) queuePreview += `\n... và ${player.queue.length - 3} bài nữa`;
                }

                if (player.loop === 'TRACK') loopMode = "Loop track (1 bài)";
                else if (player.loop === 'QUEUE') loopMode = "Loop queue (Toàn bộ)";
            }
        }

        // 3. Prepare User History (Music Habits) - For System Prompt
        let listeningHistorySummary = "Chưa có dữ liệu lịch sử nghe nhạc.";
        try {
            const logs = await MusicLog.find({ requesterId: userId })
                .sort({ playedAt: -1 })
                .limit(50)
                .lean();

            if (logs.length > 0) {
                const songCounts = {};
                const artistCounts = {};
                const hourCounts = {};

                logs.forEach(log => {
                    songCounts[log.trackTitle] = (songCounts[log.trackTitle] || 0) + 1;
                    if (log.trackAuthor) {
                        artistCounts[log.trackAuthor] = (artistCounts[log.trackAuthor] || 0) + 1;
                    }
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
            console.error("Error fetching MusicLog:", err);
            listeningHistorySummary = "Không thể lấy dữ liệu lịch sử lúc này.";
        }


        // 4. Prepare System Prompt
        const replacements = {
            '{{user}}': message.member?.displayName || message.author.globalName || message.author.username || 'User',
            '{{user_name}}': message.member?.displayName || message.author.username || 'User',
            '{{user_id}}': userId,
            '{{server_name}}': message.guild?.name || 'DM',
            '{{guild_name}}': message.guild?.name || 'Direct Message',
            '{{channel_name}}': message.channel.name || 'Private Chat',
            '{{current_time}}': new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
            '{{time}}': new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
            '{{bot_name}}': message.client.user.username || 'Dolia',
            '{{music_status}}': musicStatus,
            '{{current_track}}': currentTrack,
            '{{queue_preview}}': queuePreview,
            '{{volume}}': volume,
            '{{loop_mode}}': loopMode,
            '{{radio_mode}}': radioMode,
            '{{listening_history_summary}}': listeningHistorySummary
        };

        const systemInstruction = loadSystemPrompt(replacements);

        // --- INTERACTIONS API EXECUTION ---
        return await ApiKeyManager.execute(this.modelId, async (key) => {
            const client = new GoogleGenAI({ apiKey: key });

            let finalResponseText = null;
            let currentInteractionId = chatSession.lastInteractionId;
            let currentInput = message.cleanContent; // First turn input is just text
            let shouldContinue = true;
            let loopCount = 0;

            this.logger.info(`Starting Chat... (PrevID: ${currentInteractionId ? currentInteractionId : 'New Session'})`);

            while (shouldContinue && loopCount < 5) {
                const requestDetail = {
                    model: this.modelId,
                    input: currentInput,
                    tools: this.tools,
                    system_instruction: systemInstruction, // Top level, snake_case as per Beta docs
                    generation_config: {
                        temperature: 1.5,
                        top_p: 0.95
                    }
                };

                if (currentInteractionId) {
                    requestDetail.previous_interaction_id = currentInteractionId;
                }

                let interaction;
                try {
                    interaction = await client.interactions.create(requestDetail);
                } catch (err) {
                    // Check for invalid interaction ID error
                    // Check for invalid interaction ID or invalid turn order (400)
                    if (
                        err.message?.includes('Found no interaction with id') ||
                        err.message?.includes('invalid_request') ||
                        err.status === 404 || err.code === 404 ||
                        err.status === 400 || err.code === 400
                    ) {
                        this.logger.warn(`⚠️ Interaction ${currentInteractionId} expired/invalid. Restarting new session.`);
                        delete requestDetail.previous_interaction_id;
                        currentInteractionId = null;
                        // Reset input to original message if we are restarting
                        requestDetail.input = message.cleanContent;
                        interaction = await client.interactions.create(requestDetail);
                    } else {
                        throw err;
                    }
                }

                // Update ID for next turn and storage
                currentInteractionId = interaction.id;

                // Process Outputs
                let functionCalls = [];
                let textResponse = "";

                if (interaction.outputs) {
                    for (const output of interaction.outputs) {
                        if (output.type === 'function_call') {
                            functionCalls.push(output);
                        } else if (output.type === 'text') {
                            textResponse += output.text;
                        }
                    }
                }

                if (functionCalls.length > 0) {
                    this.logger.info(`Detected ${functionCalls.length} function call(s).`);

                    // Execute all calls and prepare results for NEXT turn
                    const resultInputs = [];

                    for (const call of functionCalls) {
                        const callName = call.name;
                        const args = call.arguments;
                        const callId = call.id;

                        this.logger.info(`Using Tool: ${callName}`);

                        const fn = this.functions[callName];
                        let apiResponse;

                        if (fn) {
                            try {
                                const fnArgs = { ...args, ...context };
                                const result = await fn(fnArgs);
                                apiResponse = { result: result };
                            } catch (error) {
                                console.error(`Error executing ${callName}:`, error);
                                apiResponse = { error: error.message };
                            }
                        } else {
                            apiResponse = { error: `Function ${callName} not found` };
                        }

                        resultInputs.push({
                            type: 'function_result',
                            name: callName,
                            call_id: callId,
                            result: apiResponse
                        });
                    }

                    // Prepare next loop with function results
                    currentInput = resultInputs;
                    shouldContinue = true;
                    loopCount++;
                } else {
                    // Final text response
                    finalResponseText = textResponse;
                    shouldContinue = false;
                }
            }

            // Save the valid Interaction ID for next time
            if (currentInteractionId) {
                await ChatHelper.saveLastInteractionId(chatSession, currentInteractionId);
            }

            // Save Local History (Optional: for user viewing only, NOT used for context next time)
            if (finalResponseText) {
                const manualTurns = [
                    { role: 'user', parts: [{ text: message.cleanContent }] },
                    { role: 'model', parts: [{ text: finalResponseText }] }
                ];
                await ChatHelper.saveInteraction(chatSession, manualTurns);
            }

            return finalResponseText;
        });
    }
}

export default new GeminiManager();
