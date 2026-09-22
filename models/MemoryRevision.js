import mongoose from 'mongoose';

const memoryRevisionSchema = new mongoose.Schema({
    memoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Memory', required: true, index: true },
    version: { type: Number, required: true },
    action: { type: String, enum: ['created', 'updated', 'deleted', 'restored'], required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    changedBy: { type: String, required: true }
}, { timestamps: true });

memoryRevisionSchema.index({ memoryId: 1, version: -1 }, { unique: true });

export default mongoose.models.MemoryRevision || mongoose.model('MemoryRevision', memoryRevisionSchema);
