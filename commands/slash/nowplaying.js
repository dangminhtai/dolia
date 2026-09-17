import { t as tr } from '../../services/i18nService.js';
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { poru } from '../../utils/LavalinkManager.js';
import { t } from '../../services/i18nService.js';

// Hàm helper để vẽ thanh process bar [======....]
function createProgressBar(current, total, size = 15) {
    if (total === 0) return tr('commands.nowplaying.progress_position') + tr('commands.nowplaying.progress_empty').repeat(size); // Live stream
    const progress = Math.round((size * current) / total);
    const emptyProgress = size - progress;

    const progressText = tr('commands.nowplaying.progress_empty').repeat(progress).replace(/.$/, tr('commands.nowplaying.progress_position')); // Thay ký tự cuối bằng nút tròn
    const emptyProgressText = tr('commands.nowplaying.progress_empty').repeat(emptyProgress);

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
        .setDescription(tr('commands.nowplaying.setdescription_xem_bai_hat_dang_phat')),

    async execute(interaction) {
        const player = poru.players.get(interaction.guild.id);

        if (!player || !player.currentTrack) {
            return interaction.reply({ content: t('music.errors.no_track_playing'), ephemeral: true });
        }

        const track = player.currentTrack;
        const currentPos = player.position; // Vị trí hiện tại (ms)
        const totalDuration = track.info.length; // Tổng thời gian (ms)

        const embed = new EmbedBuilder()
            .setColor('#FF0000') // Màu đỏ YouTube
            .setTitle(t('music.nowplaying.title'))
            .setDescription(tr('commands.nowplaying.setdescription_setdescription', { title: track.info.title, uri: track.info.uri }))
            .setThumbnail(track.info.artworkUrl || track.info.image) // Ảnh thumbnail (Poru v5 tự lấy)
            .addFields(
                { name: t('music.nowplaying.field_artist'), value: track.info.author, inline: true },
                { name: t('music.nowplaying.field_requester'), value: track.info.requester?.tag || tr('messages.music.radio_requester'), inline: true },
                {
                    name: t('music.nowplaying.field_time'),
                    value: `\`${formatTime(currentPos)} / ${track.info.isStream ? tr('messages.music.live') : formatTime(totalDuration)}\``,
                    inline: false
                },
                {
                    name: t('music.nowplaying.field_progress'),
                    value: `\`${createProgressBar(currentPos, totalDuration)}\``,
                    inline: false
                }
            )
            .setFooter({ text: t('music.nowplaying.footer', { volume: player.volume, loop: player.loop === 'NONE' ? t('panel.home.autoplay_off') : t('panel.home.autoplay_on') }) });

        return interaction.reply({ embeds: [embed] });
    },
};