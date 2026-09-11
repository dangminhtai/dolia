import fs from 'fs';
import { Events } from 'discord.js';
import GeminiManager from '../../class/GeminiManager.js';
import { t } from '../../services/i18nService.js';

export default (client) => {
    client.on(Events.MessageCreate, async (message) => {
        // 1. Validate
        if (message.author.bot) return;

        // 1.5 Handle DM
        if (message.channel.type === 1) { // 1 = ChannelType.DM
            return message.reply(t('common.dm_not_supported'));
        }

        if (message.channel.name !== 'dolia') return; // Chỉ chat trong kênh 'dolia'

        // Typing keep-alive: Discord typing indicator tự hết hạn sau ~9s
        await message.channel.sendTyping().catch(() => {});
        const typingInterval = setInterval(() => {
            message.channel.sendTyping().catch(() => {});
        }, 7000);

        // 2. Chat with Gemini
        try {
            const response = await GeminiManager.chat(message);

            // 3. Reply - Luôn đảm bảo phản hồi người dùng, không bao giờ im lặng
            let textToReply = '';
            let filesToAttach = [];

            if (typeof response === 'object' && response !== null) {
                if (response.alreadySent) {
                    // Script đã tự gửi file hoặc thông báo vào kênh chat rồi -> không gửi thêm tin nhắn trùng lặp
                    return;
                }
                textToReply = (response.reply || response.text || '').trim();
                if (Array.isArray(response.files)) {
                    filesToAttach = response.files.filter(f => typeof f === 'string' && fs.existsSync(f));
                }
            } else if (typeof response === 'string') {
                textToReply = response.trim();
            }

            if (!textToReply && filesToAttach.length === 0) {
                textToReply = t('common.chat_empty_fallback') || 'Dolia đã ghi nhận yêu cầu của chủ nhân rồi nha! ✨💖';
            }

            const sendResponse = async (content, files = []) => {
                const payload = { content };
                if (files && files.length > 0) {
                    payload.files = files;
                }
                try {
                    return await message.reply(payload);
                } catch (replyErr) {
                    // Nếu tin nhắn gốc đã bị xóa (ví dụ do lệnh xóa bulk delete), gửi trực tiếp vào kênh
                    return await message.channel.send(payload).catch(() => {});
                }
            };

            if (textToReply.length > 2000) {
                const chunks = textToReply.match(/[\s\S]{1,2000}/g) || [];
                for (let i = 0; i < chunks.length; i++) {
                    await sendResponse(chunks[i], i === 0 ? filesToAttach : []);
                }
            } else {
                await sendResponse(textToReply, filesToAttach);
            }
        } catch (error) {
            console.error('Gemini Chat Error:', error);
            const errMsg = t('common.chat_error') || 'Dolia đang gặp một chút trục trặc kết nối, bạn thử lại sau giây lát nha!';
            await message.channel.send(errMsg).catch(() => {});
        } finally {
            clearInterval(typingInterval);
        }
    });
};
