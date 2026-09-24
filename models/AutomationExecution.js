import mongoose from 'mongoose';

const automationExecutionSchema = new mongoose.Schema({
    ruleId: { type: String, required: true, index: true },
    ruleRevision: { type: Number, required: true },
    occurrenceKey: { type: String, required: true },
    scheduledFor: { type: Date, default: null },
    eventId: { type: String, default: null },
    status: {
        type: String,
        enum: ['claimed', 'running', 'waiting', 'succeeded', 'failed', 'skipped', 'needs_review'],
        default: 'claimed',
        index: true
    },
    attempts: { type: Number, default: 1 },
    claimedBy: { type: String, required: true },
    leaseExpiresAt: { type: Date, default: null, index: true },
    actionReceipts: { type: [mongoose.Schema.Types.Mixed], default: [] },
    errorCode: { type: String, default: null },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 90 * 86400000) }
}, { timestamps: true, minimize: false });

automationExecutionSchema.index({ ruleId: 1, occurrenceKey: 1 }, { unique: true });
automationExecutionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.AutomationExecution || mongoose.model('AutomationExecution', automationExecutionSchema);
