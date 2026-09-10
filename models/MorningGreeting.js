import mongoose from 'mongoose';

const MorningGreetingSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    userName: { type: String },
    addedBy: { type: String }, // ID của Admin đã thêm
}, { timestamps: true });

export default mongoose.model('MorningGreeting', MorningGreetingSchema);
