import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { poru } from '../../utils/LavalinkManager.js';

// Hàm helper để vẽ thanh process bar [======....]
function createProgressBar(current, total, size = 15) {
    if (total === 0) return '🔘' + '▬'.repeat(size); // Live stream
    const progress = Math.round((size * current) / total);
    const emptyProgress = size - progress;

    const progressText = '▬'.repeat(progress).replace(/.$/, '🔘'); // Thay ký tự cuối bằng nút tròn
    const emptyProgressText = '▬'.repeat(emptyProgress);

    return progressText + emptyProgressText;
}

// Hàm format thời gian ms -> mm:ss
function formatTime(ms) {
    if (!ms) return '00:00';
    return new Date(ms).toISOString().slice(14, 19);
}

export default {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Xem bài hát đang phát'),

    async execute(interaction) {
        const player = poru.players.get(interaction.guild.id);

        if (!player || !player.currentTrack) {
            return interaction.reply({ content: '❌ Không có nhạc nào đang phát!', ephemeral: true });
        }

        const track = player.currentTrack;
        const currentPos = player.position; // Vị trí hiện tại (ms)
        const totalDuration = track.info.length; // Tổng thời gian (ms)

        const embed = new EmbedBuilder()
            .setColor('#FF0000') // Màu đỏ YouTube
            .setTitle('💿 Đang phát...')
            .setDescription(`[**${track.info.title}**](${track.info.uri})`)
            .setThumbnail(track.info.artworkUrl || track.info.image) // Ảnh thumbnail (Poru v5 tự lấy)
            .addFields(
                { name: 'Ca sĩ/Kênh', value: track.info.author, inline: true },
                { name: 'Người yêu cầu', value: track.info.requester?.tag || 'Radio 24/7', inline: true },
                {
                    name: 'Thời gian',
                    value: `\`${formatTime(currentPos)} / ${track.info.isStream ? 'LIVE' : formatTime(totalDuration)}\``,
                    inline: false
                },
                {
                    name: 'Tiến độ',
                    value: `\`${createProgressBar(currentPos, totalDuration)}\``,
                    inline: false
                }
            )
            .setFooter({ text: `Volume: ${player.volume}% | Loop: ${player.loop === 'NONE' ? 'Tắt' : 'Bật'}` });

        return interaction.reply({ embeds: [embed] });
    },
};