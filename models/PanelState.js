
import mongoose from 'mongoose';

const PanelStateSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true, unique: true }, // ID của tin nhắn chứa Panel
    currentTab: { type: String, default: 'home' }, // Tab hiện tại đang mở
    radioPage: { type: Number, default: 1 },
    queuePage: { type: Number, default: 1 },
    selectedPlaylistId: { type: String, default: null }, // Playlist đang chọn
    updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model('PanelState', PanelStateSchema);
