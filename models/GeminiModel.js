import mongoose from 'mongoose';

const GeminiModelSchema = new mongoose.Schema({
    modelId: { 
        type: String, 
        required: true, 
        unique: true, 
        trim: true 
    },
    version: { 
        type: String, 
        required: true 
    },
    versionMajor: { 
        type: Number, 
        required: true,
        default: 0 
    },
    versionMinor: { 
        type: Number, 
        required: true,
        default: 0 
    },
    versionPatch: { 
        type: Number, 
        default: 0 
    },
    type: { 
        type: String, 
        required: true, 
        enum: ['flash-lite', 'flash'] 
    },
    displayName: { 
        type: String 
    },
    isActive: { 
        type: Boolean, 
        default: true 
    },
    blockedUntil: {
        type: Date,
        default: null
    },
    blockReason: {
        type: String,
        default: null
    },
    lastSyncedAt: { 
        type: Date, 
        default: Date.now 
    }
}, { 
    timestamps: true 
});

// Index for high performance sorting by priority & version
GeminiModelSchema.index({ isActive: 1, type: 1, versionMajor: -1, versionMinor: -1, versionPatch: -1 });

export default mongoose.model('GeminiModel', GeminiModelSchema);
