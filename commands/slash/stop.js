import { SlashCommandBuilder } from 'discord.js';
import { poru } from '../../utils/LavalinkManager.js';

export default {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Dừng nhạc và tắt chế độ 24/7'),

    async execute(interaction) {
        const player = poru.players.get(interaction.guild.id);

        if (!player) {
            return interaction.reply({ content: '❌ Bot có đang hát đâu?', ephemeral: true });
        }

        // QUAN TRỌNG: Tắt cờ 24/7
        player.isAutoplay = false;

        player.destroy();
        return interaction.reply('🛑 Đã dừng nhạc và tắt chế độ Radio 24/7.');
    },
};