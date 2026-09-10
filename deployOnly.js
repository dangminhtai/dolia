/**
 * Deploy lệnh slash lên Discord (không chạy bot) cho Dolia:
 * 
 * 1. Nạp DISCORD_TOKEN, CLIENT_ID, MONGO_URI từ file .env nội bộ của Dolia.
 * 2. Kết nối DB để đối soát thay đổi lệnh (compareCommands).
 * 3. Deploy lệnh khi có thay đổi.
 * 
 * Chạy: node deployOnly.js
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import discord from 'discord.js';
const { REST, Routes } = discord;
import { loadCommands, deployCommands } from './deployCommands.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
    const token = process.env.DISCORD_TOKEN;
    const clientId = process.env.CLIENT_ID;
    const mongoUri = process.env.MONGO_URI;

    if (!token || !clientId) {
        console.error('❌ Cần DISCORD_TOKEN và CLIENT_ID trong .env.');
        process.exit(1);
    }

    if (mongoUri) {
        try {
            await mongoose.connect(mongoUri);
            const dbName = mongoose.connection.db.databaseName;
            console.log('📂 Kết nối DB kiểm tra lệnh:', dbName, '| collection: commands');
        } catch (dbErr) {
            console.warn('⚠️ Không thể kết nối MongoDB để so sánh lệnh, tiếp tục deploy trực tiếp:', dbErr.message);
        }
    }

    const commandsPath = path.join(__dirname, 'commands');
    const loadResult = await loadCommands(commandsPath, null);
    await deployCommands(loadResult);

    // (Tùy chọn) Deploy vào guild nếu có GUILD_ID
    const guildId = process.env.GUILD_ID?.trim();
    if (guildId && loadResult.hasChanges && loadResult.commands?.length) {
        try {
            const rest = new REST({ version: '10' }).setToken(token);
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
                body: loadResult.commands,
            });
            console.log(`✅ Guild (${guildId}): đã deploy ${loadResult.commands.length} lệnh.`);
        } catch (e) {
            console.error('❌ Lỗi deploy guild:', e.message);
        }
    }

    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
}

main().catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
});

