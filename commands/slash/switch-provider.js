import { t as tr } from '../../services/i18nService.js';

import { SlashCommandBuilder } from 'discord.js';
import User from '../../models/User.js';
import { t } from '../../services/i18nService.js';
import { PROVIDER_NAMES } from '../../utils/lavalinkHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('switch-provider')
        .setDescription(tr('commands.switch_provider.setdescription_chuyen_doi_nguon_phat_nhac_youtube_soundcloud'))
        .addStringOption(option =>
            option.setName('source')
                .setDescription(tr('commands.switch_provider.setdescription_chon_nguon_nhac_muon_dung'))
                .setRequired(true)
                .addChoices(
                    { name: tr('commands.switch_provider.name_youtube_mac_dinh'), value: 'ytsearch' },
                    { name: tr('commands.switch_provider.name_youtube_music_khuyen_dung'), value: 'ytmsearch' },
                    { name: tr('commands.switch_provider.name_soundcloud_remix_edm'), value: 'scsearch' },
                    { name: tr('commands.switch_provider.name_spotify'), value: 'spsearch' }
                )
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const source = interaction.options.getString('source');
        const userId = interaction.user.id;

        try {
            await User.findOneAndUpdate(
                { userId: userId },
                { musicProvider: source },
                { upsert: true, new: true }
            );

            const providerName = PROVIDER_NAMES[source] || source;
            await interaction.editReply(t('music.switch_provider.success', { provider: providerName }));

        } catch (error) {
            console.error(tr('logs.switch_provider.error_error_switching_provider'), error);
            await interaction.editReply(t('music.switch_provider.error'));
        }
    },
};
