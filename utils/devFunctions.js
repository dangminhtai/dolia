import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { SelfDevService } from '../services/selfDevService.js';
import Logger from '../class/Logger.js';
import ApiKeyManager from '../class/apiKeyManager.js';
import geminiModelService from '../services/geminiModelService.js';

/**
 * Khởi chạy một Slash Command trực tiếp từ tin nhắn văn bản mà người dùng không cần gõ /
 */
export async function executeCommandFromMessage(cmdName, message, client) {
    if (!client) client = message?.client || message?.channel?.client || message?.guild?.client;
    if (!client?.commands) {
        return { success: false, message: 'Danh sách lệnh chưa sẵn sàng.' };
    }

    const cleanInput = (cmdName || '').trim().toLowerCase().replace(/^\//, '');
    let command = client.commands.get(cleanInput);

    if (!command) {
        // Tìm kiếm theo tên hoặc theo từ khóa trong tên / mô tả của lệnh đã đăng ký
        for (const [name, cmd] of client.commands.entries()) {
            const desc = (cmd.data?.description || '').toLowerCase();
            const nameLower = name.toLowerCase();

            // Khớp chính xác hoặc tương đối giữa cleanInput và tên lệnh
            if (nameLower.includes(cleanInput) || cleanInput.includes(nameLower)) {
                command = cmd;
                break;
            }
            // Khớp với mô tả của lệnh
            if (desc && (desc.includes(cleanInput) || cleanInput.includes(desc))) {
                command = cmd;
                break;
            }
        }
    }

    if (!command) {
        return { success: false, message: `Không tìm thấy trò chơi hoặc lệnh "${cmdName}" trong hệ thống.` };
    }

    try {
        Logger.info(`[DevFunctions] 🎮 Đang thực thi lệnh /${command.data.name} cho user ${message.author?.id} (${message.author?.username})...`);

        let sentMsg = null;
        const fakeInteraction = {
            user: message.author,
            member: message.member,
            guild: message.guild,
            channel: message.channel,
            channelId: message.channel.id,
            guildId: message.guild?.id,
            client: client,
            commandName: command.data.name,
            deferred: false,
            replied: false,
            options: {
                getString: (name) => {
                    const optDef = command.data?.options?.find?.(o => o.name === name);
                    if (optDef?.choices?.length > 0) {
                        return optDef.choices[0].value;
                    }
                    return '';
                },
                getInteger: () => 1,
                getNumber: () => 1,
                getBoolean: () => true,
                getUser: () => null,
                getMember: () => null,
                getChannel: () => message.channel,
                getRole: () => null,
            },
            deferReply: async () => {
                fakeInteraction.deferred = true;
            },
            reply: async (payload) => {
                fakeInteraction.replied = true;
                if (typeof payload === 'string') payload = { content: payload };
                sentMsg = await message.reply(payload);
                return sentMsg;
            },
            editReply: async (payload) => {
                if (typeof payload === 'string') payload = { content: payload };
                if (sentMsg) {
                    return await sentMsg.edit(payload);
                } else {
                    sentMsg = await message.reply(payload);
                    return sentMsg;
                }
            },
            followUp: async (payload) => {
                if (typeof payload === 'string') payload = { content: payload };
                return await message.channel.send(payload);
            }
        };

        await command.execute(fakeInteraction);
        return { 
            success: true, 
            commandName: command.data.name, 
            message: `Trò chơi /${command.data.name} đã được khởi chạy thành công ngay tại kênh chat!` 
        };
    } catch (err) {
        Logger.error(`[DevFunctions] Lỗi khi chạy lệnh /${command.data.name}:`, err);
        return { success: false, error: err.message };
    }
}

/**
 * Xử lý Function Calling 'agent_code' từ Gemini
 */
export async function agent_code(args) {
    const { prompt, feature_name, action, user, channel, guild, message } = args;

    Logger.info(`[DevFunctions] agent_code tool invoked by user ${user?.id} (${user?.username}): action="${action}", prompt="${prompt}", feature_name="${feature_name}"`);

    const client = channel?.client || guild?.client || message?.client;
    const lowerAction = (action || '').toLowerCase();

    // 0. Xử lý kịch bản khởi chạy trực tiếp một lệnh/trò chơi đã có sẵn ra kênh chat (run_feature)
    const isRunFeature = lowerAction === 'run_feature' || 
                         lowerAction === 'execute_feature' || 
                         lowerAction === 'launch_game';

    if (isRunFeature) {
        const targetCmd = feature_name || prompt;
        Logger.info(`[DevFunctions] 🎮 Yêu cầu khởi chạy tính năng/game: "${targetCmd}"...`);
        const runResult = await executeCommandFromMessage(targetCmd, message, client);
        return JSON.stringify(runResult);
    }

    // 1. Xử lý kịch bản kiểm tra/truy vấn ngầm bằng script trong Sandbox (Dynamic Inspection & Modification Script)
    const isScript = lowerAction === 'create_script' || 
                     lowerAction === 'modify_script' ||
                     lowerAction === 'edit_script' ||
                     lowerAction === 'inspect_data';

    if (isScript) {
        Logger.info(`[DevFunctions] 🔍 Chạy script ngầm trong sandbox (action: "${lowerAction}"): "${prompt}"...`);

        // Gửi tin nhắn tiến trình chờ sự kiện thời gian thực (tin nhắn ngắn hạn, tự ẩn sau khi hoàn tất hoặc bấm nút ẩn)
        let statusMsg = null;
        let progressInterval = null;
        let collector = null;
        const startTime = Date.now();

        let currentStage = 'init';
        let currentStageDescription = '💭 Dolia đang lên kịch bản và chuẩn bị dữ liệu...';

        const stageColors = {
            init: 0x5DADE2,       // xanh dương nhạt
            thinking: 0x9B59B6,   // tím (suy nghĩ)
            coding: 0xE67E22,     // cam (viết code)
            packages: 0xF39C12,   // vàng cam (chuẩn bị thư viện)
            executing: 0x3498DB,  // xanh dương đậm (thực thi sandbox)
            completed: 0x2ECC71,  // xanh lá (hoàn thành)
            failed: 0xE74C3C,     // đỏ (lỗi)
        };

        const createWaitEmbed = (elapsed, stage, desc) => {
            return new EmbedBuilder()
                .setColor(stageColors[stage] || 0x5DADE2)
                .setTitle('✨ Dolia đang thực hiện yêu cầu của bạn nè... 🫧')
                .setDescription(
                    `⏳ **Thời gian:** ${elapsed} giây...\n` +
                    `💭 **Trạng thái:** ${desc}\n\n` +
                    `*(Bạn đợi mình một xíu nha, mình đang thực hiện ngay đây nè~ 💖)*`
                )
                .setTimestamp();
        };

        const dismissBtnId = `dismiss_wait_${Date.now()}`;
        const dismissRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(dismissBtnId)
                .setLabel('Ẩn thông báo')
                .setEmoji('🗑️')
                .setStyle(ButtonStyle.Secondary)
        );

        try {
            if (message && typeof message.reply === 'function') {
                statusMsg = await message.reply({
                    embeds: [createWaitEmbed(0, currentStage, currentStageDescription)],
                    components: [dismissRow]
                }).catch(() => null);
            }
            if (!statusMsg && channel && typeof channel.send === 'function') {
                statusMsg = await channel.send({
                    embeds: [createWaitEmbed(0, currentStage, currentStageDescription)],
                    components: [dismissRow]
                }).catch(() => null);
            }
        } catch (e) {
            Logger.warn('[DevFunctions] Không thể gửi tin nhắn tiến trình chờ:', e.message);
        }

        if (statusMsg) {
            const filter = (btnInt) => btnInt.customId === dismissBtnId && (btnInt.user.id === user?.id || SelfDevService.isOwner(btnInt.user.id));
            collector = statusMsg.createMessageComponentCollector({ filter, time: 180000 });
            collector.on('collect', async (btnInt) => {
                await btnInt.deferUpdate().catch(() => {});
                await statusMsg.delete().catch(() => {});
            });

            progressInterval = setInterval(async () => {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                const updatedEmbed = createWaitEmbed(elapsed, currentStage, currentStageDescription);
                await statusMsg.edit({ embeds: [updatedEmbed], components: [dismissRow] }).catch(() => {});
            }, 2500);
        }

        const onProgress = (progress) => {
            if (progress && typeof progress === 'object') {
                currentStage = progress.stage || currentStage;
                currentStageDescription = progress.text || currentStageDescription;
            } else if (typeof progress === 'string') {
                currentStageDescription = progress;
            }
            if (statusMsg) {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                const updatedEmbed = createWaitEmbed(elapsed, currentStage, currentStageDescription);
                statusMsg.edit({ embeds: [updatedEmbed], components: [dismissRow] }).catch(() => {});
            }
        };

        try {
            const inspectionResult = await SelfDevService.runDynamicScript({
                prompt,
                action: lowerAction,
                context: { client, guild, channel, user, message },
                onProgress
            });

            if (statusMsg) {
                onProgress({ stage: 'completed', text: '✨ Đã hoàn thành xuất sắc! Đang đóng gói kết quả cho bạn... 🎉' });
            }

            return typeof inspectionResult === 'string' ? inspectionResult : JSON.stringify(inspectionResult);
        } catch (err) {
            Logger.error('[DevFunctions] Lỗi chạy dynamic script:', err);
            return JSON.stringify({ error: err.message });
        } finally {
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
            if (collector) {
                collector.stop();
            }
            // Tin nhắn ngắn hạn: Tự động ẩn/xóa sau 2.5 giây khi kết quả hoàn tất hiển thị
            if (statusMsg) {
                setTimeout(() => {
                    statusMsg.delete().catch(() => {});
                }, 2500);
            }
        }
    }

    // Các tác vụ thay đổi mã nguồn (tạo/xóa/sửa tính năng) chỉ dành cho Owner
    if (!SelfDevService.isOwner(user?.id)) {
        return "Tính năng này chỉ dành riêng cho bạn chủ nhân của mình thôi nha! 🫧";
    }

    // 2. Xử lý kịch bản xóa lệnh khỏi Sandbox
    const isDelete = lowerAction === 'delete_feature';

    if (isDelete) {
        SelfDevService.startDeleteSession({
            prompt,
            featureName: feature_name,
            user,
            channel,
            client
        }).catch(err => {
            Logger.error('[DevFunctions] Error starting Delete session:', err);
        });

        return `Mình đã nhận yêu cầu gỡ bỏ lệnh từ bạn rồi nè! Mình đang tiến hành kiểm tra và gỡ bỏ an toàn ngay nha~ 🫧`;
    }

    // Kích hoạt tiến trình Self-Dev tạo mới tính năng (Tự động Apply an toàn)
    SelfDevService.startSession({
        prompt,
        featureName: feature_name,
        user,
        channel,
        client,
        originalMessage: message
    }).catch(err => {
        Logger.error('[DevFunctions] Error starting Self-Dev session:', err);
    });

    return `Mình đã nhận yêu cầu của bạn rồi nè! Mình đang tự tay chuẩn bị và hoàn thiện tính năng "${prompt}", bạn đợi mình một chút xíu nha~ ✨🫧`;
}

