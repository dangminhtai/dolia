import mongoose from 'mongoose';

const GuildMusicQueueSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    tracks: [{
        title: String,
        url: String,
        author: String,
        duration: Number,
        requester: String,
        addedAt: { type: Date, default: Date.now }
    }],
    updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model('GuildMusicQueue', GuildMusicQueueSchema);