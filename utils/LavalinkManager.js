import { t as tr } from '../services/i18nService.js';
import { Poru } from 'poru';
import RadioSong from '../models/RadioSong.js';
import MusicLog from '../models/MusicLog.js';
import GuildMusicQueue from '../models/GuildMusicQueue.js';
import { t } from '../services/i18nService.js';
import { isSuccess } from './lavalinkHelper.js';
import Logger from '../class/Logger.js';

// Chỉ giữ lại Node "vàng" đã kết nối thành công
const nodes = [
    {
        name: 'Lavalink-1',
        host: 'lava-v4.millohost.my.id',
        port: 443,
        password: 'https://discord.gg/mjS5J2K3ep',
        secure: true,
    }
];

export let poru;
let client;

// Hàm hỗ trợ: Lấy kênh tin nhắn an toàn (Cache -> Fetch)
async function getSafeChannel(channelId) {
    if (!channelId) return null;
    try {
        // 1. Tìm trong cache trước (nhanh)
        let channel = client.channels.cache.get(channelId);
        // 2. Nếu không thấy, dùng fetch để lấy từ API Discord (chậm hơn xíu nhưng chắc chắn)
        if (!channel) {
            channel = await client.channels.fetch(channelId).catch(() => null);
        }
        return channel;
    } catch (e) {
        console.error(tr('logs.lavalinkmanager.error_khong_tim_thay_channel', { channelId: channelId }), e.message);
        return null;
    }
}

// Hàm hỗ trợ: Lấy 1 bài hát ngẫu nhiên từ kho nhạc Radio
async function getRandomTrack() {
    try {
        const randomSong = await RadioSong.aggregate([{ $sample: { size: 1 } }]);
        return randomSong.length > 0 ? randomSong[0] : null;
    } catch (e) {
        console.error(tr('logs.lavalinkmanager.error_loi_lay_nhac_random'), e);
        return null;
    }
}

