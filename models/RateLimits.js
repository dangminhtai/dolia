import mongoose from "mongoose";

const MODELS = [
    'gemini-3-flash-preview',
];

const rateLimitSchema = new mongoose.Schema({
    model: {
        type: String,
        required: true,
        enum: MODELS
        // Removed unique: true here to allow multiple keys per model
    },
    apiKey: { type: String, required: true }, // Store last 4 digits
    rpm: { type: Number, default: 0 }, // Requests Per Minute
    tpm: { type: Number, default: 0 }, // Tokens Per Minute
    rpd: { type: Number, default: 0 }  // Requests Per Day
}, {
    timestamps: true
});

// Compound unique index to ensure one record per model+key
rateLimitSchema.index({ model: 1, apiKey: 1 }, { unique: true });

export default mongoose.model("RateLimit", rateLimitSchema);
