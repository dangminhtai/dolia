import mongoose from "mongoose";

const partSchema = new mongoose.Schema({
    text: { type: String },
    functionCall: { type: Object }, // { name: String, args: Object }
    functionResponse: { type: Object }, // { name: String, response: Object }
    thoughtSignature: { type: String }, // Cryptographic reasoning signature from Gemini 2.5/3.x
    thought: { type: Boolean } // Flag marking thinking reasoning parts
}, { _id: false });

const chatTurnSchema = new mongoose.Schema({
    role: { type: String, required: true, enum: ['user', 'model'] },
    parts: [partSchema],
    createdAt: { type: Date, default: Date.now }
}, { _id: false });

const chatSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    channelId: { type: String, required: true },
    turns: [chatTurnSchema],
});

chatSchema.index({ userId: 1, channelId: 1 });

export default mongoose.model("Chat", chatSchema);