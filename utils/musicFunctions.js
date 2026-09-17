import { t as tr } from '../services/i18nService.js';
import { poru } from '../utils/LavalinkManager.js';
import MusicSetting from '../models/MusicSetting.js';
import RadioSong from '../models/RadioSong.js';
import PanelState from '../models/PanelState.js';
import GuildMusicQueue from '../models/GuildMusicQueue.js'; // Added missing import
import { applyAudioSettings } from '../utils/AudioController.js';
import { renderMusicPanel } from '../utils/PanelRenderer.js';
import { ChannelType } from 'discord.js'; // Added ChannelType
import { getUserMusicSource, isFailed, isEmpty, isPlaylist, isSuccess, resolveWithProvider } from './lavalinkHelper.js';

/**
 * 1. Play Music
 */
export async function play_music({ guild, channel, user, query, priority }) {
    // --- LOGIC CHỌN KÊNH VOICE THÔNG MINH (MATCH SLASH COMMAND) ---
    const member = guild.members.cache.get(user.id);
    let voiceChannel = member?.voice?.channel;

    let player = poru.players.get(guild.id);

    // Trường hợp 1: Người dùng KHÔNG ở trong voice
    if (!voiceChannel) {
        if (player && player.isConnected) {
            // Nếu Bot đang hát ở đâu đó -> Dùng luôn kênh đó (Điều khiển từ xa)
            voiceChannel = guild.channels.cache.get(player.voiceChannel);
        } else {
            // Nếu Bot chưa hát -> Tự động tìm kênh Voice đầu tiên của Server để chui vào
            voiceChannel = guild.channels.cache
                .filter(c => c.type === ChannelType.GuildVoice && c.joinable && !c.full)
                .first();
        }
    }

    if (!voiceChannel) {
        return { success: false, error: "NO_VOICE", message: tr('messages.musicfunctions.text_ban_can_vao_voice_channel_hoac_server') };
    }

    // Connect to voice (Đảm bảo player được gán trực tiếp)
    if (!player || !player.isConnected) {
        try {
            player = poru.createConnection({
                guildId: guild.id,
                voiceChannel: voiceChannel.id,
                textChannel: channel.id,
                deaf: false,
            });
            await applyAudioSettings(player);
        } catch (err) {
            console.error(tr('logs.musicfunctions.error_poru_create_connection_error'), err);
            return { success: false, error: "CONNECTION_ERROR", message: tr('messages.musicfunctions.text_khong_the_ket_noi_den_voice_no') };
        }
    }

    // Resolve Track với Provider của User & Log chi tiết
    let res;
    let resolveAttempts = 0;
    const maxResolveRetries = 3;

    while (resolveAttempts < maxResolveRetries) {
        try {
            const resolveResult = await resolveWithProvider({
                poru,
                query,
                userId: user.id,
                userTag: user.tag || user.username,
                requester: user
            });
            res = resolveResult.res;
            if (res) break; // Success
        } catch (err) {
            console.warn(tr('logs.musicfunctions.warn_music_resolve_error_attempt', { value: resolveAttempts + 1, maxResolveRetries: maxResolveRetries, message: err.message }));
            resolveAttempts++;
            if (resolveAttempts >= maxResolveRetries) {
                return { success: false, error: "RESOLVE_FAILED", message: tr('messages.musicfunctions.text_loi_ket_noi_den_may_chu_nhac') };
            }
            // Wait 1s before retry
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    if (!res || isFailed(res.loadType)) {
        return { success: false, error: "LOAD_FAILED", message: tr('messages.musicfunctions.text_loi_tai_nhac_tu_nguon') };
    } else if (isEmpty(res.loadType, res.tracks)) {
        return { success: false, error: "NO_MATCHES", message: tr('messages.musicfunctions.text_khong_tim_thay_bai_hat_nao') };
    }

    // Đảm bảo player và queue sẵn sàng (phòng trường hợp player bị destroy giữa chừng)
    if (!player || !player.queue) {
        player = poru.players.get(guild.id);
    }
    if (!player || !player.queue) {
        try {
            player = poru.createConnection({
                guildId: guild.id,
                voiceChannel: voiceChannel.id,
                textChannel: channel.id,
                deaf: false,
            });
            await applyAudioSettings(player);
        } catch (e) { }
    }
    if (!player || !player.queue) {
        return { success: false, error: "PLAYER_NOT_READY", message: tr('messages.musicfunctions.text_trinh_phat_nhac_chua_san_sang_ban') };
    }

    // Handle Tracks & DB
    let addedMsg = "";
    const tracksToAdd = [];

    // Helper format DB
    const formatTrackForDB = (track) => ({
        title: track.info.title,
        url: track.info.uri,
        author: track.info.author,
        duration: track.info.length,
        requester: user.tag, // or username
        addedAt: new Date()
    });

    if (isPlaylist(res.loadType)) {
        for (const track of res.tracks) {
            track.info.requester = user;
            tracksToAdd.push(formatTrackForDB(track));
        }

        if (priority) {
            for (let i = res.tracks.length - 1; i >= 0; i--) {
                player.queue.unshift(res.tracks[i]);
            }
            addedMsg = tr('messages.musicfunctions.text_uu_tien_playlist', { name: res.playlistInfo.name });
        } else {
            player.queue.add(res.tracks);
            addedMsg = `Playlist: ${res.playlistInfo.name}`;
        }
    } else {
        const track = res.tracks[0];
        if (!track) {
            return { success: false, error: "TRACK_UNDEFINED", message: tr('messages.musicfunctions.text_khong_tim_thay_thong_tin_bai_hat') };
        }
        track.info.requester = user;
        tracksToAdd.push(formatTrackForDB(track));

        if (priority) {
            player.queue.unshift(track);
            addedMsg = tr('messages.musicfunctions.text_uu_tien_bai', { title: track.info.title });
        } else {
            player.queue.add(track);
            addedMsg = tr('messages.musicfunctions.text_bai', { title: track.info.title });
        }
    }

    // --- DB SYNC ---
    const updateQuery = priority
        ? { $push: { tracks: { $each: tracksToAdd, $position: 0 } } }
        : { $push: { tracks: { $each: tracksToAdd } } };

    await GuildMusicQueue.updateOne(
        { guildId: guild.id },
        { ...updateQuery, $set: { updatedAt: new Date() } },
        { upsert: true }
    ).catch(e => console.error(tr('logs.musicfunctions.error_loi_luu_queue_db'), e));


    // Play Trigger
    if (priority) {
        if (player.isPlaying || player.isPaused) player.skip();
        else player.play();
    } else {
        if (!player.isPlaying && !player.isPaused) {
            player.play();
        }
    }

    return {
        success: true,
        message: addedMsg,
        voiceChannel: voiceChannel.name,
        trackCount: tracksToAdd.length
    };
}

/**
 * 2. Control Playback
 */
export async function control_playback({ guild, action }) {
    const player = poru.players.get(guild.id);
    if (!player) return { success: false, message: tr('messages.musicfunctions.text_bot_chua_phat_nhac') };

    switch (action) {
        case 'skip':
            player.skip();
            return { success: true, message: tr('messages.musicfunctions.text_da_bo_qua_bai_hat') };
        case 'stop':
            await player.destroy();
            return { success: true, message: tr('messages.musicfunctions.text_da_dung_nhac_va_roi_kenh') };
        case 'pause':
            player.pause(true);
            return { success: true, message: tr('messages.musicfunctions.text_da_tam_dung') };
        case 'resume':
            player.pause(false);
            return { success: true, message: tr('messages.musicfunctions.text_da_tiep_tuc_phat') };
        default:
            return { success: false, message: tr('messages.musicfunctions.text_hanh_dong_khong_hop_le') };
    }
}

/**
 * 3. Audio Settings
 */
export async function adjust_audio_settings({ guild, ...settings }) {
    const player = poru.players.get(guild.id);

    // Find or create setting
    let dbSetting = await MusicSetting.findOne({ guildId: guild.id });
    if (!dbSetting) dbSetting = await MusicSetting.create({ guildId: guild.id });

    if (settings.reset) {
        dbSetting.volume = 100;
        dbSetting.speed = 1.0;
        dbSetting.pitch = 1.0;
        dbSetting.nightcore = false;
        dbSetting.bassboost = false;
    } else {
        if (settings.volume !== undefined) dbSetting.volume = settings.volume;
        if (settings.speed !== undefined) dbSetting.speed = settings.speed;
        if (settings.pitch !== undefined) dbSetting.pitch = settings.pitch;
        if (settings.nightcore !== undefined) {
            dbSetting.nightcore = settings.nightcore;
            if (dbSetting.nightcore) {
                dbSetting.speed = 1.2;
                dbSetting.pitch = 1.2;
            } else {
                dbSetting.speed = 1.0;
                dbSetting.pitch = 1.0;
            }
        }
        if (settings.bassboost !== undefined) dbSetting.bassboost = settings.bassboost;
    }

    await dbSetting.save();

    // Apply if player exists
    if (player) {
        await applyAudioSettings(player);
        return {
            success: true,
            message: tr('messages.musicfunctions.text_da_cap_nhat_cai_dat_am_thanh'),
            settings: {
                volume: dbSetting.volume,
                nightcore: dbSetting.nightcore,
                speed: dbSetting.speed
            }
        };
    }

    return {
        success: true,
        message: tr('messages.musicfunctions.text_da_luu_cai_dat_ap_dung_khi'),
        settings: {
            volume: dbSetting.volume
        }
    };
}

/**
 * 4. Manage Radio
 */
export async function manage_radio({ guild, user, action, query, index }) {
    if (action === 'add') {
        if (!query) return { success: false, message: tr('messages.musicfunctions.text_vui_long_nhap_link_bai_hat') };

        // Check URL validity using Poru
        const isUrl = /^https?:\/\//.test(query);
        const res = await poru.resolve({ query, source: isUrl ? null : 'ytsearch', requester: user });
        if (!isSuccess(res)) {
            return { success: false, message: tr('messages.musicfunctions.text_link_khong_hop_le_hoac_khong_tim') };
        }

        let title = tr('messages.musicfunctions.text_unknown');
        let url = query;
        if (res.tracks.length > 0) {
            title = res.tracks[0].info.title;
            url = res.tracks[0].info.uri;
        }

        await RadioSong.create({
            url: url,
            title: title,
            addedBy: user.username
        });
        return { success: true, message: tr('messages.musicfunctions.text_da_them_vao_radio', { title: title }) };
    }

    else if (action === 'remove') {
        const songs = await RadioSong.find().sort({ addedAt: 1 });
        if (!index || index < 1 || index > songs.length) return { success: false, message: tr('messages.musicfunctions.text_so_thu_tu_khong_hop_le') };

        const songToRemove = songs[index - 1];
        await RadioSong.findByIdAndDelete(songToRemove._id);
        return { success: true, message: tr('messages.musicfunctions.text_da_xoa_khoi_radio', { title: songToRemove.title }) };
    }

    return { success: false, message: tr('messages.musicfunctions.text_hanh_dong_khong_hop_le') };
}

/**
 * 5. Show Music Panel
 */
export async function show_music_panel({ guild, channel, user }) {
    // Clear old panel state
    await PanelState.deleteMany({ channelId: channel.id });

    const initialState = {
        currentTab: 'home',
        radioPage: 1,
        queuePage: 1,
        selectedPlaylistId: null
    };

    const payload = await renderMusicPanel(guild.id, initialState, user.id);
    const message = await channel.send(payload);

    await PanelState.create({
        guildId: guild.id,
        channelId: channel.id,
        messageId: message.id,
        ...initialState
    });

    return {
        success: true,
        message: tr('messages.musicfunctions.text_da_hien_thi_bang_dieu_khien_nhac'),
        panelId: message.id,
        channel: channel.name
    };
}
