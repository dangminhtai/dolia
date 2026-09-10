import mongoose from "mongoose";

const christmasTreeSchema = new mongoose.Schema({
    messageId: { type: String, required: true, unique: true },
    channelId: { type: String, required: true },
    treeState: { type: String, required: true },
    scores: { type: Map, of: Number },
    names: { type: Map, of: String },
    isFinished: { type: Boolean, default: false },
    stopRequesterId: { type: String, default: null } // Người yêu cầu kết thúc
});

export default mongoose.model("ChristmasTree", christmasTreeSchema);
