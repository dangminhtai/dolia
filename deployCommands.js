import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
import discord from 'discord.js';
const { REST, Routes } = discord;
import { pathToFileURL } from 'url';
import { commandChanges } from './utils/compareCommands.js';
import Command from './models/Command.js';

/**
 * Quét đệ quy một thư mục lệnh và nạp vào danh sách
 */
async function scanCommandDirectory(dir, client, isSandbox = false) {
    const commandsToDeploy = [];
    let hasChanges = false;

    if (!fs.existsSync(dir)) return { commands: commandsToDeploy, hasChanges };

    const files = fs.readdirSync(dir, { withFileTypes: true });

    for (const file of files) {
        const fullPath = path.join(dir, file.name);

        if (file.isDirectory()) {
            const subResult = await scanCommandDirectory(fullPath, client, isSandbox);
            commandsToDeploy.push(...subResult.commands);
            if (subResult.hasChanges) hasChanges = true;
        } else if (file.isFile() && file.name.endsWith('.js')) {
            const modulePath = pathToFileURL(fullPath).href + `?t=${Date.now()}`;
            try {
                const commandModule = await import(modulePath);
                const cmd = commandModule.default ?? commandModule;

                if ('data' in cmd && 'execute' in cmd) {
                    cmd.isSandbox = isSandbox;
                    client?.commands?.set(cmd.data.name, cmd);

                    const cmdData = cmd.data.toJSON();
                    commandsToDeploy.push(cmdData);

                    // So sánh xem lệnh này có thay đổi so với DB không
                    const changed = await commandChanges(cmd);
                    if (changed) hasChanges = true;
                }
            } catch (err) {
                console.error(`❌ Lỗi nạp lệnh từ ${file.name}:`, err.message);
            }
        }
    }

    return { commands: commandsToDeploy, hasChanges };
}

/**
 * Nạp toàn bộ lệnh từ cả hai nguồn:
 * 1. Mã nguồn gốc của bot: commands/
 * 2. Mã nguồn mở rộng do Dolia tạo trong sandbox: sandbox/slash/
 */
async function loadCommands(dir = null, client = null) {
    const commandsToDeploy = [];
    let hasChanges = false;

    // 1. Thư mục mã nguồn gốc
    const primaryDir = dir || path.join(process.cwd(), 'commands');
    const primaryResult = await scanCommandDirectory(primaryDir, client, false);
    commandsToDeploy.push(...primaryResult.commands);
    if (primaryResult.hasChanges) hasChanges = true;

    // 2. Thư mục mở rộng Sandbox (chứa các tính năng do Dolia tự sinh)
    const sandboxDir = path.join(process.cwd(), 'sandbox', 'slash');
    if (fs.existsSync(sandboxDir)) {
        const sandboxResult = await scanCommandDirectory(sandboxDir, client, true);
        commandsToDeploy.push(...sandboxResult.commands);
        if (sandboxResult.hasChanges) hasChanges = true;
    }

    return { commands: commandsToDeploy, hasChanges };
}

async function deployCommands(loadResult, forceDeploy = false) {
    let { commands, hasChanges } = loadResult;

    if (commands.length === 0) return;

    // 1. Kiểm tra xem có lệnh nào trong DB bị xóa khỏi mã nguồn không
    try {
        const currentNames = new Set(commands.map(c => c.name));

        // Quét các file .js trên ổ đĩa để bảo vệ lệnh đang bị lỗi nạp tạm thời, không xóa nhầm khỏi DB
        const diskFileNames = new Set();
        const dirsToScan = [
            path.join(process.cwd(), 'commands'),
            path.join(process.cwd(), 'sandbox', 'slash')
        ];
        for (const dir of dirsToScan) {
            if (fs.existsSync(dir)) {
                const scan = (d) => {
                    for (const item of fs.readdirSync(d, { withFileTypes: true })) {
                        const itemPath = path.join(d, item.name);
                        if (item.isDirectory()) scan(itemPath);
                        else if (item.isFile() && item.name.endsWith('.js')) {
                            diskFileNames.add(item.name.replace(/\.js$/, ''));
                        }
                    }
                };
                scan(dir);
            }
        }

        // Chỉ xóa lệnh trong DB nếu lệnh đó KHÔNG nạp được VÀ file mã nguồn cũng KHÔNG còn trên đĩa
        const preservedNames = Array.from(new Set([...currentNames, ...diskFileNames]));
        const deleted = await Command.deleteMany({ name: { $nin: preservedNames } });
        if (deleted && deleted.deletedCount > 0) {
            console.log(`🗑️ Removed ${deleted.deletedCount} deleted command(s) from database.`);
            hasChanges = true;
        }
    } catch (error) {
        console.error('Error cleaning deleted commands from database:', error);
    }

    // 2. Kiểm tra lệch số lượng giữa DB và mã nguồn
    try {
        const dbCount = await Command.countDocuments();
        if (dbCount !== commands.length) {
            hasChanges = true;
        }
    } catch (_) { }

    if (!hasChanges && !forceDeploy) {
        console.log('✅ No command changes detected. Skipping deployment.');
        return;
    }

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log(`🚀 Deploying ${commands.length} commands to Discord REST API...`);
        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log(`✅ Successfully deployed ${data.length} command(s) to Discord.`);

        // CHỈ LƯU VÀO DATABASE SAU KHI DISCORD API ĐÃ NHẬN LỆNH THÀNH CÔNG!
        for (const cmd of commands) {
            await Command.findOneAndUpdate(
                { name: cmd.name },
                {
                    name: cmd.name,
                    description: cmd.description,
                    dataJSON: cmd
                },
                { upsert: true, new: true }
            );
        }
    } catch (error) {
        console.error('❌ Error during deployment:', error);
        throw error;
    }
}

export { loadCommands, deployCommands };
