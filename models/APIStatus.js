import mongoose from 'mongoose';

const APIStatusSchema = new mongoose.Schema({
    key: { type: String, required: true },
    model: { type: String, required: true },
    suspendedUntil: { type: Date, required: true },
    reason: { type: String, default: 'RATE_LIMIT' }
});

// Index for fast lookups and auto-expire (TTL)
// We set TTL dynamically or just query by date. 
// Let's index for efficient querying.
APIStatusSchema.index({ key: 1, model: 1 }, { unique: true });
APIStatusSchema.index({ suspendedUntil: 1 }); // To find expired suspensions

export default mongoose.model('APIStatus', APIStatusSchema);
