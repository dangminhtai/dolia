
import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    chatLimit: { type: Number, default: 20 },
    musicProvider: {
        type: String,
        default: 'ytsearch',
        enum: ['ytsearch', 'ytmsearch', 'scsearch', 'spsearch']
    },
    // ytsearch = YouTube, ytmsearch = YouTube Music, scsearch = SoundCloud, spsearch = Spotify
}, { timestamps: true });

const User = mongoose.model("User", UserSchema);

export default User;
