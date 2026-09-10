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

const execPromise = promisify(exec);

const OWNER_ID = process.env.OWNER_ID || '1149477475001323540';
const WORKTREE_BASE = path.join(process.cwd(), '.worktrees');

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
     * Bắt đầu một phiên Self-Dev từ yêu cầu của người dùng
     */
    static async startSession({ prompt, featureName, user, channel, client, replyTarget = null }) {
        if (!this.isOwner(user.id)) {
            const rejectMsg = t('self_dev.only_owner') || 'Chỉ có chủ nhân của Dolia mới có quyền yêu cầu tự lập trình tính năng mới nha!';
            if (replyTarget) await replyTarget.reply(rejectMsg);
            else await channel.send(rejectMsg);
            return;
        }

        const safeSlug = this.slugify(featureName || prompt.split(' ')[0]);
        const sessionId = `dev_${safeSlug}_${Date.now()}`;
        const branchName = `self-dev/${safeSlug}`;
        const worktreeDir = path.join(WORKTREE_BASE, safeSlug);

        // Gửi Embed thông báo tiến trình ban đầu
        const statusEmbed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('🛠️ Dolia Self-Dev Agent: Khởi động')
            .setDescription(`**Chủ nhân:** <@${user.id}>\n**Yêu cầu:** ${prompt}\n\n⏳ **Trạng thái:** Đang khởi tạo môi trường thử nghiệm độc lập (Git Worktree)...`)
            .setFooter({ text: `Session ID: ${sessionId} • Gemini Developer Agent` })
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
            // Lấy model Gemini tốt nhất từ Database (Ưu tiên flash)
            const codingModelId = await geminiModelService.getActiveModel('flash');

            // Bước 1: Khởi tạo Git Worktree
            if (!fs.existsSync(WORKTREE_BASE)) {
                fs.mkdirSync(WORKTREE_BASE, { recursive: true });
            }

            // Dọn dẹp nếu worktree cũ còn sót lại
            if (fs.existsSync(worktreeDir)) {
                try {
                    await execPromise(`git worktree remove --force "${worktreeDir}"`);
                } catch (_) {
                    fs.rmSync(worktreeDir, { recursive: true, force: true });
                }
            }
            try {
                await execPromise(`git branch -D "${branchName}"`);
            } catch (_) { }

            // Tạo worktree mới từ HEAD
            await execPromise(`git worktree add "${worktreeDir}" -b "${branchName}"`);
            Logger.info(`[SelfDev] Created worktree at ${worktreeDir} with branch ${branchName}`);

            // Cập nhật tiến trình
            statusEmbed.setDescription(`**Chủ nhân:** <@${user.id}>\n**Yêu cầu:** ${prompt}\n\n🧠 **Trạng thái:** Đang kết nối Gemini Coding Agent (\`${codingModelId}\`)...\n*Model đang lên kế hoạch, viết code Discord.js v14 và cấu trúc i18n...*`);
            statusEmbed.setFooter({ text: `Session ID: ${sessionId} • Model: ${codingModelId}` });
            await progressMsg.edit({ embeds: [statusEmbed] }).catch(() => { });

            // Bước 2: Gọi Gemini Coding Model (ưu tiên flash)
            const { data: generatedData, usedModel } = await this.callGeminiCodingModel(prompt, safeSlug, codingModelId);

            // Cập nhật tiến trình
            statusEmbed.setDescription(`**Chủ nhân:** <@${user.id}>\n**Yêu cầu:** ${prompt}\n\n🧪 **Trạng thái:** Đã sinh mã nguồn xong bởi \`${usedModel}\`! Đang áp dụng vào Worktree và kiểm tra cú pháp (node -c)...`);
            statusEmbed.setFooter({ text: `Session ID: ${sessionId} • Model: ${usedModel}` });
            await progressMsg.edit({ embeds: [statusEmbed] }).catch(() => { });

            // Bước 3: Áp dụng vào Worktree & Kiểm tra cú pháp
            const validatedFiles = await this.applyAndValidateCode(worktreeDir, generatedData);

            // Bước 4: Chuẩn bị giao diện Review & Nút bấm
            const reviewEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('✨ Tính năng mới đã hoàn thành & Sẵn sàng duyệt!')
                .setDescription(`Chủ nhân <@${user.id}> ơi, Dolia đã lập trình xong tính năng **/${generatedData.command_name || safeSlug}** trên môi trường thử nghiệm an toàn.\n\n` +
                    `🤖 **Model xử lý:** \`${usedModel}\` (Gemini Flash Database)\n` +
                    `📝 **Tóm tắt tính năng:**\n${generatedData.summary || prompt}\n\n` +
                    `📁 **Các file được tạo / cập nhật:**\n` +
                    validatedFiles.map(f => `• \`${f.relativePath}\` (${f.status})`).join('\n') +
                    `\n\n🛡️ **Kiểm thử cú pháp:** ✅ Pass 100% không có lỗi Syntax.`)
                .setFooter({ text: `Nhấn 'Duyệt & Nạp' để merge và nạp lệnh ngay mà không tắt bot!` })
                .setTimestamp();

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`selfdev_merge_${sessionId}`)
                    .setLabel('✅ Duyệt & Nạp lệnh')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`selfdev_diff_${sessionId}`)
                    .setLabel('🔍 Xem Code')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`selfdev_cancel_${sessionId}`)
                    .setLabel('❌ Hủy bỏ')
                    .setStyle(ButtonStyle.Danger)
            );

            await progressMsg.edit({ embeds: [reviewEmbed], components: [actionRow] });

            // Lưu phiên vào RAM
            const sessionData = {
                sessionId,
                userId: user.id,
                branchName,
                worktreeDir,
                commandName: generatedData.command_name || safeSlug,
                generatedData,
                validatedFiles,
                progressMsg,
                client
            };
            pendingSessions.set(sessionId, sessionData);

            // Lắng nghe sự kiện bấm nút từ Owner (Hạn 10 phút)
            this.setupCollector(progressMsg, sessionData);

        } catch (error) {
            Logger.error(`[SelfDev] Error in session ${sessionId}:`, error);

            // Dọn dẹp nếu có lỗi
            try {
                if (fs.existsSync(worktreeDir)) {
                    await execPromise(`git worktree remove --force "${worktreeDir}"`);
                }
                await execPromise(`git branch -D "${branchName}"`);
            } catch (_) { }

            const errorEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('❌ Quá trình Self-Dev gặp lỗi')
                .setDescription(`Rất tiếc chủ nhân, Dolia không thể hoàn thành tác vụ tự lập trình này.\n\n**Chi tiết lỗi:**\n\`\`\`${error.message || error}\`\`\``)
                .setTimestamp();

            await progressMsg.edit({ embeds: [errorEmbed], components: [] }).catch(() => { });
        }
    }

    /**
     * Gọi Gemini Coding Model từ Database (Ưu tiên Flash)
     * Tự động thử các model Flash trong Database theo thứ tự ưu tiên nếu gặp lỗi tải cao (503/429)
     */
    static async callGeminiCodingModel(userPrompt, suggestedName, preferredModelId = null) {
        const candidates = await geminiModelService.getCandidateModels('flash');
        if (preferredModelId && !candidates.includes(preferredModelId)) {
            candidates.unshift(preferredModelId);
        }

        let lastError = null;

        for (const modelId of candidates) {
            try {
                Logger.info(`[SelfDev] 🧠 Đang gọi Gemini Coding Model (${modelId}) cho tính năng: "${suggestedName}"...`);

                const result = await ApiKeyManager.execute(modelId, async (apiKey) => {
                    const ai = new GoogleGenAI({ apiKey });

                    const systemInstruction = `
Bạn là Senior Discord Bot Developer cho bot Dolia (Node.js, Discord.js v14, ESM module).
Nhiệm vụ của bạn là lập trình tính năng/lệnh mới theo yêu cầu của người dùng.

YÊU CẦU MÃ NGUỒN:
1. Tạo một lệnh slash command chuẩn Discord.js v14 tại: commands/slash/${suggestedName}.js
2. Cấu trúc lệnh bắt buộc:
\`\`\`javascript
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ApplicationIntegrationType, InteractionContextType } from 'discord.js';
import { t } from '../../services/i18nService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('${suggestedName}')
        .setDescription('Mô tả lệnh bằng tiếng Việt ngắn gọn')
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),
        // Thêm các option nếu cần
    async execute(interaction) {
        // Viết code logic hoàn chỉnh, đẹp mắt, có try/catch
        // Sử dụng EmbedBuilder màu sắc đẹp (ví dụ 0x3498DB)
        // Dùng interaction.reply hoặc interaction.deferReply nếu cần thời gian
    }
};
\`\`\`
3. Nếu cần i18n, chỉ định các key tiếng Việt cần thêm vào file resources/vi/common.json.
4. Code phải hoàn toàn sạch sẽ, KHÔNG có placeholder dạng "TODO" hay code giả lập, code phải chạy được ngay lập tức.

ĐỊNH DẠNG TRẢ VỀ (BẮT BUỘC TRẢ VỀ DUY NHẤT ĐỊNH DẠNG JSON):
{
  "command_name": "${suggestedName}",
  "summary": "Mô tả tóm tắt tính năng và cách dùng",
  "files": [
    {
      "path": "commands/slash/${suggestedName}.js",
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

                    const response = await ai.models.generateContent({
                        model: modelId,
                        contents: `Lập trình tính năng sau cho Dolia: ${userPrompt}. Tên lệnh gợi ý: ${suggestedName}. Hãy viết code thật chất lượng và trả về định dạng JSON đúng chuẩn.`,
                        config: {
                            systemInstruction: systemInstruction,
                            temperature: 0.2,
                            responseMimeType: "application/json"
                        }
                    });

                    const outputText = response.text || '';
                    Logger.info(`[SelfDev] ✅ Gemini Coding Model (${modelId}) đã phản hồi (${outputText.length} ký tự)!`);

                    const parsedData = SelfDevService.safeJsonParse(outputText);
                    return { data: this.normalizeGeneratedData(parsedData, suggestedName), usedModel: modelId };
                });

                geminiModelService.reportModelSuccess(modelId);
                return result;
            } catch (modelErr) {
                lastError = modelErr;
                geminiModelService.reportModelFailure(modelId, modelErr.message);
                Logger.warn(`[SelfDev] ⚠️ Model ${modelId} gặp sự cố: ${modelErr.message}. Tự động thử model Flash tiếp theo...`);
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

        // 1. Thử parse trực tiếp
        try {
            return JSON.parse(clean);
        } catch (firstErr) {
            // 2. Tìm block JSON từ { đầu tiên đến } cuối cùng
            const firstBrace = clean.indexOf('{');
            const lastBrace = clean.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                const sub = clean.substring(firstBrace, lastBrace + 1);
                try {
                    return JSON.parse(sub);
                } catch (_) {
                    // 3. Tự động sửa các escape không hợp lệ trong JSON (ví dụ \' hay \d hay \s trong code)
                    // Trong chuẩn JSON chỉ cho phép: \", \\, \/, \b, \f, \n, \r, \t, \uXXXX
                    // Thay thế các backslash đi trước ký tự không hợp lệ bằng double backslash \\
                    const fixed = sub.replace(/\\([^"\\/bfnrtu])/g, '\\\\$1');
                    try {
                        return JSON.parse(fixed);
                    } catch (finalErr) {
                        throw new Error(`Lỗi cú pháp JSON từ model AI: ${finalErr.message}`);
                    }
                }
            }
            throw new Error(`Không tìm thấy khối JSON hợp lệ trong phản hồi của AI: ${firstErr.message}`);
        }
    }

    /**
     * Chuẩn hóa dữ liệu trả về từ Gemini Coding Agent
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
                path: `commands/slash/${fileName}`,
                content: parsedData.code
            }];
        }

        // Tự động chuẩn hóa sang ESM nếu Antigravity sinh dạng CommonJS
        for (const file of result.files) {
            if (file.path && file.path.endsWith('.js') && typeof file.content === 'string') {
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
     * Ghi code vào Worktree và kiểm tra cú pháp (node -c)
     */
    static async applyAndValidateCode(worktreeDir, generatedData) {
        const validatedFiles = [];

        if (!generatedData.files || !Array.isArray(generatedData.files)) {
            throw new Error("Dữ liệu Antigravity trả về không chứa danh sách file hợp lệ.");
        }

        for (const fileObj of generatedData.files) {
            const targetPath = path.join(worktreeDir, fileObj.path);
            const parentDir = path.dirname(targetPath);

            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }

            fs.writeFileSync(targetPath, fileObj.content, 'utf-8');

            // Kiểm tra syntax bằng node -c nếu là file .js
            if (fileObj.path.endsWith('.js')) {
                try {
                    await execPromise(`node -c "${targetPath}"`);
                    validatedFiles.push({ relativePath: fileObj.path, status: 'Cú pháp hợp lệ' });
                } catch (syntaxErr) {
                    throw new Error(`Lỗi cú pháp trong file ${fileObj.path}: ${syntaxErr.message}`);
                }
            } else {
                validatedFiles.push({ relativePath: fileObj.path, status: 'Đã lưu' });
            }
        }

        // Cập nhật i18n trong Worktree nếu có
        if (generatedData.i18n && generatedData.i18n.translations) {
            const i18nPath = path.join(worktreeDir, 'resources/vi/common.json');
            if (fs.existsSync(i18nPath)) {
                try {
                    const currentI18n = JSON.parse(fs.readFileSync(i18nPath, 'utf-8'));
                    const keyGroup = generatedData.i18n.key_group || generatedData.command_name;
                    currentI18n[keyGroup] = {
                        ...(currentI18n[keyGroup] || {}),
                        ...generatedData.i18n.translations
                    };
                    fs.writeFileSync(i18nPath, JSON.stringify(currentI18n, null, 4), 'utf-8');
                    validatedFiles.push({ relativePath: 'resources/vi/common.json', status: 'Đã nạp chuỗi dịch' });
                } catch (e) {
                    Logger.warn(`[SelfDev] Could not update i18n file in worktree: ${e.message}`);
                }
            }
        }

        return validatedFiles;
    }

    /**
     * Thiết lập collector lắng nghe nút bấm trên Discord
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

            if (customId === `selfdev_merge_${sessionData.sessionId}`) {
                await i.deferUpdate();
                collector.stop('merged');
                await this.applyMerge(sessionData);
            } else if (customId === `selfdev_diff_${sessionData.sessionId}`) {
                // Hiển thị code chi tiết qua ephemeral reply
                const firstFile = sessionData.generatedData.files[0];
                const codeSnippet = firstFile ? firstFile.content : 'Không tìm thấy nội dung file.';
                const truncatedCode = codeSnippet.length > 1900 ? codeSnippet.substring(0, 1900) + '\n// ... (đã rút gọn)' : codeSnippet;

                await i.reply({
                    content: `📄 **Mã nguồn: \`${firstFile?.path || 'code.js'}\`**\n\`\`\`javascript\n${truncatedCode}\n\`\`\``,
                    flags: MessageFlags.Ephemeral
                });
            } else if (customId === `selfdev_cancel_${sessionData.sessionId}`) {
                await i.deferUpdate();
                collector.stop('cancelled');
                await this.applyCancel(sessionData);
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                await this.applyCancel(sessionData, 'Hết hạn thời gian chờ duyệt (10 phút).');
            }
        });
    }

    /**
     * Nạp lệnh vào bot, cập nhật code và hot-reload
     */
    static async applyMerge(sessionData) {
        const { branchName, worktreeDir, commandName, progressMsg, client, generatedData } = sessionData;

        try {
            Logger.info(`[SelfDev] Đang nạp lệnh /${commandName} vào bot...`);

            // 1. Sao chép trực tiếp các file đã kiểm thử cú pháp từ Worktree vào thư mục chính của bot
            if (generatedData?.files && Array.isArray(generatedData.files)) {
                for (const fileObj of generatedData.files) {
                    const destPath = path.join(process.cwd(), fileObj.path);
                    const destDir = path.dirname(destPath);
                    if (!fs.existsSync(destDir)) {
                        fs.mkdirSync(destDir, { recursive: true });
                    }
                    fs.writeFileSync(destPath, fileObj.content, 'utf-8');
                    Logger.info(`[SelfDev] Đã lưu file: ${fileObj.path}`);
                }
            }

            // 2. Cập nhật chuỗi dịch i18n vào resources/vi/common.json của bot
            if (generatedData?.i18n?.translations) {
                const i18nPath = path.join(process.cwd(), 'resources/vi/common.json');
                if (fs.existsSync(i18nPath)) {
                    try {
                        const currentI18n = JSON.parse(fs.readFileSync(i18nPath, 'utf-8'));
                        const keyGroup = generatedData.i18n.key_group || commandName;
                        currentI18n[keyGroup] = {
                            ...(currentI18n[keyGroup] || {}),
                            ...generatedData.i18n.translations
                        };
                        fs.writeFileSync(i18nPath, JSON.stringify(currentI18n, null, 4), 'utf-8');
                        Logger.info(`[SelfDev] Đã nạp chuỗi i18n cho nhóm: ${keyGroup}`);
                    } catch (e) {
                        Logger.warn(`[SelfDev] Không thể nạp i18n vào common.json: ${e.message}`);
                    }
                }
            }

            // 3. Commit thay đổi vào Git của repo chính
            try {
                await execPromise(`git add .`);
                await execPromise(`git commit -m "feat(auto): implement /${commandName} via Gemini Coding Agent"`);
            } catch (gitErr) {
                Logger.warn(`[SelfDev] Git commit ghi chú: ${gitErr.message}`);
            }

            // 4. Dọn dẹp worktree và branch tạm
            try {
                await execPromise(`git worktree remove --force "${worktreeDir}"`);
            } catch (_) {
                if (fs.existsSync(worktreeDir)) {
                    fs.rmSync(worktreeDir, { recursive: true, force: true });
                }
            }
            try {
                await execPromise(`git branch -D "${branchName}"`);
            } catch (_) { }

            // 5. Nạp lại i18n trong bộ nhớ
            reloadI18n();

            // 6. Gửi Embed thành công lên Discord ngay để người dùng nhận được phản hồi tức thì
            const successEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('🎉 Tính năng đã được nạp thành công!')
                .setDescription(`Chủ nhân ơi, lệnh **/${commandName}** đã được nạp vào Dolia thành công!\n\n` +
                    `✨ **Cách thử nghiệm:**\n` +
                    `Hãy gõ thử lệnh **/${commandName}** trong máy chủ ngay bây giờ nhé!`)
                .setTimestamp();

            await progressMsg.edit({ embeds: [successEmbed], components: [] });
            pendingSessions.delete(sessionData.sessionId);

            // 7. Hot-reload command vào RAM
            const commandPath = path.join(process.cwd(), 'commands', 'slash', `${commandName}.js`);
            if (fs.existsSync(commandPath)) {
                const moduleUrl = pathToFileURL(commandPath).href + `?t=${Date.now()}`;
                const importedModule = await import(moduleUrl);
                const cmd = importedModule.default ?? importedModule;
                if (cmd && cmd.data) {
                    client.commands.set(cmd.data.name, cmd);
                    Logger.info(`[SelfDev] Successfully hot-reloaded command: /${cmd.data.name}`);
                }
            }

            // 8. Đồng bộ deploy slash commands lên Discord REST API
            const loadResult = await loadCommands(path.join(process.cwd(), 'commands'), client);
            await deployCommands(loadResult);

        } catch (mergeErr) {
            Logger.error('[SelfDev] Merge/Hot-reload failed:', mergeErr);
            const errEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('❌ Lỗi khi áp dụng bản mã nguồn')
                .setDescription(`Không thể hoàn tất quá trình merge/hot-reload:\n\`\`\`${mergeErr.message}\`\`\``)
                .setTimestamp();

            await progressMsg.edit({ embeds: [errEmbed], components: [] });
        }
    }

    /**
     * Hủy bỏ session và dọn dẹp worktree an toàn
     */
    static async applyCancel(sessionData, reasonText = null) {
        const { branchName, worktreeDir, progressMsg, sessionId } = sessionData;

        try {
            if (fs.existsSync(worktreeDir)) {
                await execPromise(`git worktree remove --force "${worktreeDir}"`);
            }
            await execPromise(`git branch -D "${branchName}"`);
        } catch (_) { }

        const cancelEmbed = new EmbedBuilder()
            .setColor(0x95A5A6)
            .setTitle('⏹️ Đã hủy bỏ phiên Self-Dev')
            .setDescription(reasonText || 'Bản thảo tính năng đã được hủy bỏ và môi trường sandbox được dọn dẹp an toàn.')
            .setTimestamp();

        await progressMsg.edit({ embeds: [cancelEmbed], components: [] }).catch(() => { });
        pendingSessions.delete(sessionId);
    }
}
