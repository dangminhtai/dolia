import dotenv from 'dotenv';
dotenv.config({ path: 'F:/X-FILE/Code_UNI/Node JS/bot discord/Genshin Char/char_spec_group/Dolia/.env' });
import mongoose from 'mongoose';
import AntigravityService from '../services/antigravityService.js';
import Chat from '../models/Chat.js';

async function testChainedAgent() {
    console.log('--- TEST CHAINED REUSE OF WARM ENVIRONMENT CONTAINER ---');
    await mongoose.connect(process.env.MONGO_URI);

    const testChannelId = '1464825282841153703';
    const testUserId = '1149477475001323540';

    try {
        const result = await AntigravityService.developScript({
            prompt: 'Chỉnh sửa script trên để chỉ lấy các kênh text có chữ bot',
            context: {
                guild: { id: 'test_guild' },
                channel: { id: testChannelId, name: 'dolia' },
                user: { id: testUserId }
            },
            lastScript: {
                name: 'test_script.js',
                code: 'export default async function run({ guild }) { return guild.channels.cache; }'
            },
            onProgress: (p) => {
                console.log(`[Progress] stage: ${p.stage || 'step'}, text: ${p.text || ''}`);
            }
        });

        console.log('\n--- KẾT QUẢ TRẢ VỀ (CHAINED) ---');
        console.log('Success:', result.success);
        console.log('Environment ID:', result.environmentId);
        console.log('Script Code (preview):', result.scriptCode?.substring(0, 150));

        const doc = await Chat.findOne({ channelId: testChannelId, userId: 'channel_shared' }).lean();
        console.log('\n--- KIỂM TRA MONGODB SAU KHI CHAIN ---');
        console.log('MongoDB agentSession.environmentId:', doc.agentSession?.environmentId);
        console.log('MongoDB agentSession.lastInteractionId:', doc.agentSession?.lastInteractionId);

    } catch (err) {
        console.error('Test Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

testChainedAgent();
