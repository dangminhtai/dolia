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
        return { success: false, error: "NO_VOICE", message: "Bạn cần vào Voice Channel hoặc Server cần có một Voice Channel trống để mình vào nhé!" };
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
            console.error("Poru Create Connection Error:", err);
            return { success: false, error: "CONNECTION_ERROR", message: "Không thể kết nối đến Voice (No Nodes Available)." };
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
            console.warn(`⚠️ Music Resolve Error (Attempt ${resolveAttempts + 1}/${maxResolveRetries}): ${err.message}`);
            resolveAttempts++;
            if (resolveAttempts >= maxResolveRetries) {
                return { success: false, error: "RESOLVE_FAILED", message: "Lỗi kết nối đến máy chủ nhạc (Timeout/Proxy Error)." };
            }
            // Wait 1s before retry
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    if (!res || isFailed(res.loadType)) {
        return { success: false, error: "LOAD_FAILED", message: "Lỗi tải nhạc từ nguồn." };
    } else if (isEmpty(res.loadType, res.tracks)) {
        return { success: false, error: "NO_MATCHES", message: "Không tìm thấy bài hát nào." };
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
        return { success: false, error: "PLAYER_NOT_READY", message: "Trình phát nhạc chưa sẵn sàng, bạn đợi một chút rồi thử lại nhé!" };
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
            addedMsg = `⚡ [ƯU TIÊN] Playlist: ${res.playlistInfo.name}`;
        } else {
            player.queue.add(res.tracks);
            addedMsg = `Playlist: ${res.playlistInfo.name}`;
        }
    } else {
        const track = res.tracks[0];
        if (!track) {
            return { success: false, error: "TRACK_UNDEFINED", message: "Không tìm thấy thông tin bài hát." };
        }
        track.info.requester = user;
        tracksToAdd.push(formatTrackForDB(track));

        if (priority) {
            player.queue.unshift(track);
            addedMsg = `⚡ [ƯU TIÊN] Bài: ${track.info.title}`;
        } else {
            player.queue.add(track);
            addedMsg = `Bài: ${track.info.title}`;
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
    ).catch(e => console.error('Lỗi lưu Queue DB:', e));


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
    if (!player) return { success: false, message: "❌ Bot chưa phát nhạc." };

    switch (action) {
        case 'skip':
            player.skip();
            return { success: true, message: "⏭️ Đã bỏ qua bài hát." };
        case 'stop':
            await player.destroy();
            return { success: true, message: "🛑 Đã dừng nhạc và rời kênh." };
        case 'pause':
            player.pause(true);
            return { success: true, message: "⏸️ Đã tạm dừng." };
        case 'resume':
            player.pause(false);
            return { success: true, message: "▶️ Đã tiếp tục phát." };
        default:
            return { success: false, message: "❌ Hành động không hợp lệ." };
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
            message: `✅ Đã cập nhật cài đặt âm thanh!`,
            settings: {
                volume: dbSetting.volume,
                nightcore: dbSetting.nightcore,
                speed: dbSetting.speed
            }
        };
    }

    return {
        success: true,
        message: `✅ Đã lưu cài đặt (áp dụng khi phát nhạc).`,
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
        if (!query) return { success: false, message: "❌ Vui lòng nhập link bài hát." };

        // Check URL validity using Poru
        const isUrl = /^https?:\/\//.test(query);
        const res = await poru.resolve({ query, source: isUrl ? null : 'ytsearch', requester: user });
        if (!isSuccess(res)) {
            return { success: false, message: "❌ Link không hợp lệ hoặc không tìm thấy nhạc." };
        }

        let title = "Unknown";
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
        return { success: true, message: `✅ Đã thêm vào Radio: **${title}**` };
    }

    else if (action === 'remove') {
        const songs = await RadioSong.find().sort({ addedAt: 1 });
        if (!index || index < 1 || index > songs.length) return { success: false, message: "❌ Số thứ tự không hợp lệ." };

        const songToRemove = songs[index - 1];
        await RadioSong.findByIdAndDelete(songToRemove._id);
        return { success: true, message: `🗑️ Đã xóa khỏi Radio: **${songToRemove.title}**` };
    }

    return { success: false, message: "❌ Hành động không hợp lệ." };
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
        message: "✅ Đã hiển thị bảng điều khiển nhạc.",
        panelId: message.id,
        channel: channel.name
    };
}
