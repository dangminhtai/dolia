import User from '../models/User.js';
import Logger from '../class/Logger.js';

export const LoadType = {
    TRACK: 'track',
    PLAYLIST: 'playlist',
    SEARCH: 'search',
    EMPTY: 'empty',
    ERROR: 'error'
};

export const PROVIDER_NAMES = {
    'ytsearch': 'YouTube',
    'ytmsearch': 'YouTube Music',
    'scsearch': 'SoundCloud',
    'spsearch': 'Spotify'
};

export const VALID_PROVIDERS = Object.keys(PROVIDER_NAMES);

/**
 * Kiểm tra xem kết quả có bị lỗi không (hỗ trợ cả v4 và v3 fallback)
 */
export function isFailed(loadType) {
    return loadType === 'error' || loadType === 'LOAD_FAILED';
}

/**
 * Kiểm tra xem kết quả có rỗng / không tìm thấy bài nào không
 */
export function isEmpty(loadType, tracks = null) {
    if (loadType === 'empty' || loadType === 'NO_MATCHES') return true;
    if (tracks && Array.isArray(tracks) && tracks.length === 0) return true;
    return false;
}

/**
 * Kiểm tra xem kết quả có phải là một Playlist không
 */
export function isPlaylist(loadType) {
    return loadType === 'playlist' || loadType === 'PLAYLIST_LOADED';
}

/**
 * Kiểm tra xem kết quả có phải là một bài đơn lẻ không
 */
export function isTrack(loadType) {
    return loadType === 'track' || loadType === 'TRACK_LOADED';
}

/**
 * Kiểm tra xem kết quả có phải là danh sách tìm kiếm không
 */
export function isSearch(loadType) {
    return loadType === 'search' || loadType === 'SEARCH_RESULT';
}

/**
 * Kiểm tra xem resolve có thành công trả về ít nhất 1 bài hát không
 */
export function isSuccess(res) {
    if (!res) return false;
    const loadType = res.loadType;
    if (isFailed(loadType) || isEmpty(loadType)) return false;
    return Array.isArray(res.tracks) && res.tracks.length > 0;
}

/**
 * Lấy nguồn phát nhạc ưa thích của người dùng từ Database
 * @param {string} userId Discord User ID
 * @param {string} defaultSource Nguồn mặc định nếu chưa lưu hoặc không hợp lệ
 * @returns {Promise<string>}
 */
export async function getUserMusicSource(userId, defaultSource = 'ytsearch') {
    if (!userId) return defaultSource;
    try {
        const userConfig = await User.findOne({ userId });
        if (userConfig && userConfig.musicProvider && VALID_PROVIDERS.includes(userConfig.musicProvider)) {
            return userConfig.musicProvider;
        }
    } catch (e) {
        console.error('Lỗi khi đọc musicProvider của user:', e.message);
    }
    return defaultSource;
}

/**
 * Tìm kiếm bài hát qua Poru kết hợp tự động phát hiện Provider của User và ghi Log chi tiết
 * @param {Object} options
 * @param {Object} options.poru Instance Poru
 * @param {string} options.query Từ khóa hoặc URL cần tìm
 * @param {string} options.userId ID của người dùng gọi lệnh
 * @param {string} [options.userTag] Tag hoặc username của người dùng (phục vụ log)
 * @param {Object} [options.requester] Requester object để gắn vào track
 * @returns {Promise<{res: Object, source: string|null, providerName: string}>}
 */
export async function resolveWithProvider({ poru, query, userId, userTag = 'Unknown', requester }) {
    const isUrl = /^https?:\/\//.test(query);
    const source = isUrl ? null : await getUserMusicSource(userId);
    const providerName = isUrl ? 'Link trực tiếp (URL)' : (PROVIDER_NAMES[source] || source);

    Logger.info(`[Music] 🔍 Tìm kiếm: "${query}" | User: ${userTag} | Provider: ${providerName} (${source || 'direct'})`);

    const res = await poru.resolve({ query, source, requester });

    const trackCount = res?.tracks?.length || 0;
    if (!res || isFailed(res?.loadType)) {
        Logger.warn(`[Music] ❌ Thất bại: loadType="${res?.loadType}" | Nguồn: [${providerName}]`);
    } else if (isEmpty(res?.loadType, res?.tracks)) {
        Logger.warn(`[Music] ⚠️ Rỗng: Không tìm thấy bài nào từ [${providerName}] | Query: "${query}"`);
    } else {
        const firstTrack = res.tracks[0];
        const firstTitle = firstTrack?.info?.title || 'Unknown';
        const sourceName = firstTrack?.info?.sourceName || source || 'unknown';
        Logger.success(`[Music] ✨ Thành công: [${res.loadType}] tìm thấy ${trackCount} bài | Bài đầu: "${firstTitle}" [Nguồn: ${sourceName}]`);
    }

    return { res, source, providerName };
}
