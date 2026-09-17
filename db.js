import { t as tr } from './services/i18nService.js';
//db.js
import mongoose from "mongoose";

mongoose.set('strictQuery', true);

async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 5000, 
            socketTimeoutMS: 45000,
        });
        console.log(tr('logs.db.log_da_ket_noi_voi_database'));
    } catch (err) {
        console.error(tr('logs.db.error_loi_ket_noi_voi_database'), err);
    }
}

export { connectDB };
