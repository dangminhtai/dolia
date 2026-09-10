import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const APIKeySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  provider: { type: String, default: 'Gemini' },
  isActive: { type: Boolean, default: true },
  usageCount: { type: Number, default: 0 },
  errorCount: { type: Number, default: 0 },
  lastUsed: { type: Date, default: Date.now }
});

async function seed() {
  console.log('[*] Connecting to Dolia MongoDB...');
  const conn = await mongoose.createConnection(process.env.MONGO_URI).asPromise();
  const APIKey = conn.model('APIKey', APIKeySchema);

  const envKeys = Object.entries(process.env)
    .filter(([name, val]) => (name.startsWith('GEMINI_') && name.endsWith('_KEY')) || name === 'GEMINI_API_KEY')
    .map(([name, val]) => ({
      key: val.trim(),
      name: name,
      provider: 'Gemini',
      isActive: true
    }));

  console.log(`[*] Found ${envKeys.length} Gemini keys in .env`);

  let added = 0;
  for (const k of envKeys) {
    const res = await APIKey.updateOne(
      { key: k.key },
      { $setOnInsert: k },
      { upsert: true }
    );
    if (res.upsertedCount > 0) added++;
  }

  const total = await APIKey.countDocuments({ isActive: true });
  console.log(`✅ Seeded ${added} new keys. Total active keys in DB: ${total}`);
  await conn.close();
}

seed().catch(console.error);
