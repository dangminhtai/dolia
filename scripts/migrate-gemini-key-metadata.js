import 'dotenv/config';
import { connectDB } from '../db.js';
import APIKey from '../models/APIKeys.js';
import mongoose from 'mongoose';

function metadataRows() {
    const rows = [];
    for (const [envName, value] of Object.entries(process.env)) {
        if (!((envName.startsWith('GEMINI_') && envName.endsWith('_KEY')) || envName === 'GEMINI_API_KEY')) continue;
        const key = typeof value === 'string' ? value.trim() : '';
        if (!key) continue;
        const alias = envName === 'GEMINI_API_KEY' ? 'GEMINI' : envName.replace(/_KEY$/, '');
        rows.push({
            key,
            name: alias,
            projectId: process.env[`${alias}_PROJECT`]?.trim() || null,
            projectNumber: process.env[`${alias}_PROJECT_NUMBER`]?.trim() || null,
            keyType: process.env[`${alias}_TYPE`]?.trim() || 'api_key',
            priority: Number(process.env[`${alias}_PRIORITY`]) || 0
        });
    }
    return rows;
}

async function main() {
    await connectDB();
    const rows = metadataRows();
    let updated = 0;
    for (const row of rows) {
        const { key, ...metadata } = row;
        const result = await APIKey.updateOne(
            { key },
            {
                $set: metadata,
                $setOnInsert: { key, provider: 'Gemini', isActive: true }
            },
            { upsert: true }
        );
        if (result.acknowledged) updated += 1;
        console.log(`Gemini key metadata updated: alias=${row.name}, project=${row.projectId || 'unverified'}`);
    }
    console.log(`Gemini metadata migration complete: ${updated}/${rows.length} aliases updated.`);
}

main().catch(error => {
    console.error(`Gemini metadata migration failed: ${error.message}`);
    process.exitCode = 1;
}).finally(async () => {
    await mongoose.disconnect();
});
