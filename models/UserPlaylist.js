import mongoose from 'mongoose';

const UserPlaylistSchema = new mongoose.Schema({
    userId: { type: String, required: true }, // Chủ sở hữu playlist
    name: { type: String, required: true },   // Tên Playlist (VD: Nhạc Chill)
    tracks: [{
        title: String,
        url: String,
        author: String,
        duration: Number,
        addedAt: { type: Date, default: Date.now }
    }],
    isPublic: { type: Boolean, default: false }, // Cho người khác nghe ké không?
    createdAt: { type: Date, default: Date.now }
});

// Tạo index để tìm kiếm nhanh hơn theo userId và name
UserPlaylistSchema.index({ userId: 1, name: 1 }, { unique: true });

export default mongoose.model('UserPlaylist', UserPlaylistSchema);