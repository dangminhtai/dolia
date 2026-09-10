import MusicSetting from '../models/MusicSetting.js';

// Hàm này sẽ gọi khi bot join voice hoặc khi người dùng chỉnh setting
export async function applyAudioSettings(player) {
    if (!player) return;

    // 1. Tìm setting trong DB, nếu chưa có thì tạo mới mặc định
    let setting = await MusicSetting.findOne({ guildId: player.guildId });
    if (!setting) {
        setting = await MusicSetting.create({ guildId: player.guildId });
    }

    // 2. Áp dụng Volume
    player.setVolume(setting.volume);

    // 3. Áp dụng Filters (Speed, Pitch, Bass...)
    const filters = player.filters;

    // Reset trước khi apply
    filters.clearFilters();

    // -- Timescale (Speed & Pitch) --
    // Logic: Nếu bật Nightcore thì ghi đè speed/pitch, nếu không thì dùng custom speed
    if (setting.nightcore) {
        filters.setTimescale({ speed: 1.2, pitch: 1.2, rate: 1.0 });
    } else {
        // Chỉ set nếu khác mặc định để tiết kiệm tài nguyên
        if (setting.speed !== 1.0 || setting.pitch !== 1.0) {
            filters.setTimescale({
                speed: setting.speed,
                pitch: setting.pitch,
                rate: 1.0
            });
        }
    }

    // -- Equalizer (Bassboost) --
    if (setting.bassboost) {
        filters.setEqualizer([
            { band: 0, gain: 0.3 },
            { band: 1, gain: 0.3 },
            { band: 2, gain: 0.2 },
            { band: 3, gain: 0.1 }
        ]);
    }

    return setting; // Trả về setting để dùng cho việc hiển thị
}