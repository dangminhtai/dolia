import mongoose from "mongoose";

const rateLimitSchema = new mongoose.Schema({
    model: {
        type: String,
        required: true
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
