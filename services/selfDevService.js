import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import ApiKeyManager from '../class/apiKeyManager.js';
import Logger from '../class/Logger.js';
import { reloadI18n, t } from './i18nService.js';
import { loadCommands, deployCommands } from '../deployCommands.js';
import geminiModelService from './geminiModelService.js';
import AntigravityService from './antigravityService.js';
import { loadAgentPrompt } from '../helpers/promptHelper.js';
import SkillHelper from '../helpers/skillHelper.js';
import {
    sandboxManager,
    sandboxValidator,
    PackageInstaller
} from '../core/sandbox/index.js';
import { getAgentSession, updateAgentSession } from '../helpers/chatHelper.js';

const OWNER_ID = process.env.OWNER_ID;


export class SelfDevService {
    /**
     * Kiểm tra user có phải là Owner không
     */
    static isOwner(userId) {
        return userId === OWNER_ID;
    }

    /**
     * Làm sạch tên tính năng thành slug an toàn cho branch/folder
     */
    static slugify(text) {
        if (!text) return `feat-${Date.now()}`;
        return text
            .toString()
            .toLowerCase()
            .trim()
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'd')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Bỏ dấu tiếng Việt
            .replace(/[^a-z0-9_-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 20) || `feat-${Date.now()}`;
    }

    /**
     * Bắt đầu một phiên Self-Dev từ yêu cầu của người dùng trên môi trường Sandbox
     */
    static async startSession({ prompt, featureName, user, channel, client, replyTarget = null, originalMessage = null }) {
        if (!this.isOwner(user.id)) {
            const rejectMsg = t('self_dev.only_owner') || 'Chỉ có chủ nhân mới có thể yêu cầu mình tạo tính năng mới nha!';
            if (replyTarget) await replyTarget.reply(rejectMsg);
            else await channel.send(rejectMsg);
            return;
        }

        const safeSlug = this.slugify(featureName || prompt.split(' ')[0]);
        const sessionId = `dev_${safeSlug}_${Date.now()}`;
        const startTime = Date.now();

        // Gửi Embed thông báo nhẹ nhàng ban đầu theo đúng phong cách Dolia (xưng mình - bạn)
        const statusEmbed = new EmbedBuilder()
            .setColor(0x5DADE2)
            .setTitle('✨ Dolia đang chuẩn bị tính năng cho bạn nè... 🫧')
            .setDescription(
                `⏳ **Thời gian:** 0 giây...\n` +
                `💭 **Trạng thái:** 💭 Dolia đang lên ý tưởng trò chơi thật vui cho bạn nè...\n\n` +
                `*(Bạn đợi mình một chút xíu nha, sắp xong rồi nè~ 💖)*`
            )
            .setTimestamp();

        let progressMsg;
        if (replyTarget && replyTarget.deferred) {
            progressMsg = await replyTarget.editReply({ embeds: [statusEmbed] }).catch(() => null);
        } else if (replyTarget && typeof replyTarget.reply === 'function') {
            progressMsg = await replyTarget.reply({ embeds: [statusEmbed], flags: MessageFlags.Ephemeral }).catch(() => null);
        } else {
            progressMsg = await channel.send({ embeds: [statusEmbed] }).catch(() => null);
        }

        let currentStageDescription = '💭 Dolia đang lên ý tưởng trò chơi thật vui cho bạn nè...';
        let currentStage = 'init'; // Theo dõi stage hiện tại từ Antigravity SSE

        // Màu embed động theo stage của Antigravity Agent
        const stageColors = {
            init: 0x5DADE2,       // xanh dương nhạt
            connected: 0x3498DB,  // xanh dương
            thinking: 0x9B59B6,   // tím (suy nghĩ)
            coding: 0xE67E22,     // cam (viết code)
            tool_call: 0xF39C12,  // vàng (gọi tool)
            code_done: 0x27AE60,  // xanh lá (code xong)
            output: 0x2ECC71,     // xanh lá sáng (xuất kết quả)
            completed: 0x2ECC71,  // xanh lá
            failed: 0xE74C3C,     // đỏ
            fallback: 0xF39C12,   // vàng (fallback nội bộ)
        };

        // Live Progress Timer UX: Cập nhật mỗi 3 giây với thời gian thực và sự kiện thực tế từ Agent
        let progressInterval = setInterval(async () => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);

            const liveEmbed = new EmbedBuilder()
                .setColor(stageColors[currentStage] || 0x5DADE2)
                .setTitle('✨ Dolia đang chuẩn bị trò chơi cho bạn nè... 🫧')
                .setDescription(
                    `⏳ **Thời gian:** ${elapsed} giây...\n` +
                    `💭 **Trạng thái:** ${currentStageDescription}\n\n` +
                    `*(Bạn đợi mình một chút xíu nha, sắp xong rồi nè~ 💖)*`
                )
                .setTimestamp();

            await progressMsg.edit({ embeds: [liveEmbed] }).catch(() => { });
        }, 3000);

        try {
            const MAX_RETRIES = 3;
            let attempt = 0;
            let generatedData = null;
            let usedModel = null;
            let commandName = safeSlug;
            let lastValidationErrors = [];

            // Ưu tiên 1: Gọi Antigravity Agent trên Google Cloud Sandbox với SSE Stream Real-time
            try {
                Logger.info(`[SelfDev] 🧠 Đang gọi Antigravity Agent (Cloud Sandbox)...`);
                const antiResult = await AntigravityService.developFeature({
                    prompt,
                    featureName: safeSlug,
                    context: { client, guild: channel?.guild, channel, user },
                    onProgress: (progress) => {
                        // Hỗ trợ cả 2 format: object { stage, text } hoặc string thuần
                        if (progress && typeof progress === 'object') {
                            currentStageDescription = progress.text || currentStageDescription;
                            currentStage = progress.stage || currentStage;
                        } else if (typeof progress === 'string') {
                            currentStageDescription = progress;
                        }
                    }
                });
                if (antiResult?.data?.files?.length > 0) {
                    generatedData = antiResult.data;
                    usedModel = antiResult.usedModel;
                    commandName = generatedData.command_name || safeSlug;
                    Logger.info(`[SelfDev] ✅ Antigravity Cloud sinh mã thành công cho /${commandName}`);

                    // Ghi tạm vào Sandbox để kiểm thử trước khi nạp
                    for (const fileObj of generatedData.files) {
                        await sandboxManager.writeFile(fileObj.path, fileObj.content);
                    }
                    if (generatedData.i18n && generatedData.i18n.translations) {
                        const i18nRelPath = `i18n/${commandName}.json`;
                        await sandboxManager.writeFile(i18nRelPath, JSON.stringify(generatedData.i18n.translations, null, 4));
                    }

                    // Tự động kiểm thử tính hợp lệ (cú pháp, runtime import, execute)
                    const filesToValidate = [
                        path.join(sandboxManager.sandboxDir, 'slash', `${commandName}.js`),
                        ...(generatedData.i18n && generatedData.i18n.translations ? [path.join(sandboxManager.sandboxDir, 'i18n', `${commandName}.json`)] : [])
                    ];
                    const validationResults = await sandboxValidator.validateBatch(filesToValidate);
                    if (!validationResults.valid) {
                        Logger.warn(`[SelfDev] ⚠️ Mã nguồn từ Antigravity Cloud có lỗi kiểm thử: ${validationResults.errors.join('; ')}. Chuyển sang chế độ tự sửa nội bộ...`);
                        lastValidationErrors = validationResults.errors;
                        generatedData = null; // Đặt về null để vòng lặp tự sửa nội bộ tiếp quản sửa lỗi!
                        currentStage = 'fallback';
                        currentStageDescription = '🔄 Chuyển sang chế độ tự phát triển nội bộ để sửa lỗi...';
                    }
                }
            } catch (antiErr) {
                Logger.warn(`[SelfDev] ⚠️ Antigravity Cloud gặp sự cố: ${antiErr.message}. Tự động chuyển sang chế độ dự phòng nội bộ...`);
                currentStage = 'fallback';
                currentStageDescription = '🔄 Chuyển sang chế độ tự phát triển nội bộ...';
            }

            // Ưu tiên 2: Fallback chế độ sinh mã nội bộ nếu Antigravity Cloud chưa trả về dữ liệu
            if (!generatedData) {
                const codingModelId = await geminiModelService.getActiveModel('flash-lite', 'agent');

                while (attempt < MAX_RETRIES) {
                    attempt++;

                    if (attempt > 1) {
                        const fixEmbed = new EmbedBuilder()
                            .setColor(0xF39C12)
                            .setTitle('✨ Ấy da, mình xin lỗi nhé! 🥺')
                            .setDescription(`Có vẻ như mình gặp chút trục trặc nhỏ khi chuẩn bị lệnh **\`/${commandName}\`**.\n` +
                                `Bạn đợi một xíu nha, mình đang tự chỉnh lại cho thật mượt mà ngay đây nè! 🫧✨`)
                            .setTimestamp();
                        await progressMsg.edit({ embeds: [fixEmbed] }).catch(() => { });
                    }

                    const feedback = lastValidationErrors.length > 0 ? lastValidationErrors.join('\n') : null;
                    const prevCode = generatedData?.files?.[0]?.content || null;

                    const result = await this.callGeminiCodingModel(prompt, safeSlug, codingModelId, feedback, prevCode);
                    generatedData = result.data;
                    usedModel = result.usedModel;
                    commandName = generatedData.command_name || safeSlug;

                    // Ghi vào Sandbox
                    for (const fileObj of generatedData.files) {
                        await sandboxManager.writeFile(fileObj.path, fileObj.content);
                    }

                    if (generatedData.i18n && generatedData.i18n.translations) {
                        const i18nRelPath = `i18n/${commandName}.json`;
                        await sandboxManager.writeFile(i18nRelPath, JSON.stringify(generatedData.i18n.translations, null, 4));
                    }

                    const filesToValidate = [
                        path.join(sandboxManager.sandboxDir, 'slash', `${commandName}.js`),
                        ...(generatedData.i18n && generatedData.i18n.translations ? [path.join(sandboxManager.sandboxDir, 'i18n', `${commandName}.json`)] : [])
                    ];
                    const validationResults = await sandboxValidator.validateBatch(filesToValidate);
                    if (validationResults.valid) {
                        lastValidationErrors = [];
                        break;
                    } else {
                        lastValidationErrors = validationResults.errors;
                        Logger.warn(`[SelfDev] ⚠️ Kiểm thử Sandbox lượt ${attempt} thất bại: ${lastValidationErrors.join('; ')}`);
                    }
                }

                if (lastValidationErrors.length > 0) {
                    throw new Error(`Kiểm thử chất lượng trong Sandbox chưa đạt chuẩn sau ${MAX_RETRIES} lần tự sửa:\n${lastValidationErrors.join('\n')}`);
                }
            } else {
                // Nếu đến từ Antigravity Cloud: Ghi file vào Sandbox cục bộ
                for (const fileObj of generatedData.files) {
                    await sandboxManager.writeFile(fileObj.path, fileObj.content);
                }
                if (generatedData.i18n && generatedData.i18n.translations) {
                    const i18nRelPath = `i18n/${commandName}.json`;
                    await sandboxManager.writeFile(i18nRelPath, JSON.stringify(generatedData.i18n.translations, null, 4));
                }
            }

            // Dừng Live Progress Timer trước khi sang bước hoàn tất
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }

            // Tự động phát hiện và cài đặt an toàn các thư viện npm mới nếu lệnh yêu cầu
            for (const fileObj of generatedData.files) {
                if (fileObj.path?.endsWith('.js') && fileObj.content) {
                    await PackageInstaller.ensureDependencies(fileObj.content);
                }
            }

            // Bước 4: Tự động nạp lệnh vào RAM trực tiếp từ SANDBOX (Hot-Reload) và làm mới i18n
            let loadedCmd = null;
            const commandPath = path.join(process.cwd(), 'sandbox', 'slash', `${commandName}.js`);
            if (fs.existsSync(commandPath)) {
                try {
                    const moduleUrl = pathToFileURL(commandPath).href + `?t=${Date.now()}`;
                    const importedModule = await import(moduleUrl);
                    const cmd = importedModule.default ?? importedModule;
                    if (cmd && cmd.data && client?.commands) {
                        cmd.isSandbox = true;
                        client.commands.set(cmd.data.name, cmd);
                        loadedCmd = cmd;
                        Logger.info(`[SelfDev] Successfully hot-reloaded command from sandbox: /${cmd.data.name}`);
                    }
                } catch (loadErr) {
                    Logger.warn(`[SelfDev] Warning on hot-reload: ${loadErr.message}`);
                    throw new Error(`Không thể nạp lệnh /${commandName} vào bộ nhớ bot: ${loadErr.message}`);
                }
            } else {
                throw new Error(`File lệnh /${commandName} không tồn tại trên ổ đĩa sau khi sinh mã.`);
            }

            if (!loadedCmd) {
                throw new Error(`Không thể khởi tạo lệnh /${commandName} (thiếu export data hoặc execute).`);
            }
            reloadI18n();

            // Bước 5: Tự động deploy slash command lên Discord REST API (forceDeploy: true)
            if (client) {
                try {
                    const loadResult = await loadCommands(null, client);
                    await deployCommands(loadResult, true);
                    Logger.info(`[SelfDev] Successfully deployed slash commands to Discord REST API`);
                } catch (deployErr) {
                    Logger.warn(`[SelfDev] Warning on deploy commands: ${deployErr.message}`);
                }
            }

            // Bước 6: TỰ ĐỘNG KÍCH HOẠT VÀ HIỂN THỊ GIAO DIỆN TÍNH NĂNG/GAME TẠI CHỖ (Zero manual typing)
            if (loadedCmd && typeof loadedCmd.execute === 'function') {
                Logger.info(`[SelfDev] 🚀 Tự động kích hoạt tính năng /${commandName} cho người dùng ngay tại chỗ...`);
                try {
                    const mentionedUser = originalMessage?.mentions?.users?.first() || null;
                    const adapter = {
                        client,
                        guild: channel?.guild || null,
                        channel,
                        user,
                        member: channel?.guild ? (channel.guild.members.cache.get(user.id) || null) : null,
                        deferred: true,
                        replied: true,
                        commandName: commandName,
                        isChatInputCommand: () => true,
                        isButton: () => false,
                        isCommand: () => true,
                        options: {
                            getUser: (optName) => mentionedUser || user,
                            getMember: (optName) => {
                                const target = mentionedUser || user;
                                return channel?.guild ? (channel.guild.members.cache.get(target.id) || null) : null;
                            },
                            getString: (optName) => prompt,
                            getInteger: (optName) => 0,
                            getNumber: (optName) => 0,
                            getBoolean: (optName) => true,
                            getSubcommand: () => null,
                            getSubcommandGroup: () => null,
                            get: (optName) => null
                        },
                        deferReply: async () => progressMsg,
                        reply: async (payload) => {
                            const data = typeof payload === 'string' ? { content: payload } : payload;
                            return await progressMsg.edit(data);
                        },
                        editReply: async (payload) => {
                            const data = typeof payload === 'string' ? { content: payload } : payload;
                            return await progressMsg.edit(data);
                        },
                        followUp: async (payload) => {
                            const data = typeof payload === 'string' ? { content: payload } : payload;
                            return await channel.send(data);
                        },
                        deleteReply: async () => {
                            return await progressMsg.delete().catch(() => { });
                        }
                    };

                    await loadedCmd.execute(adapter);
                    Logger.info(`[SelfDev] ✅ Đã tự động kích hoạt thành công tính năng /${commandName}!`);
                    return; // Giao diện tính năng đã được render trực tiếp lên tin nhắn, hoàn tất quy trình!
                } catch (execErr) {
                    Logger.warn(`[SelfDev] Warning when auto-executing /${commandName}: ${execErr.message}`);
                }
            }

            // Fallback nếu lệnh không tự render qua adapter
            const fallbackEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('🎉 Hoàn tất rồi nè!')
                .setDescription(
                    `Mình đã học xong tính năng mới **\`/${commandName}\`** cho bạn rồi đó!\n` +
                    `Bây giờ bạn có thể thử ngay nha~ 💖✨\n\n` +
                    `📝 **Mô tả:** ${generatedData.summary || prompt}`
                )
                .setTimestamp();

            await progressMsg.edit({ embeds: [fallbackEmbed], components: [] }).catch(() => { });
            // Tin nhắn ngắn hạn: Tự động xóa thông báo sau 10 giây
            setTimeout(() => {
                progressMsg?.delete().catch(() => {});
            }, 10000);

        } catch (error) {
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
            Logger.error(`[SelfDev] Error in session ${sessionId}:`, error);

            // Chỉ dọn dẹp file của lệnh bị lỗi, tuyệt đối không xóa sạch sandbox
            try {
                if (safeSlug) {
                    sandboxManager.cleanSandbox(`slash/${safeSlug}.js`);
                    sandboxManager.cleanSandbox(`i18n/${safeSlug}.json`);
                }
            } catch (_) { }

            const errorEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('Ấy da, có chút trục trặc nhỏ rồi... 🥺')
                .setDescription(`Trong lúc hoàn thiện lệnh **\`/${safeSlug}\`**, mình gặp chút khó khăn nên chưa xong được nè.\nBạn cho mình thử lại sau nha! 🫧`)
                .setTimestamp();

            await progressMsg.edit({ embeds: [errorEmbed], components: [] }).catch(() => { });
            // Tin nhắn ngắn hạn: Tự động xóa thông báo lỗi sau 10 giây
            setTimeout(() => {
                progressMsg?.delete().catch(() => {});
            }, 10000);
        }
    }

    /**
     * Gọi Gemini Coding Model từ Database (Ưu tiên Flash-Lite trước rồi đến Flash)
     */
    static async callGeminiCodingModel(userPrompt, suggestedName, preferredModelId = null, errorFeedback = null, previousCode = null) {
        const candidates = await geminiModelService.getCandidateModels('flash-lite', 'agent');
        if (preferredModelId && !candidates.includes(preferredModelId)) {
            candidates.unshift(preferredModelId);
        }

        let lastError = null;

        for (const modelId of candidates) {
            if (geminiModelService.isAgentBlocked(modelId)) continue;
            try {
                Logger.info(`[SelfDev] 🧠 Đang gọi Gemini Coding Model (${modelId}) cho tính năng: "${suggestedName}"...`);

                const baseInstruction = loadAgentPrompt('AgentInstruction.md', {
                    '{{safeSlug}}': suggestedName
                });
                const systemInstruction = SkillHelper.enhanceInstructionWithSkills(baseInstruction, userPrompt);

                let promptContent = `Lập trình tính năng sau cho Dolia theo [CHẾ ĐỘ 2: SLASH COMMAND]: ${userPrompt}. Tên lệnh gợi ý: ${suggestedName}. Hãy viết code thật chất lượng và trả về DUY NHẤT định dạng JSON đúng chuẩn.`;
                if (errorFeedback && previousCode) {
                    promptContent += `\n\n[LƯU Ý SỬA LỖI TỰ ĐỘNG]: Lần sinh mã trước gặp lỗi kiểm thử sau:\n${errorFeedback}\n\nMã nguồn bị lỗi trước đó:\n\`\`\`javascript\n${previousCode}\n\`\`\`\nHãy phân tích nguyên nhân lỗi và sinh lại mã nguồn hoàn chỉnh, sửa triệt để tất cả các lỗi trên!`;
                }

                const outputText = await ApiKeyManager.execute(modelId, async (apiKey) => {
                    const ai = ApiKeyManager.getClient(apiKey);
                    const response = await ai.models.generateContent({
                        model: modelId,
                        contents: promptContent,
                        config: {
                            systemInstruction: systemInstruction,
                            temperature: 0.2,
                            responseMimeType: "application/json"
                        }
                    });
                    return response.text || '';
                }, { timeoutMs: 60000 });

                Logger.info(`[SelfDev] ✅ Gemini Coding Model (${modelId}) đã phản hồi (${outputText.length} ký tự)!`);
                geminiModelService.reportModelSuccess(modelId);

                const parsedData = SelfDevService.safeJsonParse(outputText);
                return { data: this.normalizeGeneratedData(parsedData, suggestedName), usedModel: modelId };
            } catch (modelErr) {
                lastError = modelErr;
                geminiModelService.reportModelFailure(modelId, modelErr.message);
                Logger.warn(`[SelfDev] ⚠️ Model ${modelId} gặp sự cố: ${modelErr.message}. Tự động thử model tiếp theo...`);
            }
        }

        throw new Error(`Tất cả các model Gemini đều không thể xử lý yêu cầu. Lỗi cuối: ${lastError?.message}`);
    }

    /**
     * Parse JSON an toàn từ LLM với khả năng tự phục hồi các escape sequence không hợp lệ
     */
    static safeJsonParse(text) {
        if (!text || typeof text !== 'string') {
            throw new Error('Không nhận được nội dung trả về từ AI.');
        }

        let clean = text.trim();
        if (clean.startsWith('```json')) {
            clean = clean.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
        } else if (clean.startsWith('```')) {
            clean = clean.replace(/^```\s*/, '').replace(/```\s*$/, '');
        }
        clean = clean.trim();

        try {
            return JSON.parse(clean);
        } catch (firstErr) {
            const firstBrace = clean.indexOf('{');
            const lastBrace = clean.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                const sub = clean.substring(firstBrace, lastBrace + 1);
                try {
                    return JSON.parse(sub);
                } catch (_) {
                    const fixed = sub.replace(/\\([^"\\/bfnrtu])/g, '\\\\$1');
                    try {
                        return JSON.parse(fixed);
                    } catch (_) {
                        try {
                            const codeMatch = clean.match(/"content"\s*:\s*"([\s\S]*?)"\s*\}\s*\]/m) ||
                                clean.match(/"content"\s*:\s*`([\s\S]*?)`/m);
                            if (codeMatch) {
                                const extractedCode = codeMatch[1]
                                    .replace(/\\n/g, '\n')
                                    .replace(/\\t/g, '\t')
                                    .replace(/\\"/g, '"')
                                    .replace(/\\\\/g, '\\');
                                return {
                                    command_name: '',
                                    summary: 'Tự động trích xuất mã nguồn từ phản hồi của AI',
                                    files: [{ path: '', content: extractedCode }]
                                };
                            }
                        } catch (_) { }

                        throw new Error(`Lỗi cú pháp JSON từ model AI: ${firstErr.message}`);
                    }
                }
            }
            throw new Error(`Không tìm thấy khối JSON hợp lệ trong phản hồi của AI: ${firstErr.message}`);
        }
    }

    /**
     * Chuẩn hóa dữ liệu trả về từ Gemini Coding Agent phù hợp kiến trúc Sandbox
     */
    static normalizeGeneratedData(parsedData, suggestedName) {
        const result = {
            command_name: parsedData.command_name || parsedData.name || suggestedName,
            summary: parsedData.summary || parsedData.description || "Tính năng mới được lập trình bởi Gemini Coding Agent",
            files: [],
            i18n: parsedData.i18n || null
        };

        if (Array.isArray(parsedData.files) && parsedData.files.length > 0) {
            result.files = parsedData.files;
        } else if (parsedData.code) {
            const fileName = parsedData.filename ? path.basename(parsedData.filename) : `${result.command_name}.js`;
            result.files = [{
                path: `slash/${fileName}`,
                content: parsedData.code
            }];
        }

        // Chuẩn hóa đường dẫn tương đối trong Sandbox
        for (const file of result.files) {
            if (!file.path) {
                file.path = `slash/${result.command_name}.js`;
            }
            // Chuẩn hóa các đường dẫn dạng commands/slash/ hoặc sandbox/
            file.path = file.path.replace(/^commands\/slash\//, 'slash/');
            file.path = file.path.replace(/^sandbox\//, '');
            if (!file.path.includes('/')) {
                file.path = `slash/${file.path}`;
            }

            // Tự động chuẩn hóa sang ESM nếu AI sinh dạng CommonJS
            if (file.path.endsWith('.js') && typeof file.content === 'string') {
                let code = file.content;
                code = code.replace(/module\.exports\s*=\s*/g, 'export default ');
                code = code.replace(/const\s+\{\s*([^}]+)\s*\}\s*=\s*require\(['"]discord\.js['"]\);?/g, 'import { $1 } from "discord.js";');
                code = code.replace(/const\s+([a-zA-Z0-9_$]+)\s*=\s*require\(['"]([^'"]+)['"]\);?/g, 'import $1 from "$2";');
                file.content = code;
            }
        }

        return result;
    }

    /**
     * Bắt đầu phiên yêu cầu xóa lệnh/tính năng trong Sandbox
     */
    static async startDeleteSession({ prompt, featureName, user, channel, client, replyTarget = null }) {
        if (!this.isOwner(user.id)) {
            const rejectMsg = t('self_dev.only_owner') || 'Chỉ có chủ nhân mới có thể yêu cầu mình gỡ bỏ tính năng nha!';
            if (replyTarget) return replyTarget.reply({ content: rejectMsg, flags: MessageFlags.Ephemeral });
            return channel.send({ content: rejectMsg });
        }

        // CHỈ QUÉT VÀ THAO TÁC TRÊN MÔI TRƯỜNG SANDBOX (Tuyệt đối không can thiệp lệnh gốc trong commands/)
        const sandboxSlashDir = path.join(process.cwd(), 'sandbox', 'slash');
        const existingFiles = fs.existsSync(sandboxSlashDir) ? fs.readdirSync(sandboxSlashDir).filter(f => f.endsWith('.js')) : [];
        const existingCommands = existingFiles.map(f => f.replace('.js', ''));

        // Từ điển từ khóa thông dụng để nhận diện đúng lệnh cần xóa trong Sandbox
        const COMMAND_KEYWORDS = {
            userinfo: ['thông tin user', 'userinfo', 'user info', 'thông tin người dùng', 'thong tin user', 'profile', 'xem thông tin', 'xem thong tin', 'soi profile'],
            trivia: ['trivia', 'đố vui', 'do vui', 'câu đố', 'cau do'],
            dragon_ball_quiz: ['dragon ball', 'dragonball', '7 viên ngọc rồng', 'ngọc rồng', 'dragon_ball_quiz'],
            word_chain: ['nối từ', 'noi tu', 'word chain', 'word_chain'],
            dice: ['xúc xắc', 'xúc sắc', 'xuc xac', 'xuc sac', 'xí ngầu', 'xi ngau', 'dice', 'roll', 'xuc'],
            coinflip: ['đồng xu', 'dong xu', 'tung xu', 'coin', 'flip', 'coinflip']
        };

        // Tìm tên lệnh cần xóa trong Sandbox
        let targetName = featureName ? this.slugify(featureName) : null;
        if (!targetName || !existingCommands.includes(targetName)) {
            const lowerPrompt = (prompt || '').toLowerCase();

            for (const [cmd, keywords] of Object.entries(COMMAND_KEYWORDS)) {
                if (existingCommands.includes(cmd) && keywords.some(k => lowerPrompt.includes(k))) {
                    targetName = cmd;
                    break;
                }
            }

            if (!targetName) {
                const found = existingCommands.find(cmd => lowerPrompt.includes(cmd.toLowerCase()));
                if (found) targetName = found;
            }
        }

        const targetFile = targetName ? path.join(sandboxSlashDir, `${targetName}.js`) : null;
        const fileExists = targetFile && fs.existsSync(targetFile);

        if (!fileExists) {
            const notFoundEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('🔍 Không tìm thấy tính năng cần gỡ nè')
                .setDescription(`Mình không tìm thấy tính năng nào tên là **\`${targetName || featureName || prompt}\`** trong danh sách tính năng được tạo hết trơn á.\n\n` +
                    `📋 **Các tính năng hiện có:**\n` +
                    (existingCommands.length > 0 ? existingCommands.map(c => `\`/${c}\``).join(', ') : '*Chưa có tính năng nào được tạo*'))
                .setTimestamp();

            if (replyTarget && replyTarget.deferred) return replyTarget.editReply({ embeds: [notFoundEmbed] });
            if (replyTarget) return replyTarget.reply({ embeds: [notFoundEmbed] });
            return channel.send({ embeds: [notFoundEmbed] });
        }

        // Thông báo đang tiến hành xóa
        const deletingEmbed = new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle(`🗑️ Đang gỡ bỏ lệnh /${targetName}...`)
            .setDescription(`Mình đang tiến hành gỡ bỏ lệnh **\`/${targetName}\`** theo yêu cầu của bạn nha! 🌊🫧`)
            .setTimestamp();

        let progressMsg;
        if (replyTarget && replyTarget.deferred) {
            progressMsg = await replyTarget.editReply({ embeds: [deletingEmbed] });
        } else if (replyTarget) {
            progressMsg = await replyTarget.reply({ embeds: [deletingEmbed] });
        } else {
            progressMsg = await channel.send({ embeds: [deletingEmbed] });
        }

        // Tự động xóa ngay lập tức qua ApplyEngine (đã có backup an toàn)
        await this.executeDeleteCommand({ targetName, user, confirmMsg: progressMsg, client });
    }

    /**
     * Thực thi xóa lệnh khỏi Sandbox với Backup an toàn
     */
    static async executeDeleteCommand({ targetName, user, confirmMsg, client }) {
        try {
            Logger.info(`[SelfDev] 🗑️ Đang tiến hành xóa lệnh /${targetName} khỏi Sandbox...`);

            const sandboxCmd = path.join(process.cwd(), 'sandbox', 'slash', `${targetName}.js`);
            const sandboxI18n = path.join(process.cwd(), 'sandbox', 'i18n', `${targetName}.json`);
            const sandboxBackupDir = path.join(process.cwd(), 'sandbox', 'backup');

            if (!fs.existsSync(sandboxBackupDir)) {
                fs.mkdirSync(sandboxBackupDir, { recursive: true });
            }

            // Sao lưu và xóa file lệnh (.js) trong Sandbox
            if (fs.existsSync(sandboxCmd)) {
                fs.copyFileSync(sandboxCmd, path.join(sandboxBackupDir, `${targetName}.js.bak`));
                fs.rmSync(sandboxCmd, { force: true });
            }

            // Sao lưu và xóa file i18n (.json) trong Sandbox
            if (fs.existsSync(sandboxI18n)) {
                fs.copyFileSync(sandboxI18n, path.join(sandboxBackupDir, `${targetName}.json.bak`));
                fs.rmSync(sandboxI18n, { force: true });
            }

            // Xóa khỏi client.commands trong RAM
            if (client?.commands) {
                client.commands.delete(targetName);
                Logger.info(`[SelfDev] Đã gỡ lệnh /${targetName} khỏi RAM của bot`);
            }
            reloadI18n();

            // Cập nhật Embed thành công lên Discord (không tiết lộ đường dẫn nội bộ / file kỹ thuật)
            const successEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('🗑️ Đã gỡ bỏ thành công!')
                .setDescription(`Mình đã gỡ bỏ hoàn toàn lệnh **\`/${targetName}\`** theo yêu cầu của bạn rồi nha! Bạn yên tâm là mình vẫn lưu trữ lại phòng khi bạn muốn dùng lại sau nè~ 🫧✨`)
                .setTimestamp();

            await confirmMsg.edit({ embeds: [successEmbed], components: [] }).catch(() => {});
            // Tin nhắn ngắn hạn: Tự động xóa sau 8 giây
            setTimeout(() => {
                confirmMsg?.delete().catch(() => {});
            }, 8000);

            // Deploy lại commands lên Discord API (forceDeploy: true)
            const loadResult = await loadCommands(null, client);
            await deployCommands(loadResult, true);
            Logger.info(`[SelfDev] ✅ Đã đồng bộ lại danh sách lệnh lên Discord REST API`);

        } catch (err) {
            Logger.error(`[SelfDev] Lỗi khi xóa lệnh /${targetName}:`, err);
            const errEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('Ấy da, có chút trục trặc nhỏ rồi... 🥺')
                .setDescription(`Mình chưa gỡ bỏ được lệnh này nè, bạn thử lại sau giúp mình nha! 🫧`)
                .setTimestamp();
            await confirmMsg.edit({ embeds: [errEmbed], components: [] }).catch(() => {});
            // Tin nhắn ngắn hạn: Tự động xóa sau 8 giây
            setTimeout(() => {
                confirmMsg?.delete().catch(() => {});
            }, 8000);
        }
    }

    /**
     * Tạo và thực thi script ngầm trong sandbox/scripts/ để kiểm tra dữ liệu Discord/hệ thống thực tế
     * Trả về kết quả cho Gemini để trả lời câu hỏi của người dùng
     */
    /**
     * Tạo và thực thi script ngầm trong sandbox/workspaces/<channelId>/ để kiểm tra dữ liệu Discord/hệ thống thực tế
     * Hỗ trợ Chained Modification kế thừa mã nguồn script cũ theo chuẩn Google Custom Agents & Managed Environment
     */
    static async runDynamicScript({ prompt, context, action = 'create_script', onProgress = null }) {
        const { client, guild, channel, user, message } = context;
        const candidates = await geminiModelService.getCandidateModels('flash', 'agent');

        onProgress?.({ stage: 'thinking', text: '💭 Dolia đang phân tích yêu cầu và chuẩn bị kịch bản...' });

        // Lấy thông tin Agent Session đã lưu trong MongoDB cho user và channel này
        let agentSession = null;
        if (user?.id && channel?.id) {
            agentSession = await getAgentSession(user.id, channel.id);
        }

        const lastScript = agentSession?.lastScript;
        const lowerPrompt = (prompt || '').toLowerCase();
        const isModify = action === 'modify_script' || 
                         action === 'edit_script' || 
                         lowerPrompt.includes('sửa') || 
                         lowerPrompt.includes('chỉnh') || 
                         lowerPrompt.includes('thay đổi') || 
                         lowerPrompt.includes('chỉ giữ') || 
                         lowerPrompt.includes('bỏ avatar');

        // Nạp prompt chỉ thị từ config/prompt/agent/AgentInstruction.md và nhúng skills
        const baseInstruction = loadAgentPrompt('AgentInstruction.md', {
            '{{safeSlug}}': 'query_script'
        });
        const systemInstruction = SkillHelper.enhanceInstructionWithSkills(baseInstruction, prompt);

        // Chuẩn bị User Prompt: Kế thừa mã nguồn cũ nếu là tác vụ sửa đổi (Chained Modification)
        let promptContent = `Kiểm tra dữ liệu Discord theo [CHẾ ĐỘ 1: INSPECT SCRIPT]: ${prompt}`;
        if (isModify && lastScript && lastScript.code) {
            Logger.info(`[SelfDev] 🔄 Kích hoạt Chained Script Modification cho kênh #${channel?.name || channel?.id}: Kế thừa script trước đó (${lastScript.name || 'last_script.js'})...`);
            onProgress?.({ stage: 'thinking', text: '🔄 Dolia đang kế thừa mã nguồn từ phiên trước và chuẩn bị các chỉnh sửa mới...' });
            promptContent = `[CHẾ ĐỘ 1: MODIFY SCRIPT - KẾ THỪA MÃ NGUỒN CŨ TRONG WORKSPACE]:\nBạn đang tiếp tục phiên làm việc trong môi trường (workspace) của kênh này.\n\n[MÃ NGUỒN CŨ ĐÃ HOẠT ĐỘNG THÀNH CÔNG TRƯỚC ĐÓ]:\n\`\`\`javascript\n${lastScript.code}\n\`\`\`\n\n[YÊU CẦU SỬA ĐỔI TỪ NGƯỜI DÙNG]:\n"${prompt}"\n\n[NGUYÊN TẮC BẮT BUỘC]:\n1. Sửa trực tiếp trên mã nguồn cũ, kế thừa 100% bố cục, màu sắc, font chữ, animation timeline và các hiệu ứng đã có.\n2. CHỈ thay đổi hoặc loại bỏ đúng các chi tiết mà người dùng yêu cầu (ví dụ: chỉ giữ lại avatar của người dùng, bỏ avatar khác).\n3. Trả về mã nguồn hoàn chỉnh đã sửa, hàm run() luôn trả về trường 'reply' theo đúng phong cách Dolia.`;
        }

        let scriptPath = null;
        let scriptCode = '';
        let lastError = null;

        for (const modelId of candidates) {
            if (geminiModelService.isAgentBlocked(modelId)) continue;
            try {
                Logger.info(`[SelfDev] 🧠 Đang gọi model (${modelId}) sinh script kiểm tra ngầm cho: "${prompt}"...`);
                onProgress?.({ stage: 'coding', text: `✍️ Dolia đang sinh mã lệnh tối ưu với model ${modelId}...` });
                const rawOutput = await ApiKeyManager.execute(modelId, async (apiKey) => {
                    const ai = ApiKeyManager.getClient(apiKey);
                    const response = await ai.models.generateContent({
                        model: modelId,
                        contents: [{ role: 'user', parts: [{ text: promptContent }] }],
                        config: {
                            systemInstruction,
                            responseMimeType: 'application/json',
                            temperature: 0.1
                        }
                    });
                    return response.text;
                }, { timeoutMs: 40000 });

                try {
                    const parsed = JSON.parse(rawOutput);
                    scriptCode = parsed.code || parsed.content || rawOutput;
                } catch (_) {
                    const match = rawOutput.match(/```(?:javascript|js)?([\s\S]*?)```/) || [null, rawOutput];
                    scriptCode = match[1].trim();
                }

                // Loại bỏ markdown ticks nếu có lọt vào
                scriptCode = scriptCode.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```$/i, '').trim();

                geminiModelService.reportModelSuccess(modelId);
                break; // Sinh script thành công, thoát vòng lặp model
            } catch (modelErr) {
                lastError = modelErr;
                geminiModelService.reportModelFailure(modelId, modelErr.message, 5 * 60 * 1000);
                Logger.warn(`[SelfDev] ⚠️ Model ${modelId} gặp sự cố khi sinh script: ${modelErr.message}. Tự động chuyển model tiếp theo...`);
                onProgress?.({ stage: 'coding', text: `🔄 Model ${modelId} bận, đang tự động đổi sang model tiếp theo...` });
            }
        }

        if (!scriptCode) {
            Logger.error(`[SelfDev] ❌ Tất cả các model đều không thể sinh script kiểm tra ngầm. Lỗi cuối: ${lastError?.message}`);
            return this.getDirectDataFallback(guild, channel, lastError?.message);
        }

        const channelWorkspaceDir = path.join(process.cwd(), 'sandbox', 'workspaces', channel?.id || 'default');
        if (!fs.existsSync(channelWorkspaceDir)) {
            fs.mkdirSync(channelWorkspaceDir, { recursive: true });
        }

        try {
            // Tự động phát hiện và cài đặt an toàn các thư viện npm mới nếu script yêu cầu
            onProgress?.({ stage: 'packages', text: '📦 Dolia đang kiểm tra và chuẩn bị thư viện/tài nguyên cần thiết...' });
            await PackageInstaller.ensureDependencies(scriptCode);

            // Ghi file vào sandbox/scripts/
            const scriptsDir = path.join(process.cwd(), 'sandbox', 'scripts');
            if (!fs.existsSync(scriptsDir)) {
                fs.mkdirSync(scriptsDir, { recursive: true });
            }
            scriptPath = path.join(scriptsDir, `query_${Date.now()}.js`);
            fs.writeFileSync(scriptPath, scriptCode, 'utf-8');

            // Ghi bản sao lưu giữ state vào channel workspace
            const wsScriptPath = path.join(channelWorkspaceDir, 'current_script.js');
            fs.writeFileSync(wsScriptPath, scriptCode, 'utf-8');

            // Nạp và thực thi script
            const moduleUrl = pathToFileURL(scriptPath).href + `?t=${Date.now()}`;
            const importedModule = await import(moduleUrl);
            const runFn = importedModule.default ?? importedModule;

            if (typeof runFn !== 'function') {
                throw new Error("Script không export default một hàm async!");
            }

            Logger.info(`[SelfDev] 🚀 Bắt đầu thực thi script kiểm tra ngầm (${path.basename(scriptPath)})...`);
            onProgress?.({ stage: 'executing', text: '🚀 Đang thực thi mã lệnh và kết xuất dữ liệu trong sandbox... 🎬' });

            // Timeout guard 180s (3 phút) để tránh script bị treo vô hạn mà vẫn đáp ứng tác vụ nặng (render đồ họa / video)
            let scriptTimer;
            const timeoutPromise = new Promise((_, reject) => {
                scriptTimer = setTimeout(() => {
                    reject(new Error("Script thực thi quá 3 phút (timeout do tác vụ kéo dài)"));
                }, 180000);
                scriptTimer.unref?.();
            });

            const dataResult = await Promise.race([
                runFn({ client, guild, channel, user, message }),
                timeoutPromise
            ]);
            if (scriptTimer) clearTimeout(scriptTimer);

            Logger.info(`[SelfDev] ✅ Script kiểm tra ngầm trong sandbox trả về:`, dataResult);
            onProgress?.({ stage: 'completed', text: '✨ Đã thực thi xong! Đang kiểm tra và chuẩn bị kết quả gửi đến bạn...' });

            // Cập nhật lastScript vào Agent Session của Channel trong MongoDB để phục vụ Modify ở lượt sau
            if (user?.id && channel?.id && scriptCode) {
                updateAgentSession(user.id, channel.id, {
                    workspacePath: channelWorkspaceDir,
                    lastScript: {
                        name: path.basename(scriptPath),
                        code: scriptCode,
                        prompt: prompt
                    }
                }).catch(err => {
                    Logger.warn('[SelfDev] ⚠️ Không thể lưu lastScript vào agentSession:', err.message);
                });
            }

            return dataResult;

        } catch (scriptErr) {
            Logger.warn(`[SelfDev] ⚠️ Lỗi trong quá trình chạy script ngầm:`, scriptErr.message);
            return this.getDirectDataFallback(guild, channel, scriptErr.message);
        } finally {
            // Tự động sao lưu file script sang sandbox/backup/*.bak trước khi dọn dẹp sandbox/scripts/
            if (scriptPath && fs.existsSync(scriptPath)) {
                try {
                    const backupDir = path.join(process.cwd(), 'sandbox', 'backup');
                    if (!fs.existsSync(backupDir)) {
                        fs.mkdirSync(backupDir, { recursive: true });
                    }
                    const baseName = path.basename(scriptPath);
                    const backupPath = path.join(backupDir, `${baseName}.bak`);
                    fs.copyFileSync(scriptPath, backupPath);
                    fs.unlinkSync(scriptPath);
                    Logger.info(`[SelfDev] 💾 Đã lưu bản sao lưu script vào: sandbox/backup/${baseName}.bak`);
                } catch (bakErr) {
                    Logger.warn(`[SelfDev] ⚠️ Lỗi khi sao lưu script vào sandbox/backup:`, bakErr.message);
                    try { fs.unlinkSync(scriptPath); } catch (_) { }
                }
            }
        }
    }

    /**
     * Fallback lấy dữ liệu cơ bản trực tiếp từ Discord Cache khi script gặp sự cố
     */
    static getDirectDataFallback(guild, channel, errMsg) {
        if (guild) {
            try {
                const total = guild.memberCount || guild.members.cache.size;
                const humans = guild.members.cache.filter(m => !m.user?.bot).size;
                const bots = guild.members.cache.filter(m => m.user?.bot).size;
                const channelMembersCount = channel?.members?.size || total;
                return {
                    serverName: guild.name,
                    totalServerMembers: total,
                    humanMembers: humans,
                    botMembers: bots,
                    channelName: channel?.name || 'unknown',
                    channelMembersCount: channelMembersCount,
                    summary: `Server ${guild.name} có tổng cộng ${total} thành viên (${humans} người, ${bots} bot). Kênh #${channel?.name} có ${channelMembersCount} người có quyền xem.`
                };
            } catch (_) { }
        }
        return { error: errMsg };
    }
}
