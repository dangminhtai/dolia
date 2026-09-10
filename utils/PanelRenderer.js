
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { poru } from './LavalinkManager.js';
import MusicSetting from '../models/MusicSetting.js';
import RadioSong from '../models/RadioSong.js';
import UserPlaylist from '../models/UserPlaylist.js';

function createProgressBar(current, total, size = 15) {
    if (!total || total === 0) return '🔴 LIVE STREAM';
    const progress = Math.round((size * current) / total);
    const emptyProgress = size - progress;
    return '▬'.repeat(progress) + '🔘' + '▬'.repeat(emptyProgress);
}

function formatTime(ms) {
    if (!ms) return '00:00';
    return new Date(ms).toISOString().slice(14, 19);
}

export async function renderMusicPanel(guildId, state, userIdForPlaylist = null) {
    const player = poru.players.get(guildId);
    const currentTrack = player?.currentTrack;
    const embed = new EmbedBuilder().setTimestamp();
    const components = [];
    const { currentTab, radioPage, queuePage, selectedPlaylistId } = state;

    // ==================== TAB: HOME ====================
    if (currentTab === 'home') {
        if (player && currentTrack) {
            embed.setColor('#0099ff')
                .setTitle('💿 TRÌNH PHÁT NHẠC')
                .setDescription(`**[${currentTrack?.info?.title || 'Unknown Title'}](${currentTrack?.info?.uri || '#'})**`)
                .setThumbnail(currentTrack?.info?.artworkUrl || currentTrack?.info?.image || 'https://i.imgur.com/7R8Zq0D.png')
                .addFields(
                    { name: 'Ca sĩ', value: currentTrack?.info?.author || 'Unknown Artist', inline: true },
                    { name: 'Người yêu cầu', value: currentTrack?.info?.requester?.tag || 'System', inline: true },
                    {
                        name: `Thời gian (${formatTime(player.position)} / ${formatTime(currentTrack?.info?.length || 0)})`,
                        value: createProgressBar(player.position, currentTrack?.info?.length || 0),
                        inline: false
                    },
                    {
                        name: 'Trạng thái',
                        value: `Vol: **${player.volume}%** | Loop: **${player.loop}** | 24/7: **${player.isAutoplay ? 'BẬT' : 'TẮT'}**`,
                        inline: false
                    }
                );

            const rowControls = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('music_btn_pause').setEmoji(player.isPaused ? '▶️' : '⏸️').setStyle(player.isPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('music_btn_skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('music_btn_loop').setEmoji(player.loop === 'NONE' ? '🔁' : '🔂').setStyle(player.loop === 'NONE' ? ButtonStyle.Secondary : ButtonStyle.Success),
                new ButtonBuilder().setCustomId('music_btn_shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('music_btn_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
            );
            components.push(rowControls);
        } else {
            embed.setColor('#808080')
                .setTitle('💤 BOT ĐANG NGHỈ NGƠI')
                .setDescription('Hiện không có nhạc.\nDùng các Tab bên dưới để bật nhạc hoặc dùng lệnh `/play`.');
        }
    }

    // ==================== TAB: SETTINGS ====================
    else if (currentTab === 'settings') {
        let setting = await MusicSetting.findOne({ guildId: guildId });
        if (!setting) setting = await MusicSetting.create({ guildId: guildId });

        embed.setColor('#9900ff')
            .setTitle('🎛️ CÀI ĐẶT ÂM THANH')
            .setDescription('Điều chỉnh hiệu ứng. Cài đặt sẽ được **LƯU** vĩnh viễn.')
            .addFields(
                { name: '🔊 Volume', value: `${setting.volume}%`, inline: true },
                { name: '⏩ Speed', value: `${setting.speed.toFixed(1)}x`, inline: true },
                { name: '🗣️ Pitch', value: `${setting.pitch?.toFixed(1) || '1.0'}x`, inline: true },
                { name: '🐿️ Nightcore', value: setting.nightcore ? '✅ Bật' : '❌ Tắt', inline: true },
                { name: '🥁 Bassboost', value: setting.bassboost ? '✅ Bật' : '❌ Tắt', inline: true }
            );

        // Hàng 1: Volume
        const rowVol = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('music_set_vol_down').setLabel('Vol -10').setStyle(ButtonStyle.Secondary).setEmoji('🔉'),
            new ButtonBuilder().setCustomId('music_set_vol_up').setLabel('Vol +10').setStyle(ButtonStyle.Secondary).setEmoji('🔊'),
            new ButtonBuilder().setCustomId('music_set_reset').setLabel('Reset All').setStyle(ButtonStyle.Danger).setEmoji('🧹')
        );

        // Hàng 2: Speed (giống lệnh)
        const rowSpeed = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('music_set_speed_down').setLabel('Speed -').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('music_set_speed_reset').setLabel('Speed Chuẩn').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('music_set_speed_up').setLabel('Speed +').setStyle(ButtonStyle.Primary)
        );

        // Hàng 3: Effect (giống lệnh)
        const rowEffect = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('music_set_nightcore').setLabel('Nightcore').setStyle(setting.nightcore ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('🐿️'),
            new ButtonBuilder().setCustomId('music_set_bass').setLabel('Bassboost').setStyle(setting.bassboost ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('🥁')
        );

        components.push(rowVol, rowSpeed, rowEffect);
    }

    // ==================== TAB: RADIO ====================
    else if (currentTab === 'radio') {
        const itemsPerPage = 5;
        const totalSongs = await RadioSong.countDocuments();
        const totalPages = Math.ceil(totalSongs / itemsPerPage) || 1;

        let page = radioPage;
        if (page < 1) page = 1;
        if (page > totalPages) page = totalPages;

        const songs = await RadioSong.find()
            .skip((page - 1) * itemsPerPage)
            .limit(itemsPerPage);

        const listString = songs.length > 0
            ? songs.map((s, i) => `**${(page - 1) * itemsPerPage + i + 1}.** [${s.title}](${s.url})`).join('\n')
            : '*(Kho nhạc trống)*';

        embed.setColor('#00ff00')
            .setTitle(`📻 QUẢN LÝ RADIO 24/7 (Tổng: ${totalSongs})`)
            .setDescription(`**Trạng thái 24/7:** ${player?.isAutoplay ? '✅ Đang chạy' : '❌ Đang tắt'}\n\n${listString}`)
            .setFooter({ text: `Trang ${page}/${totalPages}` });

        const rowRadioControls = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('music_radio_prev').setEmoji('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
            new ButtonBuilder().setCustomId('music_radio_toggle').setLabel(player?.isAutoplay ? 'Tắt 24/7' : 'Bật 24/7').setStyle(player?.isAutoplay ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder().setCustomId('music_radio_next').setEmoji('➡️').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages)
        );

        const rowRadioManage = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('music_radio_add_current').setLabel('Thêm bài đang phát').setStyle(ButtonStyle.Secondary).setDisabled(!player?.currentTrack),
            new ButtonBuilder().setCustomId('music_radio_add_query').setLabel('🔍 Thêm Link/Tên').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('music_radio_remove').setLabel('🗑️ Xóa (Index)').setStyle(ButtonStyle.Danger)
        );
        components.push(rowRadioControls, rowRadioManage);
    }

    // ==================== TAB: PLAYLIST ====================
    else if (currentTab === 'playlist') {
        // Lưu ý: ở đây ta sử dụng userId được truyền vào (người click nút) hoặc mặc định
        // Nếu bot restart, ta có thể không biết user là ai nếu chỉ dựa vào rendering, nhưng interaction sẽ cung cấp user ID.
        // Tuy nhiên render độc lập thì cần userId.

        let userPlaylists = [];
        if (userIdForPlaylist) {
            userPlaylists = await UserPlaylist.find({ userId: userIdForPlaylist });
        }

        embed.setColor('#ffaa00').setTitle('💾 PLAYLIST CỦA BẠN');

        if (userPlaylists.length === 0) {
            embed.setDescription(userIdForPlaylist ? 'Bạn chưa có playlist nào. Bấm **Tạo Mới** để bắt đầu.' : 'Bấm nút playlist để xem danh sách của bạn.');
            const rowCreate = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('music_pl_create').setLabel('✨ Tạo Playlist Mới').setStyle(ButtonStyle.Success)
            );
            components.push(rowCreate);
        } else {
            const options = userPlaylists.map(pl => ({ label: pl.name, value: pl._id.toString(), description: `${pl.tracks.length} bài hát` }));
            const rowSelect = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('music_pl_select').setPlaceholder('Chọn Playlist của bạn').addOptions(options)
            );
            components.push(rowSelect);

            if (selectedPlaylistId) {
                const selectedPl = userPlaylists.find(pl => pl._id.toString() === selectedPlaylistId);
                if (selectedPl) {
                    const trackList = selectedPl.tracks.slice(0, 5).map((t, i) => `${i + 1}. ${t.title}`).join('\n');
                    embed.setDescription(`**Đang chọn: ${selectedPl.name}**\n${trackList}\n...(và ${selectedPl.tracks.length - 5} bài khác)`);

                    const rowPlActions = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('music_pl_play').setLabel('▶️ Phát').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('music_pl_add_current').setLabel('➕ Thêm bài này').setStyle(ButtonStyle.Secondary).setDisabled(!player?.currentTrack),
                        new ButtonBuilder().setCustomId('music_pl_add_query').setLabel('🔍 Thêm tên/link').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('music_pl_delete').setLabel('🗑️ Xóa PL').setStyle(ButtonStyle.Danger)
                    );
                    components.push(rowPlActions);
                } else {
                    embed.setDescription('Playlist đã chọn không còn tồn tại.');
                }
            } else {
                embed.setDescription('Hãy chọn một playlist từ menu bên dưới.');
            }
            components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music_pl_create').setLabel('✨ Tạo Mới').setStyle(ButtonStyle.Secondary)));
        }
    }

    // ==================== TAB: QUEUE ====================
    else if (currentTab === 'queue') {
        const queue = player?.queue || [];
        const itemsPerPage = 10;
        const totalPages = Math.ceil(queue.length / itemsPerPage) || 1;

        let page = queuePage;
        if (page < 1) page = 1;
        if (page > totalPages) page = totalPages;

        const queueSlice = queue.slice((page - 1) * itemsPerPage, page * itemsPerPage);

        const listString = queueSlice.length > 0
            ? queueSlice.map((t, i) => `**${(page - 1) * itemsPerPage + i + 1}.** [${t.info.title.substring(0, 50)}](${t.info.uri}) \`[${formatTime(t.info.length)}]\` - <@${t.info.requester?.id || 'System'}>`).join('\n')
            : '*(Hàng chờ trống)*';

        embed.setColor('#FFA500')
            .setTitle(`📜 HÀNG CHỜ NHẠC (${queue.length} bài)`)
            .setDescription(`**Đang phát:** [${player?.currentTrack?.info.title}](${player?.currentTrack?.info.uri}) \n\n${listString}`)
            .setFooter({ text: `Trang ${page}/${totalPages} | Tổng thời lượng: ${formatTime(queue.reduce((acc, t) => acc + t.info.length, 0))}` });

        const rowQueue = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('music_queue_prev').setEmoji('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
            new ButtonBuilder().setCustomId('music_queue_next').setEmoji('➡️').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages),
            new ButtonBuilder().setCustomId('music_queue_shuffle').setLabel('Trộn').setStyle(ButtonStyle.Secondary).setEmoji('🔀').setDisabled(queue.length < 2),
            new ButtonBuilder().setCustomId('music_queue_clear').setLabel('Xóa').setStyle(ButtonStyle.Danger).setEmoji('💥').setDisabled(queue.length === 0)
        );
        const rowQueue2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('music_queue_add_priority').setLabel('Hát Ngay').setStyle(ButtonStyle.Primary).setEmoji('🚀'),
            new ButtonBuilder().setCustomId('music_nav_settings').setLabel('Settings').setEmoji('🎛️').setStyle(currentTab === 'settings' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(currentTab === 'settings')
        );
        components.push(rowQueue, rowQueue2);
    }

    // ==================== NAV ====================
    const rowNav = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_nav_home').setLabel('Home').setEmoji('🏠').setStyle(currentTab === 'home' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(currentTab === 'home'),
        new ButtonBuilder().setCustomId('music_nav_queue').setLabel('Queue').setEmoji('📜').setStyle(currentTab === 'queue' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(currentTab === 'queue'),
        new ButtonBuilder().setCustomId('music_nav_radio').setLabel('Radio').setEmoji('📻').setStyle(currentTab === 'radio' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(currentTab === 'radio'),
        new ButtonBuilder().setCustomId('music_nav_playlist').setLabel('Playlist').setEmoji('💾').setStyle(currentTab === 'playlist' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(currentTab === 'playlist'),
        new ButtonBuilder().setCustomId('music_nav_close').setLabel('Đóng').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
    );
    components.push(rowNav);

    return { content: ' ', embeds: [embed], components: components };
}
