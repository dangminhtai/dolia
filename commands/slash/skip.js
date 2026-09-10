import { SlashCommandBuilder } from 'discord.js';
import { poru } from '../../utils/LavalinkManager.js';
import { t } from '../../services/i18nService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Bỏ qua bài hiện tại (Lavalink)'),

    async execute(interaction) {
        const player = poru.players.get(interaction.guild.id);

        if (!player || !player.currentTrack) {
            return interaction.reply({ content: t('music.errors.no_track_to_skip'), ephemeral: true });
        }

        // CHÍNH XÁC: Hàm này có trong danh sách debug
        player.skip();

        return interaction.reply(t('music.skip', { title: player.currentTrack.info.title }));
    },
};