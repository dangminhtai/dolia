
import { SlashCommandBuilder } from 'discord.js';
import PanelState from '../../models/PanelState.js';
import { renderMusicPanel } from '../../utils/PanelRenderer.js';

export default {
    data: new SlashCommandBuilder()
        .setName('music-panel')
        .setDescription('Mở bảng điều khiển âm nhạc'),

    async execute(interaction) {
        if (!interaction.guild) return interaction.reply({ content: 'Chỉ dùng trong Server!', ephemeral: true });

        await interaction.deferReply();

        // 1. Xóa các Panel cũ trong DB của kênh này (để đỡ rác DB)
        await PanelState.deleteMany({ channelId: interaction.channel.id });

        // 2. Tạo giao diện mặc định
        const initialState = {
            currentTab: 'home',
            radioPage: 1,
            queuePage: 1,
            selectedPlaylistId: null
        };

        // Render giao diện lần đầu (userId dùng để hiển thị playlist của chính người gọi lệnh)
        const payload = await renderMusicPanel(interaction.guild.id, initialState, interaction.user.id);

        // 3. Gửi tin nhắn
        const message = await interaction.editReply(payload);

        // 4. LƯU VÀO DATABASE (Đây là bước quan trọng nhất)
        await PanelState.create({
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            messageId: message.id,
            ...initialState
        });
    },
};