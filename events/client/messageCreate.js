import { Events } from 'discord.js';
import GeminiManager from '../../class/GeminiManager.js';

export default (client) => {
    client.on(Events.MessageCreate, async (message) => {
        // 1. Validate
        if (message.author.bot) return;

        // 1.5 Handle DM
        if (message.channel.type === 1) { // 1 = ChannelType.DM
            return message.reply('Bot chưa được phát triển ở DM để nhắn tin, vui lòng thử lại sau');
        }

        if (message.channel.name !== 'dolia') return; // Chỉ chat trong kênh 'dolia'

        await message.channel.sendTyping();

        // 2. Chat with Gemini
        try {
            const response = await GeminiManager.chat(message);

            // 3. Reply
            if (response) {
                // Split long messages
                if (response.length > 2000) {
                    const chunks = response.match(/[\s\S]{1,2000}/g) || [];
                    for (const chunk of chunks) {
                        await message.reply(chunk);
                    }
                } else {
                    await message.reply(response);
                }
            }
        } catch (error) {
            console.error('Gemini Chat Error:', error);
            await message.reply('❌ Dolia đang bị đau đầu, thử lại sau nhé!');
        }
    });
};
