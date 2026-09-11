import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import Logger from './class/Logger.js';
import { autoDeployCommandsIfChanged } from './services/commandDeploymentService.js';

/**
 * Quét đệ quy một thư mục lệnh và nạp vào danh sách
 */
async function scanCommandDirectory(dir, client, isSandbox = false) {
    const commandsToDeploy = [];

    if (!fs.existsSync(dir)) return commandsToDeploy;

    const files = fs.readdirSync(dir, { withFileTypes: true });

    for (const file of files) {
        const fullPath = path.join(dir, file.name);

        if (file.isDirectory()) {
            const subCommands = await scanCommandDirectory(fullPath, client, isSandbox);
            commandsToDeploy.push(...subCommands);
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
                }
            } catch (err) {
                Logger.error(`❌ Lỗi nạp lệnh từ ${file.name}:`, err.message);
            }
        }
    }

    return commandsToDeploy;
}

/**
 * Nạp toàn bộ lệnh từ cả hai nguồn:
 * 1. Mã nguồn gốc của bot: commands/
 * 2. Mã nguồn mở rộng do Dolia tạo trong sandbox: sandbox/slash/
 */
async function loadCommands(dir = null, client = null) {
    const commandsToDeploy = [];

    // 1. Thư mục mã nguồn gốc
    const primaryDir = dir || path.join(process.cwd(), 'commands');
    const primaryCommands = await scanCommandDirectory(primaryDir, client, false);
    commandsToDeploy.push(...primaryCommands);

    // 2. Thư mục mở rộng Sandbox (chứa các tính năng do Dolia tự sinh)
    const sandboxDir = path.join(process.cwd(), 'sandbox', 'slash');
    if (fs.existsSync(sandboxDir)) {
        const sandboxCommands = await scanCommandDirectory(sandboxDir, client, true);
        commandsToDeploy.push(...sandboxCommands);
    }

    return { commands: commandsToDeploy };
}

/**
 * Deploy commands lên Discord API thông qua commandDeploymentService (SHA-256 hash detection chuẩn Furina)
 *
 * @param {Array|Object} loadResult - Danh sách command JSON hoặc object { commands }
 * @param {boolean} forceDeploy - Bắt buộc deploy bất kể có thay đổi hay không
 */
async function deployCommands(loadResult, forceDeploy = false) {
    const commands = Array.isArray(loadResult) ? loadResult : (loadResult?.commands || []);

    if (commands.length === 0) {
        Logger.warn('[Deploy] Không có lệnh nào được tìm thấy để deploy.');
        return { deployed: false, reason: 'empty' };
    }

    // Lọc trùng tên command (lấy bản ghi cuối cùng)
    const uniqueCommandsMap = new Map();
    for (const cmd of commands) {
        if (uniqueCommandsMap.has(cmd.name)) {
            Logger.warn(`[Deploy] ⚠️ Trùng tên command: /${cmd.name} — chỉ lấy phiên bản cuối cùng.`);
        }
        uniqueCommandsMap.set(cmd.name, cmd);
    }
    const uniqueCommands = Array.from(uniqueCommandsMap.values());

    // Tự động kiểm tra mã băm SHA-256 (dataHash) và chỉ deploy khi có thay đổi thực sự
    return await autoDeployCommandsIfChanged(uniqueCommands, { forceDeploy });
}

export { loadCommands, deployCommands };
