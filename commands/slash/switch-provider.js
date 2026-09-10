
import { SlashCommandBuilder } from 'discord.js';
import User from '../../models/User.js';

export default {
    data: new SlashCommandBuilder()
        .setName('switch-provider')
        .setDescription('Chuyển đổi nguồn phát nhạc (YouTube, SoundCloud, v.v.)')
        .addStringOption(option =>
            option.setName('source')
                .setDescription('Chọn nguồn nhạc muốn dùng')
                .setRequired(true)
                .addChoices(
                    { name: 'YouTube (Mặc định)', value: 'ytsearch' },
                    { name: 'SoundCloud (Nên dùng nếu YT lỗi)', value: 'scsearch' },
                    { name: 'Spotify', value: 'spsearch' },
                    { name: 'Apple Music', value: 'amsearch' }
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

            const providerNames = {
                'ytsearch': 'YouTube',
                'scsearch': 'SoundCloud',
                'spsearch': 'Spotify',
                'amsearch': 'Apple Music'
            };

            await interaction.editReply(`✅ Đã chuyển nguồn phát nhạc sang: **${providerNames[source]}**`);

        } catch (error) {
            console.error('Error switching provider:', error);
            await interaction.editReply('❌ Có lỗi xảy ra khi lưu cài đặt.');
        }
    },
};
