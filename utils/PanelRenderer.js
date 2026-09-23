import { t as tr } from '../services/i18nService.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { poru } from './LavalinkManager.js';
import MusicSetting from '../models/MusicSetting.js';
import RadioSong from '../models/RadioSong.js';
import UserPlaylist from '../models/UserPlaylist.js';
import { t } from '../services/i18nService.js';

function createProgressBar(current, total, size = 15) {
    if (!total || total === 0) return tr('messages.panelrenderer.text_live_stream');
    const progress = Math.round((size * current) / total);
    const emptyProgress = size - progress;
    return tr('messages.panelrenderer.progress_empty').repeat(progress) + tr('messages.panelrenderer.progress_position') + tr('messages.panelrenderer.progress_empty').repeat(emptyProgress);
}

function formatTime(ms) {
    if (!ms) return '00:00';
    return new Date(ms).toISOString().slice(14, 19);
}

export async function renderMusicPanel(guildId, state, userIdForPlaylist = null) {
    if (!userIdForPlaylist) throw new Error('MUSIC_PANEL_OWNER_REQUIRED');
    const componentId = action => `${action}:${userIdForPlaylist}`;
    const player = poru?.players ? poru.players.get(guildId) : null;
    const currentTrack = player?.currentTrack;
    const embed = new EmbedBuilder().setTimestamp();
    const components = [];
    const { currentTab, radioPage, queuePage, selectedPlaylistId } = state;

    // ==================== TAB: HOME ====================
    if (currentTab === 'home') {
        if (player && currentTrack) {
            embed.setColor('#0099ff')
                .setTitle(t('panel.home.title_playing'))
                .setDescription(tr('messages.panelrenderer.setdescription_setdescription', { value: currentTrack?.info?.title || tr('messages.panelrenderer.text_unknown_title'), value2: currentTrack?.info?.uri || '#' }))
                .setThumbnail(currentTrack?.info?.artworkUrl || currentTrack?.info?.image || tr('messages.music.default_artwork'))
                .addFields(
                    { name: t('panel.home.field_artist'), value: currentTrack?.info?.author || tr('messages.panelrenderer.text_unknown_artist'), inline: true },
                    { name: t('panel.home.field_requester'), value: currentTrack?.info?.requester?.tag || tr('messages.panelrenderer.text_system'), inline: true },
                    {
                        name: t('panel.home.field_time', { current: formatTime(player.position), total: formatTime(currentTrack?.info?.length || 0) }),
                        value: createProgressBar(player.position, currentTrack?.info?.length || 0),
                        inline: false
                    },
                    {
                        name: t('panel.home.field_status'),
                        value: t('panel.home.status_value', {
                            volume: player.volume,
                            loop: player.loop,
                            autoplay: player.isAutoplay ? t('panel.home.autoplay_on') : t('panel.home.autoplay_off')
                        }),
                        inline: false
                    }
                );

            const rowControls = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(componentId('music_btn_pause')).setEmoji(player.isPaused ? tr('messages.panelrenderer.emoji_resume') : tr('messages.panelrenderer.emoji_pause')).setStyle(player.isPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(componentId('music_btn_skip')).setEmoji(tr('messages.panelrenderer.emoji_skip')).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(componentId('music_btn_loop')).setEmoji(player.loop === 'NONE' ? tr('messages.panelrenderer.emoji_loop_off') : tr('messages.panelrenderer.emoji_loop_on')).setStyle(player.loop === 'NONE' ? ButtonStyle.Secondary : ButtonStyle.Success),
                new ButtonBuilder().setCustomId(componentId('music_btn_shuffle')).setEmoji(tr('messages.panelrenderer.emoji_shuffle')).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(componentId('music_btn_stop')).setEmoji(tr('messages.panelrenderer.emoji_stop')).setStyle(ButtonStyle.Danger)
            );
            components.push(rowControls);
        } else {
            embed.setColor('#808080')
                .setTitle(t('panel.home.title_idle'))
                .setDescription(t('panel.home.desc_idle'));
        }
    }

    // ==================== TAB: SETTINGS ====================
    else if (currentTab === 'settings') {
        let setting = await MusicSetting.findOne({ guildId: guildId });
        if (!setting) setting = await MusicSetting.create({ guildId: guildId });

        embed.setColor('#9900ff')
            .setTitle(t('panel.settings.title'))
            .setDescription(t('panel.settings.description'))
            .addFields(
                { name: tr('messages.panelrenderer.name_volume'), value: `${setting.volume}%`, inline: true },
                { name: tr('messages.panelrenderer.name_speed'), value: `${setting.speed.toFixed(1)}x`, inline: true },
                { name: tr('messages.panelrenderer.name_pitch'), value: `${setting.pitch?.toFixed(1) || '1.0'}x`, inline: true },
                { name: tr('messages.panelrenderer.name_nightcore'), value: setting.nightcore ? t('panel.settings.nightcore_on') : t('panel.settings.nightcore_off'), inline: true },
                { name: tr('messages.panelrenderer.name_bassboost'), value: setting.bassboost ? t('panel.settings.bassboost_on') : t('panel.settings.bassboost_off'), inline: true }
            );

        // Hàng 1: Volume
        const rowVol = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(componentId('music_set_vol_down')).setLabel(t('panel.buttons.vol_down')).setStyle(ButtonStyle.Secondary).setEmoji(tr('messages.panelrenderer.emoji_volume_down')),
            new ButtonBuilder().setCustomId(componentId('music_set_vol_up')).setLabel(t('panel.buttons.vol_up')).setStyle(ButtonStyle.Secondary).setEmoji(tr('messages.panelrenderer.emoji_volume_up')),
            new ButtonBuilder().setCustomId(componentId('music_set_reset')).setLabel(t('panel.buttons.reset_all')).setStyle(ButtonStyle.Danger).setEmoji(tr('messages.panelrenderer.emoji_reset'))
        );

        // Hàng 2: Speed (giống lệnh)
        const rowSpeed = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(componentId('music_set_speed_down')).setLabel(t('panel.buttons.speed_down')).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(componentId('music_set_speed_reset')).setLabel(t('panel.buttons.speed_reset')).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(componentId('music_set_speed_up')).setLabel(t('panel.buttons.speed_up')).setStyle(ButtonStyle.Primary)
        );

        // Hàng 3: Effect (giống lệnh)
        const rowEffect = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(componentId('music_set_nightcore')).setLabel(t('panel.buttons.nightcore')).setStyle(setting.nightcore ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji(tr('messages.panelrenderer.emoji_nightcore')),
            new ButtonBuilder().setCustomId(componentId('music_set_bass')).setLabel(t('panel.buttons.bassboost')).setStyle(setting.bassboost ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji(tr('messages.panelrenderer.emoji_bassboost'))
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
            ? songs.map((s, i) => tr('messages.panelrenderer.radio_item', { rank: (page - 1) * itemsPerPage + i + 1, title: s.title, url: s.url })).join('\n')
            : t('panel.radio.empty_list');

        embed.setColor('#00ff00')
            .setTitle(t('panel.radio.title', { total: totalSongs }))
            .setDescription(tr('messages.panelrenderer.setdescription_trang_thai_24_7', { value: player?.isAutoplay ? t('panel.radio.status_running') : t('panel.radio.status_stopped'), listString: listString }))
            .setFooter({ text: t('panel.radio.footer_page', { page, totalPages }) });

        const rowRadioControls = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(componentId('music_radio_prev')).setEmoji(tr('messages.panelrenderer.emoji_previous')).setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
            new ButtonBuilder().setCustomId(componentId('music_radio_toggle')).setLabel(player?.isAutoplay ? t('panel.radio.toggle_on') : t('panel.radio.toggle_off')).setStyle(player?.isAutoplay ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder().setCustomId(componentId('music_radio_next')).setEmoji(tr('messages.panelrenderer.emoji_next')).setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages)
        );

        const rowRadioManage = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(componentId('music_radio_add_current')).setLabel(t('panel.buttons.radio_add_current')).setStyle(ButtonStyle.Secondary).setDisabled(!player?.currentTrack),
            new ButtonBuilder().setCustomId(componentId('music_radio_add_query')).setLabel(t('panel.buttons.radio_add_query')).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(componentId('music_radio_remove')).setLabel(t('panel.buttons.radio_remove')).setStyle(ButtonStyle.Danger)
        );
        components.push(rowRadioControls, rowRadioManage);
    }

    // ==================== TAB: PLAYLIST ====================
    else if (currentTab === 'playlist') {
        let userPlaylists = [];
        if (userIdForPlaylist) {
            userPlaylists = await UserPlaylist.find({ userId: userIdForPlaylist });
        }

        embed.setColor('#ffaa00').setTitle(t('panel.playlist.title'));

        if (userPlaylists.length === 0) {
            embed.setDescription(userIdForPlaylist ? t('panel.playlist.no_playlist') : t('panel.playlist.click_to_view'));
            const rowCreate = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(componentId('music_pl_create')).setLabel(t('panel.buttons.pl_create')).setStyle(ButtonStyle.Success)
            );
            components.push(rowCreate);
        } else {
            const options = userPlaylists.map(pl => ({ label: pl.name, value: pl._id.toString(), description: tr('messages.panelrenderer.description_bai_hat', { length: pl.tracks.length }) }));
            const rowSelect = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(componentId('music_pl_select')).setPlaceholder(t('panel.playlist.select_placeholder')).addOptions(options)
            );
            components.push(rowSelect);

            if (selectedPlaylistId) {
                const selectedPl = userPlaylists.find(pl => pl._id.toString() === selectedPlaylistId);
                if (selectedPl) {
                    const trackList = selectedPl.tracks.slice(0, 5).map((t, i) => tr('messages.panelrenderer.playlist_item', { rank: i + 1, title: t.title })).join('\n');
                    embed.setDescription(t('panel.playlist.selected_info', { name: selectedPl.name, trackList, remaining: selectedPl.tracks.length - 5 }));

                    const rowPlActions = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(componentId('music_pl_play')).setLabel(t('panel.buttons.pl_play')).setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(componentId('music_pl_add_current')).setLabel(t('panel.buttons.pl_add_current')).setStyle(ButtonStyle.Secondary).setDisabled(!player?.currentTrack),
                        new ButtonBuilder().setCustomId(componentId('music_pl_add_query')).setLabel(t('panel.buttons.pl_add_query')).setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId(componentId('music_pl_delete')).setLabel(t('panel.buttons.pl_delete')).setStyle(ButtonStyle.Danger)
                    );
                    components.push(rowPlActions);
                } else {
                    embed.setDescription(t('panel.playlist.not_found'));
                }
            } else {
                embed.setDescription(t('panel.playlist.select_prompt'));
            }
            components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(componentId('music_pl_create')).setLabel(t('panel.buttons.pl_create_short')).setStyle(ButtonStyle.Secondary)));
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
            ? queueSlice.map((t, i) => tr('messages.panelrenderer.queue_item', { rank: (page - 1) * itemsPerPage + i + 1, title: t.info.title.substring(0, 50), url: t.info.uri, duration: formatTime(t.info.length), requester: t.info.requester?.id ? `<@${t.info.requester.id}>` : tr('messages.panelrenderer.text_system') })).join('\n')
            : t('panel.queue.empty');

        const nowPlaying = currentTrack
            ? t('panel.queue.now_playing', {
                title: currentTrack.info?.title || tr('messages.panelrenderer.text_unknown_title'),
                uri: currentTrack.info?.uri || '#'
            })
            : t('panel.queue.not_playing');

        embed.setColor('#FFA500')
            .setTitle(t('panel.queue.title', { count: queue.length }))
            .setDescription(tr('messages.panelrenderer.queue_body', { nowPlaying, header: t('panel.queue.next_header'), list: listString }))
            .setFooter({ text: t('panel.queue.footer', { page, totalPages, totalTime: formatTime(queue.reduce((acc, t) => acc + t.info.length, 0)) }) });

        const rowQueue = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(componentId('music_queue_prev')).setEmoji(tr('messages.panelrenderer.emoji_previous')).setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
            new ButtonBuilder().setCustomId(componentId('music_queue_next')).setEmoji(tr('messages.panelrenderer.emoji_next')).setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages),
            new ButtonBuilder().setCustomId(componentId('music_queue_shuffle')).setLabel(t('panel.buttons.queue_shuffle')).setStyle(ButtonStyle.Secondary).setEmoji(tr('messages.panelrenderer.emoji_shuffle')).setDisabled(queue.length < 2),
            new ButtonBuilder().setCustomId(componentId('music_queue_clear')).setLabel(t('panel.buttons.queue_clear')).setStyle(ButtonStyle.Danger).setEmoji(tr('messages.panelrenderer.emoji_clear')).setDisabled(queue.length === 0)
        );
        const rowQueue2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(componentId('music_queue_add_priority')).setLabel(t('panel.buttons.queue_add_priority')).setStyle(ButtonStyle.Primary).setEmoji(tr('messages.panelrenderer.emoji_priority')),
            new ButtonBuilder().setCustomId(componentId('music_nav_settings')).setLabel(t('panel.buttons.nav_settings')).setEmoji(tr('messages.panelrenderer.emoji_settings')).setStyle(currentTab === 'settings' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(currentTab === 'settings')
        );
        components.push(rowQueue, rowQueue2);
    }

    // ==================== NAV ====================
    const rowNav = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(componentId('music_nav_home')).setLabel(t('panel.buttons.nav_home')).setEmoji(tr('messages.panelrenderer.emoji_home')).setStyle(currentTab === 'home' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(currentTab === 'home'),
        new ButtonBuilder().setCustomId(componentId('music_nav_queue')).setLabel(t('panel.buttons.nav_queue')).setEmoji(tr('messages.panelrenderer.emoji_queue')).setStyle(currentTab === 'queue' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(currentTab === 'queue'),
        new ButtonBuilder().setCustomId(componentId('music_nav_radio')).setLabel(t('panel.buttons.nav_radio')).setEmoji(tr('messages.panelrenderer.emoji_radio')).setStyle(currentTab === 'radio' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(currentTab === 'radio'),
        new ButtonBuilder().setCustomId(componentId('music_nav_playlist')).setLabel(t('panel.buttons.nav_playlist')).setEmoji(tr('messages.panelrenderer.emoji_playlist')).setStyle(currentTab === 'playlist' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(currentTab === 'playlist'),
        new ButtonBuilder().setCustomId(componentId('music_nav_close')).setLabel(t('panel.buttons.nav_close')).setEmoji(tr('messages.panelrenderer.emoji_close')).setStyle(ButtonStyle.Danger)
    );
    components.push(rowNav);

    return { content: ' ', embeds: [embed], components: components };
}
