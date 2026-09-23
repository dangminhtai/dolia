import mongoose from 'mongoose';

const APIKeySchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true }, // VD: GEMINI_1, GEMINI_2
    provider: { type: String, default: 'Gemini' },
    isActive: { type: Boolean, default: true },
    projectId: { type: String, default: null, index: true },
    projectNumber: { type: String, default: null },
    keyType: { type: String, default: 'api_key' },
    priority: { type: Number, default: 0 },
    usageCount: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    lastUsed: { type: Date, default: Date.now },
    lastSuccessAt: { type: Date, default: null },
    lastFailureAt: { type: Date, default: null },
    disabledReason: { type: String, default: null }
}, { timestamps: true });

export default mongoose.model('APIKey', APIKeySchema);
