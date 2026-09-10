import mongoose from 'mongoose';

const RadioSongSchema = new mongoose.Schema({
    url: { type: String, required: true },
    title: { type: String, required: true }, // Lưu tên để dễ quản lý
    addedBy: { type: String }, // Ai thêm bài này
    addedAt: { type: Date, default: Date.now }
});

export default mongoose.model('RadioSong', RadioSongSchema);