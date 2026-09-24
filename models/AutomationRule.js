import mongoose from 'mongoose';

const automationRuleSchema = new mongoose.Schema({
    ruleId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, default: null, index: true },
    channelId: { type: String, default: null },
    createdBy: { type: String, required: true, index: true },
    approvedBy: { type: String, default: null },
    scope: { type: String, enum: ['personal', 'channel', 'guild'], required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, default: '', maxlength: 500 },
    type: { type: String, enum: ['configured', 'workflow', 'generated'], default: 'configured' },
    trigger: { type: mongoose.Schema.Types.Mixed, required: true },
    conditions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    steps: { type: [mongoose.Schema.Types.Mixed], default: [] },
    capabilityGrants: { type: [String], default: [] },
    timezone: { type: String, default: 'Asia/Ho_Chi_Minh' },
    schedule: {
        nextRunAt: { type: Date, default: null, index: true },
        missedRunPolicy: {
            type: String,
            enum: ['skip', 'run_if_within_grace', 'run_once_on_recovery'],
            default: 'skip'
        },
        graceMinutes: { type: Number, min: 0, max: 1440, default: 60 },
        leaseOwner: { type: String, default: null },
        leaseExpiresAt: { type: Date, default: null }
    },
    enabled: { type: Boolean, default: false, index: true },
    status: {
        type: String,
        enum: ['draft', 'pending_approval', 'active', 'paused', 'error', 'deleted'],
        default: 'draft',
        index: true
    },
    risk: { type: String, enum: ['low', 'medium', 'high', 'generated'], default: 'low' },
    limits: {
        maxRuns: { type: Number, default: null, min: 1 },
        runCount: { type: Number, default: 0, min: 0 },
        cooldownSeconds: { type: Number, default: 0, min: 0, max: 86400 }
    },
    retryPolicy: {
        maxAttempts: { type: Number, min: 1, max: 3, default: 1 },
        backoffMs: { type: Number, min: 0, max: 30000, default: 1000 }
    },
    revision: { type: Number, min: 1, default: 1 },
    revisionHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
    moduleHash: { type: String, default: null },
    moduleVersion: { type: Number, default: null },
    lastRunAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    lastFailureAt: { type: Date, default: null },
    lastErrorCode: { type: String, default: null }
}, { timestamps: true, minimize: false });

automationRuleSchema.index({ enabled: 1, status: 1, 'schedule.nextRunAt': 1 });
automationRuleSchema.index({ guildId: 1, createdBy: 1, status: 1 });

export default mongoose.models.AutomationRule || mongoose.model('AutomationRule', automationRuleSchema);
