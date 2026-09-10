import mongoose from 'mongoose';

const APIKeySchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true }, // VD: GEMINI_1, GEMINI_2
    provider: { type: String, default: 'Gemini' },
    isActive: { type: Boolean, default: true },
    usageCount: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    lastUsed: { type: Date, default: Date.now }
});

export default mongoose.model('APIKey', APIKeySchema);
