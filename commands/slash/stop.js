import { t as tr } from '../../services/i18nService.js';
import { SlashCommandBuilder } from 'discord.js';
import { poru } from '../../utils/LavalinkManager.js';
import { t } from '../../services/i18nService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription(tr('commands.stop.setdescription_dung_nhac_va_tat_che_do_24')),

    async execute(interaction) {
        const player = poru.players.get(interaction.guild.id);

        if (!player) {
            return interaction.reply({ content: t('music.errors.not_playing'), ephemeral: true });
        }

        // QUAN TRỌNG: Tắt cờ 24/7
        player.isAutoplay = false;

        player.destroy();
        return interaction.reply(t('music.stop'));
    },
};