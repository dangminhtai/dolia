import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatString } from '../helpers/placeHolder.js';
import MorningGreeting from '../models/MorningGreeting.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, '../config/Greeting/GoodMorning.json');

/**
 * Khởi tạo trình lập lịch chào buổi sáng
 * @param {import('discord.js').Client} client 
 */
export function initMorningGreeting(client) {
    console.log('[MorningGreeting] Scheduler started (checking every minute)');

    setInterval(() => {
        const now = new Date();
        const vnTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));

        const hours = vnTime.getHours();
        const minutes = vnTime.getMinutes();

        if (hours === 6 && minutes === 0) {
            triggerGreetings(client);
        }
    }, 60000);
}

/**
 * Gửi tin nhắn chào buổi sáng cho một user cụ thể
 * @param {import('discord.js').Client} client 
 * @param {string} userId 
 */
export async function sendGreetingToUser(client, userId) {
    // 1. Lấy danh sách lời chào từ JSON
    let greetings = [
        "Chào buổi sáng {{nickname}}! Chúc bạn ngày mới tốt lành."
    ];

    if (fs.existsSync(CONFIG_PATH)) {
        try {
            const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed) && parsed.length > 0) {
                greetings = parsed;
            }
        } catch (e) {
            console.error('[MorningGreeting] JSON Parse Error:', e);
        }
    }

    // 2. Tải thông tin user
    const user = await client.users.fetch(userId);
    if (!user) throw new Error('User not found');

    // 3. Chọn lời chào ngẫu nhiên
    const template = greetings[Math.floor(Math.random() * greetings.length)];

    // 4. Định dạng và gửi
    const content = formatString(template, {
        user: user,
        client: client
    });

    await user.send(content);
    console.log(`[MorningGreeting] Manual/Test Sent to ${user.username}`);
    return { success: true, username: user.username, content: content };
}

async function triggerGreetings(client) {
    console.log('[MorningGreeting] Triggering greetings at 6:00 AM VN...');

    try {
        const users = await MorningGreeting.find({});
        if (users.length === 0) return;

        for (const dbUser of users) {
            try {
                await sendGreetingToUser(client, dbUser.userId);
            } catch (err) {
                console.error(`[MorningGreeting] Failed to send to ${dbUser.userId}:`, err.message);
            }
        }
    } catch (error) {
        console.error('[MorningGreeting] Database Error:', error);
    }
}
