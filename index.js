import dotenv from 'dotenv'
dotenv.config()
import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js'
import path from "path";
import { fileURLToPath } from "url";
import { loadCommands, deployCommands } from './deployCommands.js'
import { connectDB } from './db.js';
import Logger from './class/Logger.js';
import GuildMusicQueue from './models/GuildMusicQueue.js';
import sodium from 'libsodium-wrappers';

// Event imports
import onReady from './events/client/onReady.js';
import interactionCreate from './events/client/interactionCreate.js';
import messageCreate from './events/client/messageCreate.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel]
});
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
client.commands = new Collection()
onReady(client);
interactionCreate(client);
messageCreate(client);
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot is running');
});

app.listen(PORT, () => {
    console.log(`Express server listening on port ${PORT}`);
});

async function main() {
    try {
        await sodium.ready;
        // 1. Connect DB (Non-blocking or Soft-fail)
        try {
            await connectDB();
        } catch (dbErr) {
            console.error('⚠️ Database connection failed:', dbErr.message);
            console.log('Bot will continue startup without Database...');
        }



        // 2. Load & Deploy Commands
        try {
            const commandsPath = path.join(__dirname, 'commands')
            const loadResult = await loadCommands(commandsPath, client);
            await deployCommands(loadResult);
        } catch (cmdErr) {
            console.error('⚠️ Command loading/deployment failed:', cmdErr.message);
        }

        // 3. Login
        await client.login(process.env.DISCORD_TOKEN);

    } catch (err) {
        Logger.error(`❌ Fatal Error during startup: ${err}`);
    }
}
// --- GLOBAL ERROR HANDLERS to prevent crash ---
process.on('unhandledRejection', (reason, promise) => {
    Logger.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Không exit process, chỉ log lỗi để bot vẫn chạy
});

process.on('uncaughtException', (err) => {
    Logger.error('❌ Uncaught Exception:', err);
    // Không exit process
});

main();
