import mongoose from 'mongoose';

const automationStateSchema = new mongoose.Schema({
    ruleId: { type: String, required: true, index: true },
    executionId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    namespace: { type: String, default: 'workflow' },
    status: { type: String, enum: ['waiting', 'ready', 'completed', 'cancelled'], default: 'waiting', index: true },
    nextStep: { type: Number, min: 0, default: 0 },
    dueAt: { type: Date, required: true, index: true },
    event: { type: mongoose.Schema.Types.Mixed, required: true },
    values: { type: mongoose.Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 86400000) }
}, { timestamps: true, minimize: false });

automationStateSchema.index({ status: 1, dueAt: 1 });
automationStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.AutomationState || mongoose.model('AutomationState', automationStateSchema);
