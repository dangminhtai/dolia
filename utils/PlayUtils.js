import { t as tr } from '../services/i18nService.js';
import { poru } from './LavalinkManager.js';
import { applyAudioSettings } from './AudioController.js';
import GuildMusicQueue from '../models/GuildMusicQueue.js';
import { ChannelType } from 'discord.js';
import { t } from '../services/i18nService.js';
import { getUserMusicSource, isFailed, isEmpty, isPlaylist, resolveWithProvider } from './lavalinkHelper.js';

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
        return { success: false, message: t('music.errors.no_voice_channel') };
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
    let res;
    try {
        const resolveResult = await resolveWithProvider({
            poru,
            query,
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            requester: interaction.user
        });
        res = resolveResult.res;
    } catch (error) {
        console.error(tr('logs.playutils.error_lavalink_resolve_error'), error);
        return { success: false, message: t('music.errors.lavalink_error') };
    }

    if (!res || isFailed(res.loadType)) {
        return { success: false, message: t('music.errors.load_failed_alt') };
    } else if (isEmpty(res.loadType, res.tracks)) {
        return { success: false, message: t('music.errors.no_matches') };
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
    if (isPlaylist(res.loadType)) {
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
            msg = t('music.play.priority_playlist', { name: res.playlistInfo.name, count: res.tracks.length });
        } else {
            // Normal: Queue Add
            player.queue.add(res.tracks);
            msg = t('music.play.added_playlist', { name: res.playlistInfo.name, count: res.tracks.length });
        }
    }
    // --- SINGLE TRACK ---
    else {
        const track = res.tracks[0];
        track.info.requester = interaction.user;
        tracksToAdd.push(formatTrackForDB(track));

        if (isPriority) {
            player.queue.unshift(track);
            msg = t('music.play.priority_track', { title: track.info.title });
        } else {
            player.queue.add(track);
            if (player.isPlaying || player.isPaused) {
                msg = t('music.play.added_to_queue', { title: track.info.title });
            } else {
                msg = t('music.play.now_playing', { title: track.info.title });
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
    ).catch(e => console.error(tr('logs.playutils.error_loi_luu_queue_db'), e));

    // 5. Playback Control
    if (isPriority) {
        if (player.isPlaying || player.isPaused) player.skip();
        else player.play();
    } else {
        if (!player.isPlaying && !player.isPaused) player.play();
    }

    return { success: true, message: msg };
}
