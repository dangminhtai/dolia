import mongoose from 'mongoose';

const APIStatusSchema = new mongoose.Schema({
    // key/model giữ alias để tương thích index cũ; không lưu raw API key ở collection này.
    key: { type: String, required: true },
    model: { type: String, required: true },
    projectId: { type: String, default: 'unknown' },
    keyAlias: { type: String, required: true },
    modelId: { type: String, required: true },
    scope: { type: String, default: 'PROJECT_MODEL' },
    state: { type: String, enum: ['CLOSED', 'OPEN', 'HALF_OPEN'], default: 'CLOSED' },
    cooldownUntil: { type: Date, default: null },
    circuitUntil: { type: Date, default: null },
    suspendedUntil: { type: Date, default: Date.now },
    reason: { type: String, default: null },
    lastStatusCode: { type: Number, default: null },
    lastErrorCategory: { type: String, default: null },
    consecutiveFailures: { type: Number, default: 0 },
    consecutiveSuccesses: { type: Number, default: 0 },
    lastFailureAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    ewmaLatencyMs: { type: Number, default: 0 }
}, { timestamps: true });

// Index for fast lookups and auto-expire (TTL)
// We set TTL dynamically or just query by date. 
// Let's index for efficient querying.
APIStatusSchema.index({ key: 1, model: 1 }, { unique: true });
APIStatusSchema.index({ suspendedUntil: 1 }); // To find expired suspensions
APIStatusSchema.index({ projectId: 1, modelId: 1, state: 1 });

export default mongoose.model('APIStatus', APIStatusSchema);
