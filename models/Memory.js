import mongoose from 'mongoose';

const provenanceSchema = new mongoose.Schema({
    source: {
        type: String,
        enum: ['explicit_user', 'reviewed_summary', 'approved_suggestion', 'manual_ui'],
        required: true
    },
    messageIds: { type: [String], default: [] },
    sourceChannelId: { type: String, default: null },
    recordedBy: { type: String, required: true }
}, { _id: false });

const memorySchema = new mongoose.Schema({
    guildId: { type: String, default: null, index: true },
    channelId: { type: String, default: null, index: true },
    ownerId: { type: String, default: null, index: true },
    scope: {
        type: String,
        enum: ['user_private', 'channel_shared', 'guild_shared'],
        required: true,
        index: true
    },
    kind: {
        type: String,
        enum: ['fact', 'preference', 'project', 'event', 'relationship', 'rule'],
        required: true,
        index: true
    },
    key: { type: String, required: true, trim: true, maxlength: 120 },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    tags: { type: [String], default: [] },
    status: {
        type: String,
        enum: ['active', 'archived', 'deleted'],
        default: 'active',
        index: true
    },
    confidence: { type: Number, min: 0, max: 1, default: 1 },
    provenance: { type: provenanceSchema, required: true },
    expiresAt: { type: Date, default: null, index: true },
    version: { type: Number, min: 1, default: 1 }
}, { timestamps: true });

memorySchema.index(
    { scope: 1, ownerId: 1, guildId: 1, channelId: 1, key: 1 },
    { unique: true, partialFilterExpression: { status: 'active' } }
);
memorySchema.index({ guildId: 1, channelId: 1, scope: 1, status: 1 });
memorySchema.index({ text: 'text', tags: 'text', key: 'text' });

export default mongoose.models.Memory || mongoose.model('Memory', memorySchema);
