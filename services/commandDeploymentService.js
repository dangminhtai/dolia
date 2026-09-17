import { t as tr } from './i18nService.js';
import crypto from 'crypto';
import discord from 'discord.js';
const { REST, Routes } = discord;
import Command from '../models/Command.js';
import Logger from '../class/Logger.js';

/**
 * Chuỗi hóa đối tượng một cách ổn định (sắp xếp thứ tự các khóa theo alphabet)
 * để đảm bảo hash SHA-256 luôn nhất quán bất kể thứ tự thuộc tính.
 */
export function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }

    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }

    return JSON.stringify(value);
}

/**
 * Tạo mã băm SHA-256 cho dữ liệu lệnh
 */
export function hashCommandData(commandData) {
    return crypto
        .createHash('sha256')
        .update(stableStringify(commandData))
        .digest('hex');
}

/**
 * Chuẩn hóa danh sách lệnh kèm mã băm dataHash
 */
export function normalizeCommandList(commands) {
    return [...commands]
        .map(command => ({
            ...command,
            dataHash: hashCommandData(command)
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * So sánh danh sách lệnh hiện tại trên ổ đĩa và trong Database để tìm ra lệnh thay đổi / bị xóa
 */
export function getDeploymentDiff(currentCommands, storedCommands) {
    const storedByName = new Map(storedCommands.map(command => [command.name, command]));
    const currentByName = new Map(currentCommands.map(command => [command.name, command]));
    const changed = [];
    const removed = [];

    for (const command of currentCommands) {
        const stored = storedByName.get(command.name);
        if (!stored || !stored.dataHash || stored.dataHash !== command.dataHash) {
            changed.push(command.name);
        }
    }

    for (const command of storedCommands) {
        if (!currentByName.has(command.name)) {
            removed.push(command.name);
        }
    }

    return {
        changed,
        removed,
        shouldDeploy: changed.length > 0 || removed.length > 0
    };
}

/**
 * Tải snapshot các lệnh đã lưu trong Database
 */
export async function loadStoredCommandSnapshots() {
    return await Command.find({}).lean();
}

/**
 * Lưu snapshot các lệnh vào Database sau khi deploy thành công
 */
export async function saveCommandSnapshots(commands) {
    const currentNames = commands.map(command => command.name);

    // Xóa các lệnh đã bị gỡ bỏ khỏi mã nguồn
    await Command.deleteMany({
        name: { $nin: currentNames }
    });

    // Cập nhật hoặc thêm mới snapshot kèm dataHash
    for (const command of commands) {
        await Command.updateOne(
            { name: command.name },
            {
                $set: {
                    name: command.name,
                    description: command.description,
                    dataJSON: command,
                    dataHash: command.dataHash,
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        );
    }
}

/**
 * Gửi lệnh lên Discord REST API
 */
export async function putDiscordCommands(commands, env = process.env) {
    const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
    const route = env.GUILD_ID
        ? Routes.applicationGuildCommands(env.CLIENT_ID, env.GUILD_ID)
        : Routes.applicationCommands(env.CLIENT_ID);

    return await rest.put(route, {
        body: commands.map(({ dataHash, ...command }) => command)
    });
}

/**
 * Tự động kiểm tra thay đổi theo chuẩn SHA-256 (Furina Standard) và chỉ deploy khi thực sự thay đổi
 */
export async function autoDeployCommandsIfChanged(commands, { forceDeploy = false, env = process.env } = {}) {
    if (env.AUTO_DEPLOY_COMMANDS === 'false') {
        Logger.info(tr('logs.commanddeploymentservice.info_deploy_auto_command_deploy_bi_tat_boi'));
        return { deployed: false, reason: 'disabled' };
    }

    if (!env.DISCORD_TOKEN || !env.CLIENT_ID) {
        Logger.warn(tr('logs.commanddeploymentservice.warn_deploy_bo_qua_deploy_lenh_vi_thieu'));
        return { deployed: false, reason: 'missing_env' };
    }

    if (!commands || commands.length === 0) {
        Logger.warn(tr('logs.commanddeploymentservice.warn_deploy_khong_co_lenh_nao_duoc_tim'));
        return { deployed: false, reason: 'empty' };
    }

    const currentCommands = normalizeCommandList(commands);
    const storedCommands = await loadStoredCommandSnapshots();
    const diff = getDeploymentDiff(currentCommands, storedCommands);

    if (!diff.shouldDeploy && !forceDeploy) {
        Logger.info(tr('logs.commanddeploymentservice.info_deploy_slash_commands_khong_thay_doi_lenh', { length: currentCommands.length }));
        return { deployed: false, reason: 'unchanged', diff };
    }

    if (forceDeploy) {
        Logger.info(tr('logs.commanddeploymentservice.info_deploy_bat_buoc_deploy_lenh_forcedeploy_true'));
    } else {
        Logger.info(
            `[Deploy] 🔍 Phát hiện thay đổi slash commands: ` +
            `thay đổi/mới=[${diff.changed.join(', ') || 'none'}], đã xóa=[${diff.removed.join(', ') || 'none'}]. Đang deploy lên Discord REST API...`
        );
    }

    const deployed = await putDiscordCommands(currentCommands, env);
    await saveCommandSnapshots(currentCommands);

    Logger.info(tr('logs.commanddeploymentservice.info_deploy_da_deploy_thanh_cong_slash_command', { length: deployed.length }));
    return { deployed: true, count: deployed.length, diff };
}

export default {
    stableStringify,
    hashCommandData,
    normalizeCommandList,
    getDeploymentDiff,
    loadStoredCommandSnapshots,
    saveCommandSnapshots,
    putDiscordCommands,
    autoDeployCommandsIfChanged
};
