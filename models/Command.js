// models/Command.js
import mongoose from 'mongoose';

const commandSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    dataJSON: { type: Object, required: true },
    updatedAt: { type: Date, default: Date.now },
});

commandSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

export default mongoose.model('Command', commandSchema);
