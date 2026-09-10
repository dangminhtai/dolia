import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { pathToFileURL } from 'url';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } from 'discord.js';
import { GoogleGenAI } from '@google/genai';
import ApiKeyManager from '../class/apiKeyManager.js';
import Logger from '../class/Logger.js';
import { reloadI18n, t } from './i18nService.js';
import { loadCommands, deployCommands } from '../deployCommands.js';
import geminiModelService from './geminiModelService.js';
import {
    sandboxManager,
    sandboxValidator,
    manifestManager,
    applyEngine,
    mappingRegistry
} from '../core/sandbox/index.js';

const execPromise = promisify(exec);

const OWNER_ID = process.env.OWNER_ID || '1149477475001323540';

// Lưu trữ các session đang chờ chủ nhân duyệt
const pendingSessions = new Map();

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

        // Gửi Embed thông báo nhẹ nhàng theo đúng phong cách Dolia (xưng mình - bạn)
        const statusEmbed = new EmbedBuilder()
            .setColor(0x5DADE2)
            .setTitle('✨ Dolia đang chuẩn bị tính năng mới nè...')
            .setDescription(`Bạn đợi mình một chút nha, mình đang chuẩn bị lệnh **\`/${safeSlug}\`** đây nè! 🌊🫧`)
            .setTimestamp();

        let progressMsg;
        if (replyTarget && replyTarget.deferred) {
            progressMsg = await replyTarget.editReply({ embeds: [statusEmbed] });
        } else if (replyTarget) {
            progressMsg = await replyTarget.reply({ embeds: [statusEmbed] });
        } else {
            progressMsg = await channel.send({ embeds: [statusEmbed] });
        }

        try {
            const MAX_RETRIES = 3;
            let attempt = 0;
            let generatedData = null;
            let usedModel = null;
            let commandName = safeSlug;
            let lastValidationErrors = [];

            // Lấy model Gemini tốt nhất từ Database (Ưu tiên flash-lite trước rồi đến flash)
            const codingModelId = await geminiModelService.getActiveModel('flash-lite');

            while (attempt < MAX_RETRIES) {
                attempt++;

                // Nếu là lần thử lại do phát hiện lỗi -> cập nhật thông báo nhẹ nhàng đáng yêu
                if (attempt > 1) {
                    const fixEmbed = new EmbedBuilder()
                        .setColor(0xF39C12)
                        .setTitle('✨ Ấy da, mình xin lỗi nhé! 🥺')
                        .setDescription(`Có vẻ như mình gặp chút trục trặc nhỏ khi chuẩn bị lệnh **\`/${commandName}\`**.\n` +
                            `Bạn đợi một xíu nha, mình đang tự chỉnh lại cho thật mượt mà ngay đây nè! 🫧✨`)
                        .setTimestamp();
                    await progressMsg.edit({ embeds: [fixEmbed] }).catch(() => { });
                }

                // Bước 1: Chuẩn bị file và gọi Gemini Coding Model (kèm feedback lỗi nếu retry)
                const feedback = lastValidationErrors.length > 0 ? lastValidationErrors.join('\n') : null;
                const prevCode = generatedData?.files?.[0]?.content || null;

                const result = await this.callGeminiCodingModel(prompt, safeSlug, codingModelId, feedback, prevCode);
                generatedData = result.data;
                usedModel = result.usedModel;
                commandName = generatedData.command_name || safeSlug;

                // Bước 2: Ghi các file được sinh vào Sandbox (CHỈ LƯU TRONG SANDBOX, KHÔNG LƯU VÀO CODE CHÍNH)
                for (const fileObj of generatedData.files) {
                    await sandboxManager.writeFile(fileObj.path, fileObj.content);
                }

                // Ghi file i18n vào sandbox nếu có
                if (generatedData.i18n && generatedData.i18n.translations) {
                    const i18nRelPath = `i18n/${commandName}.json`;
                    await sandboxManager.writeFile(i18nRelPath, JSON.stringify(generatedData.i18n.translations, null, 4));
                }

                // Bước 3: Kiểm tra tính toàn vẹn của các file vừa tạo trong Sandbox
                const filesToValidate = [
                    path.join(sandboxManager.sandboxDir, 'slash', `${commandName}.js`),
                    ...(generatedData.i18n && generatedData.i18n.translations ? [path.join(sandboxManager.sandboxDir, 'i18n', `${commandName}.json`)] : [])
                ];
                const validationResults = await sandboxValidator.validateBatch(filesToValidate);
                if (validationResults.valid) {
                    lastValidationErrors = [];
                    break; // Vượt qua kiểm thử 100%, sẵn sàng chạy trực tiếp từ Sandbox!
                } else {
                    lastValidationErrors = validationResults.errors;
                    Logger.warn(`[SelfDev] ⚠️ Kiểm thử Sandbox lượt ${attempt} thất bại: ${lastValidationErrors.join('; ')}`);
                }
            }

            if (lastValidationErrors.length > 0) {
                throw new Error(`Kiểm thử chất lượng trong Sandbox chưa đạt chuẩn sau ${MAX_RETRIES} lần tự sửa:\n${lastValidationErrors.join('\n')}`);
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
                }
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
                            return await progressMsg.delete().catch(() => {});
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

        } catch (error) {
            Logger.error(`[SelfDev] Error in session ${sessionId}:`, error);

            // Dọn dẹp sandbox nếu có lỗi
            try {
                sandboxManager.cleanSandbox();
            } catch (_) { }

            const errorEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('Ấy da, có chút trục trặc nhỏ rồi... 🥺')
                .setDescription(`Trong lúc hoàn thiện lệnh **\`/${safeSlug}\`**, mình gặp chút khó khăn nên chưa xong được nè.\nBạn cho mình thử lại sau nha! 🫧`)
                .setTimestamp();

            await progressMsg.edit({ embeds: [errorEmbed], components: [] }).catch(() => { });
        }
    }

    /**
     * Gọi Gemini Coding Model từ Database (Ưu tiên Flash-Lite trước rồi đến Flash)
     */
    static async callGeminiCodingModel(userPrompt, suggestedName, preferredModelId = null, errorFeedback = null, previousCode = null) {
        const candidates = await geminiModelService.getCandidateModels('flash-lite');
        if (preferredModelId && !candidates.includes(preferredModelId)) {
            candidates.unshift(preferredModelId);
        }

        let lastError = null;

        for (const modelId of candidates) {
            try {
                Logger.info(`[SelfDev] 🧠 Đang gọi Gemini Coding Model (${modelId}) cho tính năng: "${suggestedName}"...`);

                const systemInstruction = `
Bạn là Senior Discord Bot Developer cho bot Dolia (Node.js, Discord.js v14, ESM module).
Nhiệm vụ của bạn là lập trình tính năng/lệnh mới theo yêu cầu của người dùng, hoạt động trong kiến trúc Sandbox an toàn.

YÊU CẦU MÃ NGUỒN (SANDBOX ARCHITECTURE):
1. Mã nguồn của lệnh slash command chuẩn Discord.js v14 tại đường dẫn: slash/${suggestedName}.js
2. Cấu trúc lệnh bắt buộc (ESM):
\`\`\`javascript
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import { t } from '../../services/i18nService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('${suggestedName}')
        .setDescription('Mô tả ngắn gọn bằng tiếng Việt')
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),
    async execute(interaction) {
        // Luôn hỗ trợ chạy tự động: ưu tiên interaction.deferReply() và interaction.editReply()
        // Luôn có giá trị fallback cho options nếu không được cung cấp (ví dụ: interaction.options?.getUser('target') || interaction.user)
        // Thiết kế giao diện Embed + ActionRowBuilder (Buttons/Menu) đẹp mắt, có ComponentCollector lắng nghe sự kiện tương tác
    }
};
\`\`\`
3. Nếu cần chuỗi văn bản i18n, cung cấp định nghĩa i18n trong trường "i18n" của JSON.
4. Tuyệt đối KHÔNG import các module không có sẵn trong package.json hoặc các file ngoài phạm vi.
5. Code phải hoàn toàn sạch sẽ, KHÔNG có placeholder dạng "TODO", code phải chạy được ngay lập tức.

ĐỊNH DẠNG TRẢ VỀ (BẮT BUỘC TRẢ VỀ DUY NHẤT ĐỊNH DẠNG JSON):
{
  "command_name": "${suggestedName}",
  "summary": "Mô tả tóm tắt tính năng và cách dùng",
  "files": [
    {
      "path": "slash/${suggestedName}.js",
      "content": "/* Toàn bộ mã nguồn code đầy đủ của file command */"
    }
  ],
  "i18n": {
    "key_group": "${suggestedName}",
    "translations": {
      "title": "...",
      "desc": "..."
    }
  }
}
`;

                let promptContent = `Lập trình tính năng sau cho Dolia: ${userPrompt}. Tên lệnh gợi ý: ${suggestedName}. Hãy viết code thật chất lượng và trả về định dạng JSON đúng chuẩn.`;
                if (errorFeedback && previousCode) {
                    promptContent += `\n\n[LƯU Ý SỬA LỖI TỰ ĐỘNG]: Lần sinh mã trước gặp lỗi kiểm thử sau:\n${errorFeedback}\n\nMã nguồn bị lỗi trước đó:\n\`\`\`javascript\n${previousCode}\n\`\`\`\nHãy phân tích nguyên nhân lỗi và sinh lại mã nguồn hoàn chỉnh, sửa triệt để tất cả các lỗi trên!`;
                }

                const outputText = await ApiKeyManager.execute(modelId, async (apiKey) => {
                    const ai = new GoogleGenAI({ apiKey });
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
     * Thiết lập collector lắng nghe nút bấm từ Owner trên Discord
     */
    static setupCollector(message, sessionData) {
        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 10 * 60 * 1000 // 10 phút
        });

        collector.on('collect', async (i) => {
            // Chỉ Owner mới được bấm
            if (i.user.id !== sessionData.userId) {
                return i.reply({ content: 'Chỉ có chủ nhân yêu cầu mới có quyền duyệt tính năng này!', flags: MessageFlags.Ephemeral });
            }

            const { customId } = i;

            // 1. DUYỆT & APPLY TỪ SANDBOX VÀO PRODUCTION
            if (customId === `selfdev_approve_${sessionData.sessionId}`) {
                await i.deferUpdate();

                try {
                    Logger.info(`[SelfDev] 🚀 Bắt đầu Apply từ Sandbox cho session: ${sessionData.sessionId}`);

                    // Thực thi ApplyEngine với kiểm tra quyền duyệt
                    const applyResult = await applyEngine.apply(sessionData.proposedManifest, {
                        isApproved: true,
                        approvedBy: i.user.id
                    });

                    // Tùy chọn git commit audit trên repo chính
                    try {
                        await execPromise('git add .');
                        await execPromise(`git commit -m "feat(auto): apply /${sessionData.commandName} via Sandbox Apply Engine [tx: ${applyResult.transactionId}]"`);
                    } catch (_) { }

                    // Dọn dẹp sandbox sau khi apply thành công
                    await sandboxManager.cleanSandbox();

                    // Chuyển giao diện sang READY_FOR_RELOAD với hai nút riêng biệt (Hot-Reload & Deploy)
                    const readyEmbed = new EmbedBuilder()
                        .setColor(0x3498DB)
                        .setTitle(`📦 Apply hoàn tất! Sẵn sàng nạp lệnh`)
                        .setDescription(
                            `Chủ nhân <@${sessionData.userId}> ơi, mã nguồn đã được chuyển giao an toàn từ **Sandbox** sang **Production**!\n\n` +
                            `🆔 **Transaction ID:** \`${applyResult.transactionId}\`\n` +
                            `💾 **Audit & Backup:** \`.apply/${applyResult.transactionId}/\`\n` +
                            `📁 **Các file đã áp dụng:**\n` +
                            applyResult.appliedFiles.map(f => `• \`${f.target}\` (${f.action})`).join('\n') +
                            `\n\n👉 **Bước tiếp theo:** Chủ nhân hãy chọn nạp vào RAM hoặc deploy slash command:`
                        )
                        .setFooter({ text: 'Bước Apply đã hoàn tất! Chủ nhân có thể thử ngay bằng Hot-Reload.' })
                        .setTimestamp();

                    const reloadRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`selfdev_reload_${sessionData.sessionId}`)
                            .setLabel('⚡ Nạp lệnh (Hot-Reload)')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`selfdev_deploy_${sessionData.sessionId}`)
                            .setLabel('🚀 Deploy Slash Command')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`selfdev_done_${sessionData.sessionId}`)
                            .setLabel('✅ Hoàn tất')
                            .setStyle(ButtonStyle.Secondary)
                    );

                    await message.edit({ embeds: [readyEmbed], components: [reloadRow] });

                } catch (applyErr) {
                    Logger.error(`[SelfDev] ❌ Apply thất bại cho session ${sessionData.sessionId}:`, applyErr);

                    const errEmbed = new EmbedBuilder()
                        .setColor(0xE74C3C)
                        .setTitle('❌ Apply thất bại (Đã Rollback an toàn)')
                        .setDescription(`Quá trình Apply đã bị hủy và hệ thống đã tự động Rollback về trạng thái ban đầu:\n\`\`\`${applyErr.message}\`\`\``)
                        .setTimestamp();

                    await message.edit({ embeds: [errEmbed], components: [] });
                    sandboxManager.cleanSandbox();
                    pendingSessions.delete(sessionData.sessionId);
                    collector.stop('apply_failed');
                }

            // 2. XEM CODE & MANIFEST CHI TIẾT
            } else if (customId === `selfdev_view_${sessionData.sessionId}`) {
                const firstFile = sessionData.generatedData.files[0];
                const codeSnippet = firstFile ? firstFile.content : 'Không tìm thấy nội dung file.';
                const truncatedCode = codeSnippet.length > 1700 ? codeSnippet.substring(0, 1700) + '\n// ... (đã rút gọn)' : codeSnippet;

                await i.reply({
                    content: `📄 **Mã nguồn đề xuất: \`${firstFile?.path || 'slash/command.js'}\`**\n\`\`\`javascript\n${truncatedCode}\n\`\`\`\n` +
                             `📋 **Manifest Changes:**\n\`\`\`json\n${JSON.stringify(sessionData.proposedManifest.changes, null, 2)}\n\`\`\``,
                    flags: MessageFlags.Ephemeral
                });

            // 3. HỦY BỎ PHIÊN TẠI GIAI ĐOẠN PENDING_APPROVAL
            } else if (customId === `selfdev_cancel_${sessionData.sessionId}`) {
                await i.deferUpdate();
                collector.stop('cancelled');
                await this.applyCancel(sessionData);

            // 4. HOT-RELOAD VÀO BỘ NHỚ RAM CỦA BOT
            } else if (customId === `selfdev_reload_${sessionData.sessionId}`) {
                await i.deferUpdate();

                const commandPath = path.join(process.cwd(), 'commands', 'slash', `${sessionData.commandName}.js`);
                let reloadOk = false;
                let errMsg = '';

                if (fs.existsSync(commandPath)) {
                    try {
                        const moduleUrl = pathToFileURL(commandPath).href + `?t=${Date.now()}`;
                        const importedModule = await import(moduleUrl);
                        const cmd = importedModule.default ?? importedModule;
                        if (cmd && cmd.data) {
                            sessionData.client.commands.set(cmd.data.name, cmd);
                            reloadOk = true;
                            Logger.info(`[SelfDev] Successfully hot-reloaded command: /${cmd.data.name}`);
                        }
                    } catch (e) {
                        errMsg = e.message;
                    }
                }

                // Nạp lại i18n
                reloadI18n();

                if (reloadOk) {
                    await i.followUp({
                        content: `⚡ **Hot-Reload thành công!** Đã nạp lệnh **\`/${sessionData.commandName}\`** vào RAM và làm mới i18n. Bạn có thể test ngay!`,
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    await i.followUp({
                        content: `❌ Hot-Reload thất bại: ${errMsg || 'Không tìm thấy file lệnh đã apply'}`,
                        flags: MessageFlags.Ephemeral
                    });
                }

            // 5. DEPLOY SLASH COMMAND LÊN DISCORD REST API
            } else if (customId === `selfdev_deploy_${sessionData.sessionId}`) {
                await i.deferUpdate();

                try {
                    const loadResult = await loadCommands(path.join(process.cwd(), 'commands'), sessionData.client);
                    await deployCommands(loadResult);
                    Logger.info(`[SelfDev] Successfully deployed slash commands to Discord REST API`);

                    await i.followUp({
                        content: `🚀 **Deploy thành công!** Đã đồng bộ đăng ký lệnh **\`/${sessionData.commandName}\`** lên Discord REST API!`,
                        flags: MessageFlags.Ephemeral
                    });
                } catch (e) {
                    await i.followUp({
                        content: `❌ Deploy thất bại: ${e.message}`,
                        flags: MessageFlags.Ephemeral
                    });
                }

            // 6. HOÀN TẤT PHIÊN SAU KHI ĐÃ RELOAD / DEPLOY
            } else if (customId === `selfdev_done_${sessionData.sessionId}`) {
                await i.deferUpdate();
                collector.stop('completed');
                sandboxManager.cleanSandbox();
                pendingSessions.delete(sessionData.sessionId);

                const doneEmbed = new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setTitle('🎉 Phiên phát triển tính năng hoàn tất!')
                    .setDescription(`Lệnh **\`/${sessionData.commandName}\`** đã sẵn sàng phục vụ server. Cảm ơn chủ nhân <@${sessionData.userId}>!`)
                    .setTimestamp();

                await message.edit({ embeds: [doneEmbed], components: [] });
            }
        });

        collector.on('end', async (_, reason) => {
            if (reason === 'time') {
                await this.applyCancel(sessionData, 'Hết hạn thời gian chờ duyệt (10 phút).');
            }
        });
    }

    /**
     * Hủy bỏ session và dọn dẹp sandbox an toàn
     */
    static async applyCancel(sessionData, reasonText = null) {
        const { progressMsg, sessionId } = sessionData;

        try {
            await sandboxManager.cleanSandbox();
        } catch (_) { }

        const cancelEmbed = new EmbedBuilder()
            .setColor(0x95A5A6)
            .setTitle('⏹️ Đã hủy bỏ phiên Self-Dev')
            .setDescription(reasonText || 'Bản thảo tính năng đã được hủy bỏ và môi trường Sandbox được dọn dẹp an toàn.')
            .setTimestamp();

        await progressMsg.edit({ embeds: [cancelEmbed], components: [] }).catch(() => { });
        pendingSessions.delete(sessionId);
    }

    /**
     * Bắt đầu phiên yêu cầu xóa lệnh/tính năng với nút bấm xác nhận an toàn
     */
    static async startDeleteSession({ prompt, featureName, user, channel, client, replyTarget = null }) {
        if (!this.isOwner(user.id)) {
            const rejectMsg = t('self_dev.only_owner') || 'Chỉ có chủ nhân mới có thể yêu cầu mình gỡ bỏ tính năng nha!';
            if (replyTarget) return replyTarget.reply({ content: rejectMsg, flags: MessageFlags.Ephemeral });
            return channel.send({ content: rejectMsg });
        }

        const slashDir = path.join(process.cwd(), 'commands', 'slash');
        const existingFiles = fs.existsSync(slashDir) ? fs.readdirSync(slashDir).filter(f => f.endsWith('.js')) : [];
        const existingCommands = existingFiles.map(f => f.replace('.js', ''));

        // Từ điển từ khóa thông dụng để nhận diện đúng lệnh cần xóa
        const COMMAND_KEYWORDS = {
            dice: ['xúc xắc', 'xúc sắc', 'xuc xac', 'xuc sac', 'xí ngầu', 'xi ngau', 'dice', 'roll', 'xuc'],
            tictactoe: ['caro', 'cờ caro', 'tic tac toe', 'tictactoe', 'xo'],
            coinflip: ['đồng xu', 'dong xu', 'tung xu', 'coin', 'flip', 'coinflip'],
            userinfo: ['thông tin user', 'userinfo', 'user info', 'thông tin người dùng', 'thong tin user'],
            trivia: ['trivia', 'đố vui', 'do vui', 'câu đố', 'cau do']
        };

        // Tìm tên lệnh cần xóa
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

        const targetFile = targetName ? path.join(slashDir, `${targetName}.js`) : null;
        const fileExists = targetFile && fs.existsSync(targetFile);

        if (!fileExists) {
            const notFoundEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('🔍 Không tìm thấy lệnh cần gỡ nè')
                .setDescription(`Mình không tìm thấy lệnh nào tên là **\`${targetName || featureName || prompt}\`** hết trơn á.\n\n` +
                    `📋 **Danh sách các lệnh hiện có:**\n` +
                    (existingCommands.length > 0 ? existingCommands.map(c => `\`/${c}\``).join(', ') : '*Chưa có lệnh nào*'))
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
            const legacyCmd = path.join(process.cwd(), 'commands', 'slash', `${targetName}.js`);
            const legacyI18n = path.join(process.cwd(), 'resources', 'vi', `${targetName}.json`);
            const sandboxBackupDir = path.join(process.cwd(), 'sandbox', 'backup');

            if (!fs.existsSync(sandboxBackupDir)) {
                fs.mkdirSync(sandboxBackupDir, { recursive: true });
            }

            // Sao lưu và xóa file lệnh (.js)
            const sourceCmd = fs.existsSync(sandboxCmd) ? sandboxCmd : (fs.existsSync(legacyCmd) ? legacyCmd : null);
            if (sourceCmd) {
                fs.copyFileSync(sourceCmd, path.join(sandboxBackupDir, `${targetName}.js.bak`));
            }
            if (fs.existsSync(sandboxCmd)) fs.rmSync(sandboxCmd, { force: true });
            if (fs.existsSync(legacyCmd)) fs.rmSync(legacyCmd, { force: true });

            // Sao lưu và xóa file i18n (.json)
            const sourceI18n = fs.existsSync(sandboxI18n) ? sandboxI18n : (fs.existsSync(legacyI18n) ? legacyI18n : null);
            if (sourceI18n) {
                fs.copyFileSync(sourceI18n, path.join(sandboxBackupDir, `${targetName}.json.bak`));
            }
            if (fs.existsSync(sandboxI18n)) fs.rmSync(sandboxI18n, { force: true });
            if (fs.existsSync(legacyI18n)) fs.rmSync(legacyI18n, { force: true });

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

            await confirmMsg.edit({ embeds: [successEmbed], components: [] });

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
            await confirmMsg.edit({ embeds: [errEmbed], components: [] });
        }
    }
}
