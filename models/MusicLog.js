import mongoose from 'mongoose';

const MusicLogSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    channelId: { type: String },

    // Thông tin bài hát
    trackTitle: { type: String, required: true },
    trackUrl: { type: String, required: true },
    trackAuthor: { type: String }, // Tên kênh YouTube/Ca sĩ
    duration: { type: Number }, // Độ dài (ms)

    // Người yêu cầu
    requesterId: { type: String }, // ID người dùng
    requesterTag: { type: String }, // Tên hiển thị (VD: Tamida#1234)

    // Thời gian
    playedAt: { type: Date, default: Date.now },

    // Đánh dấu xem là nhạc User request hay nhạc Radio 24/7
    isAutoPlay: { type: Boolean, default: false }
});

export default mongoose.model('MusicLog', MusicLogSchema);