export function initLavalink(discordClient) {
    client = discordClient;

    poru = new Poru(client, nodes, {
        library: 'discord.js',
        defaultPlatform: 'ytsearch',
        reconnectTries: Infinity,
    });

    // Patch lỗi nội bộ thư viện Poru khi Discord gửi gói tin VOICE_SERVER_UPDATE rỗng (endpoint null khi ngắt kết nối voice)
    const origPacketUpdate = poru.packetUpdate.bind(poru);
    poru.packetUpdate = async function (packet) {
        if (packet?.t === 'VOICE_SERVER_UPDATE' && !packet?.d?.endpoint) {
            return;
        }
        try {
            await origPacketUpdate(packet);
        } catch (err) {
            if (err.message && err.message.includes('No Session id found')) {
                return;
            }
            Logger.warn(tr('logs.lavalinkmanager.warn_lavalink_poru_packetupdate_handled_error', { message: err.message }));
        }
    };

    poru.init(client);

    poru.on('nodeConnect', node => console.log(tr('logs.lavalinkmanager.log_lavalink_node_da_ket_noi', { name: node.name })));
    poru.on('nodeDisconnect', node => console.log(tr('logs.lavalinkmanager.log_lavalink_mat_ket_noi_node', { name: node.name })));
    poru.on('nodeError', (node, error) => console.log(tr('logs.lavalinkmanager.log_lavalink_node_loi', { name: node.name, message: error.message })));

    // --- SỰ KIỆN TRACK START (BẮT ĐẦU PHÁT) ---
    poru.on('trackStart', async (player, track) => {
        // FIX: Dùng hàm getSafeChannel để đảm bảo lấy được kênh
        const channel = await getSafeChannel(player.textChannel);

        const duration = track.info.length;
        const timeString = track.info.isStream ? tr('messages.lavalinkmanager.text_live') : new Date(duration).toISOString().slice(14, 19);
        const requester = track.info.requester?.tag || client.user?.tag || tr('messages.lavalinkmanager.text_unknown');
        const sourceName = track.info.sourceName || 'unknown';

        Logger.info(tr('logs.lavalinkmanager.info_music_bat_dau_phat_kenh_provider_goc', { title: track.info.title, timeString: timeString, author: track.info.author, sourceName: sourceName }));

        if (channel) {
            // Gửi tin nhắn (Catch lỗi nếu bot thiếu quyền gửi tin)
            channel.send(t('music.track_start', { title: track.info.title, time: timeString, requester: requester })).catch(e => console.error(tr('logs.lavalinkmanager.error_khong_gui_duoc_tin_nhan_trackstart'), e.message));
        }

        // Đồng bộ Queue DB
        try {
            await GuildMusicQueue.updateOne(
                { guildId: player.guildId },
                { $pop: { tracks: -1 } }
            );
        } catch (e) { }

        // Ghi Log
        try {
            await MusicLog.create({
                guildId: player.guildId,
                channelId: player.textChannel,
                trackTitle: track.info.title,
                trackUrl: track.info.uri,
                trackAuthor: track.info.author,
                duration: track.info.length,
                requesterId: track.info.requester?.id || client.user.id,
                requesterTag: track.info.requester?.tag || client.user.tag,
                isAutoPlay: player.isAutoplay || false
            });
        } catch (err) { console.error(tr('logs.lavalinkmanager.error_loi_log_nhac'), err.message); }
    });

    // --- SỰ KIỆN TRACK ERROR (NHẠC LỖI) ---
    // Cái này cực quan trọng: Nếu bài hát lỗi, nó sẽ không crash mà tự gọi queueEnd hoặc skip
    poru.on('trackError', async (player, track, error) => {
        console.error(tr('logs.lavalinkmanager.error_track_loi', { title: track.info.title }), error);

        // Gửi thông báo lỗi cho người dùng
        const channel = await getSafeChannel(player.textChannel);
        if (channel) {
            channel.send(t('music.track_error', { title: track.info.title })).catch(() => { });
        }

        // Tự động skip sang bài khác (nếu còn) hoặc queueEnd sẽ tự chạy
        if (player.queue.size > 0) {
            player.stop();
        } else {
            // Nếu không còn nhạc, event queueEnd sẽ lo. 
            // Nhưng để chắc ăn, gọi stop() để kích hoạt dòng chảy sự kiện.
            player.stop();
        }
    });

    poru.on('trackStuck', async (player, track, threshold) => {
        console.warn(tr('logs.lavalinkmanager.warn_track_bi_ket_qua_ms_dang_auto', { title: track.info.title, threshold: threshold }));

        const channel = await getSafeChannel(player.textChannel);
        if (channel) {
            channel.send(t('music.track_stuck', { title: track.info.title })).catch(() => { });
        }

        // Bắt buộc dừng player để kích hoạt sự kiện tiếp theo
        // Sử dụng try-catch để tránh crash nếu player đã bị destroy
        try {
            player.stop();
        } catch (err) {
            console.error(tr('logs.lavalinkmanager.error_loi_khi_co_stop_track_bi_ket'), err);
            // Nếu stop lỗi (vd player chết), thử destroy luôn để reset
            player.destroy();
        }
    });

    // --- SỰ KIỆN QUEUE END (HẾT NHẠC) ---
    poru.on('queueEnd', async (player) => {
        const channel = await getSafeChannel(player.textChannel);

        // 1. Kiểm tra chế độ 24/7
        if (player.isAutoplay) {
            // Lấy nhạc từ DB
            const songData = await getRandomTrack();

            if (!songData) {
                if (channel) channel.send(t('music.radio_empty'));
                player.isAutoplay = false;
                player.destroy();
                return;
            }

            // Resolve nhạc
            const res = await poru.resolve({ query: songData.url, source: 'ytsearch', requester: client.user });

            if (isSuccess(res)) {
                const track = res.tracks[0];
                track.info.requester = client.user;

                player.queue.add(track);
                player.play();

                if (channel) channel.send(t('music.radio_auto_play', { title: songData.title })).catch(() => { });
                return; // QUAN TRỌNG: Return để không chạy code bên dưới
            } else {
                // Nếu bài lấy từ DB bị lỗi link -> Thử lấy bài khác ngay lập tức (Đệ quy nhẹ)
                console.log(tr('logs.lavalinkmanager.log_bai_radio_bi_loi_dang_thu_bai'));
                // poru.emit('queueEnd', player); // Gọi lại sự kiện này để thử lại (Cẩn thận loop vô tận, nên thôi)
            }
        }

        // 2. Nếu thực sự hết nhạc và không cứu được
        if (channel) channel.send(t('music.queue_end')).catch(() => { });

        await GuildMusicQueue.deleteOne({ guildId: player.guildId }).catch(() => { });
        player.destroy();
    });
}