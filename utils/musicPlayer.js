import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    StreamType,
} from '@discordjs/voice';
import ytdl from '@distube/ytdl-core'; // <-- Dùng thư viện mới xịn hơn

/**
 * Map guildId -> { connection, player, queue, channelId, guildId }
 * Queue item: { url, title, requestedBy }
 */
const guildStates = new Map();

let _onTrackDone = () => { };
/** Gọi khi playNext shift (track vừa lấy ra để phát hoặc bỏ) — để đồng bộ DB (GuildMusicQueue $pop). */
export function setOnTrackDone(fn) {
    _onTrackDone = typeof fn === 'function' ? fn : () => { };
}

/**
 * @param {import('discord.js').VoiceChannel} voiceChannel
 * @returns {{ connection: import('@discordjs/voice').VoiceConnection, player: import('@discordjs/voice').AudioPlayer, queue: Array<{url:string,title:string,requestedBy:string}>, channelId: string, guildId: string }}
 */
function join(voiceChannel) {
    const guildId = voiceChannel.guild.id;
    const channelId = voiceChannel.id;
    const existing = guildStates.get(guildId);

    if (existing) {
        if (existing.channelId === channelId) return existing;
        existing.connection.destroy();
        guildStates.delete(guildId);
    }

    const connection = joinVoiceChannel({
        channelId,
        guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: true,
    });

    const player = createAudioPlayer();
    connection.subscribe(player);

    const state = {
        connection,
        player,
        queue: [],
        channelId,
        guildId,
        currentTrack: null,
    };

    player.on('stateChange', (oldState, newState) => {
        if (newState.status === AudioPlayerStatus.Idle && oldState.status === AudioPlayerStatus.Playing) {
            playNext(guildId).catch((err) => {
                console.error('[musicPlayer] playNext error:', err);
                const s = guildStates.get(guildId);
                if (s && s.queue.length === 0) leave(guildId);
            });
        }
    });

    guildStates.set(guildId, state);
    return state;
}

/**
 * @param {string} guildId
 */
function leave(guildId) {
    const state = guildStates.get(guildId);
    if (!state) return;
    try {
        state.connection.destroy();
    } catch (_) { }
    guildStates.delete(guildId);
}

/**
 * @param {string} guildId
 * @param {{ url: string, title: string, requestedBy: string }} item
 * @returns {boolean} true nếu đang phát ngay (queue was empty), false nếu chỉ thêm vào queue
 */
function addTrack(guildId, item) {
    const state = guildStates.get(guildId);
    if (!state) return false;
    state.queue.push(item);
    const wasIdle =
        state.player.state.status === AudioPlayerStatus.Idle ||
        state.player.state.status === AudioPlayerStatus.Buffering;
    if (wasIdle) {
        playNext(guildId).catch((err) => console.error('[musicPlayer] addTrack playNext:', err));
        return true;
    }
    return false;
}

/**
 * @param {string} guildId
 */
async function playNext(guildId) {
    const state = guildStates.get(guildId);
    if (!state) return;
    if (state.queue.length === 0) {
        state.currentTrack = null;
        leave(guildId);
        return;
    }
    const item = state.queue.shift();
    state.currentTrack = item;
    try {
        _onTrackDone(guildId);
    } catch (e) {
        console.error('[musicPlayer] onTrackDone:', e);
    }

    try {
        console.log('[musicPlayer] Streaming:', item.url);

        // --- FIX LỖI Ở ĐÂY ---
        // Sử dụng ytdl-core thay vì play-dl
        const stream = ytdl(item.url, {
            filter: 'audioonly', // Chỉ lấy âm thanh
            quality: 'highestaudio', // Chất lượng cao nhất
            highWaterMark: 1 << 25, // Bộ đệm lớn (32MB) để tránh lag
            dlChunkSize: 0, // Tải liên tục không ngắt quãng
        });

        // Tạo resource từ stream của ytdl
        // Lưu ý: Không cần inputType: StreamType.Arbitrary, để mặc định nó tự detect tốt hơn
        const resource = createAudioResource(stream);

        state.player.play(resource);
        // ---------------------

    } catch (err) {
        console.error('[musicPlayer] stream error:', err);
        state.currentTrack = null;
        // Nếu lỗi bài này thì thử bài tiếp theo luôn
        return playNext(guildId);
    }
}

/**
 * @param {string} guildId
 */
function skip(guildId) {
    const state = guildStates.get(guildId);
    if (!state) return false;
    state.player.stop(true);
    return true;
}

/**
 * @param {string} guildId
 */
function clear(guildId) {
    const state = guildStates.get(guildId);
    if (!state) return;
    state.queue = [];
}

/**
 * @param {string} guildId
 */
function stop(guildId) {
    const state = guildStates.get(guildId);
    if (!state) return false;
    clear(guildId);
    state.player.stop(true);
    leave(guildId);
    return true;
}

/**
 * @param {string} guildId
 * @returns {{ queue: Array<{url:string,title:string,requestedBy:string}>, currentTrack: {url:string,title:string,requestedBy:string} | null } | null }
 */
function getState(guildId) {
    const state = guildStates.get(guildId);
    if (!state) return null;
    return {
        queue: [...state.queue],
        currentTrack: state.currentTrack,
    };
}

/**
 * @param {string} guildId
 * @returns {boolean}
 */
function isInVoice(guildId) {
    return guildStates.has(guildId);
}

export default {
    join,
    leave,
    addTrack,
    playNext,
    clear,
    skip,
    stop,
    getState,
    isInVoice,
    setOnTrackDone,
};