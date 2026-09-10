import mongoose from 'mongoose';

const MusicSettingSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    volume: { type: Number, default: 100 },
    speed: { type: Number, default: 1.0 }, // Tốc độ (1.0 là chuẩn)
    pitch: { type: Number, default: 1.0 }, // Cao độ
    bassboost: { type: Boolean, default: false },
    nightcore: { type: Boolean, default: false }
});

export default mongoose.model('MusicSetting', MusicSettingSchema);