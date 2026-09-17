import { t as tr } from './services/i18nService.js';
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
import { initI18n, t } from './services/i18nService.js';
import geminiModelService from './services/geminiModelService.js';

// Khởi tạo hệ thống tài nguyên (Resource / i18n)
initI18n();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.AutoModerationConfiguration,
        GatewayIntentBits.AutoModerationExecution
    ],
    partials: [
        Partials.User,
        Partials.Channel,
        Partials.GuildMember,
        Partials.Message,
        Partials.Reaction,
        Partials.GuildScheduledEvent,
        Partials.ThreadMember
    ]
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
    res.send(t('common.server_running'));
});

app.listen(PORT, () => {
    console.log(tr('logs.index.log_express_server_listening_on_port', { PORT: PORT }));
});

async function main() {
    try {
        await sodium.ready;
        // 1. Connect DB (Non-blocking or Soft-fail)
        try {
            await connectDB();
            geminiModelService.init().catch(err => console.error(tr('logs.index.error_gemini_model_sync_failed'), err.message));
        } catch (dbErr) {
            console.error(tr('logs.index.error_database_connection_failed'), dbErr.message);
            console.log(tr('logs.index.log_bot_will_continue_startup_without_database'));
        }



        // 2. Load & Deploy Commands
        try {
            const commandsPath = path.join(__dirname, 'commands')
            const loadResult = await loadCommands(commandsPath, client);
            await deployCommands(loadResult);
        } catch (cmdErr) {
            console.error(tr('logs.index.error_command_loading_deployment_failed'), cmdErr.message);
        }

        // 3. Login
        await client.login(process.env.DISCORD_TOKEN);

    } catch (err) {
        Logger.error(tr('logs.index.error_fatal_error_during_startup', { err: err }));
    }
}
// --- GLOBAL ERROR HANDLERS to prevent crash ---
process.on('unhandledRejection', (reason, promise) => {
    Logger.error(tr('logs.index.error_unhandled_rejection_at'), promise, tr('logs.index.error_reason'), reason);
    // Không exit process, chỉ log lỗi để bot vẫn chạy
});

process.on('uncaughtException', (err) => {
    Logger.error(tr('logs.index.error_uncaught_exception'), err);
    // Không exit process
});

main();
