import { SlashCommandBuilder } from 'discord.js';
import { poru } from '../../utils/LavalinkManager.js';

export default {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Bỏ qua bài hiện tại (Lavalink)'),

    async execute(interaction) {
        const player = poru.players.get(interaction.guild.id);

        if (!player || !player.currentTrack) {
            return interaction.reply({ content: '❌ Không có nhạc để skip!', ephemeral: true });
        }

        // CHÍNH XÁC: Hàm này có trong danh sách debug
        player.skip();

        return interaction.reply(`⏭️ Đã bỏ qua bài: **${player.currentTrack.info.title}**`);
    },
};