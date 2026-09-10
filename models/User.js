
import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    chatLimit: { type: Number, default: 20 },
    musicProvider: {
        type: String,
        default: 'ytsearch',
        enum: ['ytsearch', 'scsearch', 'spsearch', 'amsearch']
    },
    // ytsearch = YouTube, scsearch = SoundCloud, spsearch = Spotify, amsearch = Apple Music
}, { timestamps: true });

const User = mongoose.model("User", UserSchema);

export default User;
