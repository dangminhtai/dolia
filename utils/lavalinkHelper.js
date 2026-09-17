import { t as tr } from '../services/i18nService.js';
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
    'ytsearch': tr('messages.providers.ytsearch'),
    'ytmsearch': tr('messages.providers.ytmsearch'),
    'scsearch': tr('messages.providers.scsearch'),
    'spsearch': tr('messages.providers.spsearch')
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
        console.error(tr('logs.lavalinkhelper.error_loi_khi_doc_musicprovider_cua_user'), e.message);
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
export async function resolveWithProvider({ poru, query, userId, userTag = tr('messages.lavalinkhelper.text_unknown'), requester }) {
    const isUrl = /^https?:\/\//.test(query);
    const source = isUrl ? null : await getUserMusicSource(userId);
    const providerName = isUrl ? tr('messages.lavalinkhelper.text_link_truc_tiep_url') : (PROVIDER_NAMES[source] || source);

    Logger.info(tr('logs.lavalinkhelper.info_music_tim_kiem_user_provider', { query: query, userTag: userTag, providerName: providerName, value: source || 'direct' }));

    const res = await poru.resolve({ query, source, requester });

    const trackCount = res?.tracks?.length || 0;
    if (!res || isFailed(res?.loadType)) {
        Logger.warn(tr('logs.lavalinkhelper.warn_music_that_bai_loadtype_nguon', { loadType: res?.loadType, providerName: providerName }));
    } else if (isEmpty(res?.loadType, res?.tracks)) {
        Logger.warn(tr('logs.lavalinkhelper.warn_music_rong_khong_tim_thay_bai_nao', { providerName: providerName, query: query }));
    } else {
        const firstTrack = res.tracks[0];
        const firstTitle = firstTrack?.info?.title || tr('messages.lavalinkhelper.text_unknown');
        const sourceName = firstTrack?.info?.sourceName || source || 'unknown';
        Logger.success(tr('logs.lavalinkhelper.success_music_thanh_cong_tim_thay_bai_bai', { loadType: res.loadType, trackCount: trackCount, firstTitle: firstTitle, sourceName: sourceName }));
    }

    return { res, source, providerName };
}