/**
 * Tra cứu thông tin trên Internet qua Google Search theo thời gian thực (Google Search Grounding)
 */
export async function web_search({ query }) {
    if (!query || typeof query !== 'string') {
        return JSON.stringify({ error: 'Vui lòng cung cấp từ khóa tìm kiếm.' });
    }

    try {
        Logger.info(`[DevFunctions] 🌐 Đang tìm kiếm Google cho: "${query}"...`);

        const candidateModels = await geminiModelService.getCandidateModels('flash-lite', 'chat');
        let lastError = null;
        let searchResult = null;

        for (const modelId of candidateModels) {
            try {
                searchResult = await ApiKeyManager.execute(modelId, async (key) => {
                    const ai = ApiKeyManager.getClient(key);
                    return await ai.models.generateContent({
                        model: modelId,
                        contents: `Hãy tìm kiếm Google và tổng hợp thông tin chính xác, cập nhật nhất về câu hỏi/từ khóa sau:\n"${query}"\n\nYêu cầu: Tóm tắt các ý chính, số liệu thực tế, mốc thời gian và sự kiện cụ thể.`,
                        config: {
                            tools: [{ googleSearch: {} }],
                            temperature: 0.2
                        }
                    });
                }, { timeoutMs: 30000, maxRetries: 2 });

                if (searchResult) break;
            } catch (err) {
                lastError = err;
                Logger.warn(`[DevFunctions] ⚠️ Model ${modelId} gặp sự cố khi web_search: ${err.message}. Đang thử model tiếp theo...`);
            }
        }

        if (!searchResult) {
            throw lastError || new Error('Không có model nào thực hiện được web_search.');
        }

        const text = searchResult.text || '';
        const groundingMeta = searchResult.candidates?.[0]?.groundingMetadata;

        const resultObj = {
            query: query,
            summary: text,
            searchQueries: groundingMeta?.webSearchQueries || [],
            sources: (groundingMeta?.groundingChunks || []).slice(0, 5).map(c => ({
                title: c.web?.title,
                uri: c.web?.uri
            }))
        };

        Logger.info(`[DevFunctions] ✅ Đã tìm kiếm thành công cho "${query}" (${resultObj.sources.length} nguồn trích dẫn)`);
        return JSON.stringify(resultObj);
    } catch (err) {
        Logger.error(`[DevFunctions] ❌ Lỗi khi tìm kiếm Google cho "${query}":`, err.message);
        return JSON.stringify({
            query: query,
            error: `Không thể tìm kiếm trên Google lúc này: ${err.message}`,
            fallbackMessage: 'Hãy thử lại sau giây lát hoặc đổi từ khóa tìm kiếm.'
        });
    }
}

