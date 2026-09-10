import dotenv from 'dotenv';
dotenv.config();
import { sendGreetingToUser } from '../utils/morningGreeting.js';

// Mock client object đầy đủ hơn
const mockClient = {
    user: {
        id: 'bot_id_123',
        username: 'Dolia Bot',
        displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png'
    },
    ws: {
        ping: 42
    },
    users: {
        fetch: async (id) => {
            console.log(`[Mock] Fetching user: ${id}`);
            return {
                id: id,
                username: 'TestUser',
                globalName: 'Test User Global',
                tag: 'TestUser#0000',
                createdAt: new Date(),
                displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png',
                send: async (content) => {
                    console.log(`[Mock] Sending DM to ${id}:`);
                    console.log(`------------------------------`);
                    console.log(content);
                    console.log(`------------------------------`);
                    return true;
                }
            };
        }
    }
};

async function runTest() {
    console.log('🚀 Starting Test for REQ002: Morning Greeting Logic');

    try {
        const testUserId = '123456789012345678'; // Fake ID
        const result = await sendGreetingToUser(mockClient, testUserId);

        if (result.success) {
            console.log('✅ Test Passed: Message formatted and "sent" successfully.');
        }
    } catch (error) {
        console.error('❌ Test Failed:', error);
    }
}

runTest();
