import { t as tr } from './services/i18nService.js';
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
        console.error(tr('logs.deployonly.error_can_discord_token_va_client_id_trong'));
        process.exit(1);
    }

    if (mongoUri) {
        try {
            await mongoose.connect(mongoUri);
            const dbName = mongoose.connection.db.databaseName;
            console.log(tr('logs.deployonly.log_ket_noi_db_kiem_tra_lenh'), dbName, tr('logs.deployonly.log_collection_commands'));
        } catch (dbErr) {
            console.warn(tr('logs.deployonly.warn_khong_the_ket_noi_mongodb_de_so'), dbErr.message);
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
            console.log(tr('logs.deployonly.log_guild_da_deploy_lenh', { guildId: guildId, length: loadResult.commands.length }));
        } catch (e) {
            console.error(tr('logs.deployonly.error_loi_deploy_guild'), e.message);
        }
    }

    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
}

main().catch((e) => {
    console.error(tr('logs.deployonly.error_error'), e.message);
    process.exit(1);
});

