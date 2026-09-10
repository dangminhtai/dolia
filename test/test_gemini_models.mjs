import dotenv from 'dotenv';
dotenv.config();
import { connectDB } from '../db.js';
import geminiModelService, { GEMINI_PATTERN } from '../services/geminiModelService.js';
import GeminiModel from '../models/GeminiModel.js';

async function run() {
    console.log('--- 1. TEST PATTERN REGEX ---');
    const testCases = [
        { id: 'gemini-3.5-flash-lite', expected: true },
        { id: 'gemini-3.6-flash', expected: true },
        { id: 'gemini-omni-flash', expected: false },
        { id: 'gemini-3.1-pro', expected: false },
        { id: 'gemini-3.8-flash', expected: true },
        { id: 'gemini-2.5-flash-lite', expected: true }
    ];

    let allRegexPassed = true;
    testCases.forEach(tc => {
        const passed = GEMINI_PATTERN.test(tc.id);
        const ok = passed === tc.expected;
        if (!ok) allRegexPassed = false;
        console.log(`- ${tc.id}: ${passed ? 'PASS' : 'FAIL'} (Expected: ${tc.expected ? 'PASS' : 'FAIL'}) ${ok ? '✅' : '❌'}`);
    });

    if (!allRegexPassed) {
        throw new Error('Regex test failed!');
    }

    console.log('\n--- 2. TEST DATABASE SYNC & QUERY ---');
    await connectDB();

    console.log('Syncing models from Google API to MongoDB...');
    await geminiModelService.syncModelsFromAPI();

    const dbModels = await GeminiModel.find({ isActive: true }).sort({ versionMajor: -1, versionMinor: -1 });
    console.log(`\nFound ${dbModels.length} models in Database:`);
    dbModels.forEach(m => console.log(`  * [${m.type}] ${m.modelId} (v${m.version})`));

    const activeModel = await geminiModelService.getActiveModel('flash-lite');
    console.log(`\nSelected Active Model (Prioritizing flash-lite): 👉 ${activeModel}`);

    if (!activeModel.includes('flash-lite') && dbModels.some(m => m.type === 'flash-lite')) {
        throw new Error('Expected flash-lite model to be prioritized!');
    }

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
}

run().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
