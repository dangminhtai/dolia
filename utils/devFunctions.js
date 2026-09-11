import { SelfDevService } from '../services/selfDevService.js';
import Logger from '../class/Logger.js';

/**
 * Khởi chạy một Slash Command trực tiếp từ tin nhắn văn bản mà người dùng không cần gõ /
 */
export async function executeCommandFromMessage(cmdName, message, client) {
    if (!client) client = message?.client || message?.channel?.client || message?.guild?.client;
    if (!client?.commands) {
        return { success: false, message: 'Danh sách lệnh chưa sẵn sàng.' };
    }

    const cleanInput = (cmdName || '').trim().toLowerCase().replace(/^\//, '');
    let command = client.commands.get(cleanInput);

    if (!command) {
        // Tìm kiếm theo tên hoặc theo từ khóa trong tên / mô tả của lệnh đã đăng ký
        for (const [name, cmd] of client.commands.entries()) {
            const desc = (cmd.data?.description || '').toLowerCase();
            const nameLower = name.toLowerCase();

            // Khớp chính xác hoặc tương đối giữa cleanInput và tên lệnh
            if (nameLower.includes(cleanInput) || cleanInput.includes(nameLower)) {
                command = cmd;
                break;
            }
            // Khớp với mô tả của lệnh
            if (desc && (desc.includes(cleanInput) || cleanInput.includes(desc))) {
                command = cmd;
                break;
            }
        }
    }

    if (!command) {
        return { success: false, message: `Không tìm thấy trò chơi hoặc lệnh "${cmdName}" trong hệ thống.` };
    }

    try {
        Logger.info(`[DevFunctions] 🎮 Đang thực thi lệnh /${command.data.name} cho user ${message.author?.id} (${message.author?.username})...`);

        let sentMsg = null;
        const fakeInteraction = {
            user: message.author,
            member: message.member,
            guild: message.guild,
            channel: message.channel,
            channelId: message.channel.id,
            guildId: message.guild?.id,
            client: client,
            commandName: command.data.name,
            deferred: false,
            replied: false,
            options: {
                getString: (name) => {
                    const optDef = command.data?.options?.find?.(o => o.name === name);
                    if (optDef?.choices?.length > 0) {
                        return optDef.choices[0].value;
                    }
                    return '';
                },
                getInteger: () => 1,
                getNumber: () => 1,
                getBoolean: () => true,
                getUser: () => null,
                getMember: () => null,
                getChannel: () => message.channel,
                getRole: () => null,
            },
            deferReply: async () => {
                fakeInteraction.deferred = true;
            },
            reply: async (payload) => {
                fakeInteraction.replied = true;
                if (typeof payload === 'string') payload = { content: payload };
                sentMsg = await message.reply(payload);
                return sentMsg;
            },
            editReply: async (payload) => {
                if (typeof payload === 'string') payload = { content: payload };
                if (sentMsg) {
                    return await sentMsg.edit(payload);
                } else {
                    sentMsg = await message.reply(payload);
                    return sentMsg;
                }
            },
            followUp: async (payload) => {
                if (typeof payload === 'string') payload = { content: payload };
                return await message.channel.send(payload);
            }
        };

        await command.execute(fakeInteraction);
        return { 
            success: true, 
            commandName: command.data.name, 
            message: `Trò chơi /${command.data.name} đã được khởi chạy thành công ngay tại kênh chat!` 
        };
    } catch (err) {
        Logger.error(`[DevFunctions] Lỗi khi chạy lệnh /${command.data.name}:`, err);
        return { success: false, error: err.message };
    }
}

/**
 * Xử lý Function Calling 'agent_code' từ Gemini
 */
export async function agent_code(args) {
    const { prompt, feature_name, action, user, channel, guild, message } = args;

    Logger.info(`[DevFunctions] agent_code tool invoked by user ${user?.id} (${user?.username}): action="${action}", prompt="${prompt}", feature_name="${feature_name}"`);

    const client = channel?.client || guild?.client || message?.client;
    const lowerAction = (action || '').toLowerCase();

    // 0. Xử lý kịch bản khởi chạy trực tiếp một lệnh/trò chơi đã có sẵn ra kênh chat (run_feature)
    const isRunFeature = lowerAction === 'run_feature' || 
                         lowerAction === 'execute_feature' || 
                         lowerAction === 'launch_game';

    if (isRunFeature) {
        const targetCmd = feature_name || prompt;
        Logger.info(`[DevFunctions] 🎮 Yêu cầu khởi chạy tính năng/game: "${targetCmd}"...`);
        const runResult = await executeCommandFromMessage(targetCmd, message, client);
        return JSON.stringify(runResult);
    }

    // 1. Xử lý kịch bản kiểm tra/truy vấn ngầm bằng script trong Sandbox (Dynamic Inspection Script)
    const isScript = lowerAction === 'create_script' || 
                     lowerAction === 'inspect_data';

    if (isScript) {
        Logger.info(`[DevFunctions] 🔍 Chạy script ngầm trong sandbox để kiểm tra dữ liệu: "${prompt}"...`);
        try {
            const inspectionResult = await SelfDevService.runDynamicScript({
                prompt,
                context: { client, guild, channel, user, message }
            });
            return JSON.stringify(inspectionResult);
        } catch (err) {
            Logger.error('[DevFunctions] Lỗi chạy dynamic script:', err);
            return JSON.stringify({ error: err.message });
        }
    }

    // Các tác vụ thay đổi mã nguồn (tạo/xóa/sửa tính năng) chỉ dành cho Owner
    if (!SelfDevService.isOwner(user?.id)) {
        return "Tính năng này chỉ dành riêng cho bạn chủ nhân của mình thôi nha! 🫧";
    }

    // 2. Xử lý kịch bản xóa lệnh khỏi Sandbox
    const isDelete = lowerAction === 'delete_feature';

    if (isDelete) {
        SelfDevService.startDeleteSession({
            prompt,
            featureName: feature_name,
            user,
            channel,
            client
        }).catch(err => {
            Logger.error('[DevFunctions] Error starting Delete session:', err);
        });

        return `Mình đã nhận yêu cầu gỡ bỏ lệnh từ bạn rồi nè! Mình đang tiến hành kiểm tra và gỡ bỏ an toàn ngay nha~ 🫧`;
    }

    // Kích hoạt tiến trình Self-Dev tạo mới tính năng (Tự động Apply an toàn)
    SelfDevService.startSession({
        prompt,
        featureName: feature_name,
        user,
        channel,
        client,
        originalMessage: message
    }).catch(err => {
        Logger.error('[DevFunctions] Error starting Self-Dev session:', err);
    });

    return `Mình đã nhận yêu cầu của bạn rồi nè! Mình đang tự tay chuẩn bị và hoàn thiện tính năng "${prompt}", bạn đợi mình một chút xíu nha~ ✨🫧`;
}
