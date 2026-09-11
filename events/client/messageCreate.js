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
            const textToReply = (response && response.trim())
                ? response.trim()
                : (t('common.chat_empty_fallback') || 'Dolia đã ghi nhận yêu cầu của chủ nhân rồi nha! ✨💖');

            const sendResponse = async (content) => {
                try {
                    return await message.reply(content);
                } catch (replyErr) {
                    // Nếu tin nhắn gốc đã bị xóa (ví dụ do lệnh xóa bulk delete), gửi trực tiếp vào kênh
                    return await message.channel.send(content).catch(() => {});
                }
            };

            if (textToReply.length > 2000) {
                const chunks = textToReply.match(/[\s\S]{1,2000}/g) || [];
                for (const chunk of chunks) {
                    await sendResponse(chunk);
                }
            } else {
                await sendResponse(textToReply);
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
