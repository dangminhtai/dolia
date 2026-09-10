
import { SlashCommandBuilder } from 'discord.js';
import User from '../../models/User.js';
import { t } from '../../services/i18nService.js';
import { PROVIDER_NAMES } from '../../utils/lavalinkHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('switch-provider')
        .setDescription('Chuyển đổi nguồn phát nhạc (YouTube, SoundCloud, Spotify, v.v.)')
        .addStringOption(option =>
            option.setName('source')
                .setDescription('Chọn nguồn nhạc muốn dùng')
                .setRequired(true)
                .addChoices(
                    { name: 'YouTube (Mặc định)', value: 'ytsearch' },
                    { name: 'YouTube Music (Khuyên dùng)', value: 'ytmsearch' },
                    { name: 'SoundCloud (Remix / EDM)', value: 'scsearch' },
                    { name: 'Spotify', value: 'spsearch' }
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
            console.error('Error switching provider:', error);
            await interaction.editReply(t('music.switch_provider.error'));
        }
    },
};
