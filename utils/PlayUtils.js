import { poru } from './LavalinkManager.js';
import { applyAudioSettings } from './AudioController.js';
import GuildMusicQueue from '../models/GuildMusicQueue.js';
import { ChannelType } from 'discord.js';

/**
 * Common logic to handle Play/Priority requests
 * @param {Object} interaction - The source interaction (Command or Modal)
 * @param {string} query - The song name or URL
 * @param {boolean} isPriority - Whether to prioritize this request
 */
export async function executePlay(interaction, query, isPriority) {
    const member = interaction.member;
    let voiceChannel = member.voice.channel;
    let player = poru.players.get(interaction.guild.id);

    // --- LOGIC CHỌN KÊNH VOICE THÔNG MINH (REMOTE CONTROL) ---
    if (!voiceChannel) {
        if (player && player.isConnected) {
            // Nếu Bot đang hát ở đâu đó -> Dùng luôn kênh đó
            voiceChannel = interaction.guild.channels.cache.get(player.voiceChannel);
        } else {
            // Nếu Bot chưa hát -> Tự động tìm kênh Voice đầu tiên
            voiceChannel = interaction.guild.channels.cache
                .filter(c => c.type === ChannelType.GuildVoice && c.joinable && !c.full)
                .first();
        }
    }

    if (!voiceChannel) {
        return { success: false, message: '❌ Bot không tìm thấy kênh Voice nào để vào cả!' };
    }

    // 1. Get/Create Player
    if (!player) {
        player = poru.createConnection({
            guildId: interaction.guild.id,
            voiceChannel: voiceChannel.id,
            textChannel: interaction.channel.id,
            deaf: false,
        });
        await applyAudioSettings(player);
    }

    // 2. Resolve Track
    // Auto-detect source: If URL, source=null. If text, source='ytsearch'
    const isUrl = /^https?:\/\//.test(query);
    let res;
    try {
        res = await poru.resolve({ query: query, source: isUrl ? null : 'ytsearch', requester: interaction.user });
    } catch (error) {
        console.error('Lavalink Resolve Error:', error);
        return { success: false, message: '❌ Lỗi kết nối Lavalink!' };
    }

    if (!res || res.loadType === 'LOAD_FAILED') {
        return { success: false, message: '❌ Lỗi khi tải nhạc.' };
    } else if (res.loadType === 'NO_MATCHES') {
        return { success: false, message: '❌ Không tìm thấy bài nào!' };
    }

    // 3. Process Tracks
    const tracksToAdd = [];
    let msg = '';

    // Helper to format for DB
    const formatTrackForDB = (track) => ({
        title: track.info.title,
        url: track.info.uri,
        author: track.info.author,
        duration: track.info.length,
        requester: interaction.user.tag,
        addedAt: new Date()
    });

    // --- PLAYLIST ---
    if (res.loadType === 'PLAYLIST_LOADED') {
        // Prepare DB Data first (Normal Order)
        for (const track of res.tracks) {
            track.info.requester = interaction.user;
            tracksToAdd.push(formatTrackForDB(track));
        }

        if (isPriority) {
            // Priority: Queue Unshift (Reverse Order to keep playlist order at top)
            for (let i = res.tracks.length - 1; i >= 0; i--) {
                player.queue.unshift(res.tracks[i]);
            }
            msg = `🚀 **[ƯU TIÊN]** Đã chèn Playlist **${res.playlistInfo.name}** (${res.tracks.length} bài) lên đầu!`;
        } else {
            // Normal: Queue Add
            player.queue.add(res.tracks);
            msg = `✅ Đã thêm Playlist **${res.playlistInfo.name}** (${res.tracks.length} bài).`;
        }
    }
    // --- SINGLE TRACK ---
    else {
        const track = res.tracks[0];
        track.info.requester = interaction.user;
        tracksToAdd.push(formatTrackForDB(track));

        if (isPriority) {
            player.queue.unshift(track);
            msg = `🚀 **[ƯU TIÊN]** Đã chèn bài **${track.info.title}**!`;
        } else {
            player.queue.add(track);
            if (player.isPlaying || player.isPaused) {
                msg = `✅ Đã thêm **${track.info.title}** vào hàng chờ.`;
            } else {
                msg = `▶️ Đang phát: **${track.info.title}**`;
            }
        }
    }

    // 4. Sync DB
    const updateQuery = isPriority
        ? { $push: { tracks: { $each: tracksToAdd, $position: 0 } } }
        : { $push: { tracks: { $each: tracksToAdd } } };

    GuildMusicQueue.updateOne(
        { guildId: interaction.guild.id },
        { ...updateQuery, $set: { updatedAt: new Date() } },
        { upsert: true }
    ).catch(e => console.error('Lỗi lưu Queue DB:', e));

    // 5. Playback Control
    if (isPriority) {
        if (player.isPlaying || player.isPaused) player.skip();
        else player.play();
    } else {
        if (!player.isPlaying && !player.isPaused) player.play();
    }

    return { success: true, message: msg };
}
