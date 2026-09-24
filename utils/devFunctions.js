import { t as tr } from '../services/i18nService.js';
import { EmbedBuilder } from 'discord.js';
import { SelfDevService } from '../services/selfDevService.js';
import Logger from '../class/Logger.js';
import { researchWeb } from '../services/automationResearchService.js';

/**
 * Khởi chạy một Slash Command trực tiếp từ tin nhắn văn bản mà người dùng không cần gõ /
 */
export async function executeCommandFromMessage(cmdName, message, client) {
    if (!client) client = message?.client || message?.channel?.client || message?.guild?.client;
    if (!client?.commands) {
        return { success: false, message: tr('messages.devfunctions.text_danh_sach_lenh_chua_san_sang') };
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
        return { success: false, message: tr('messages.devfunctions.text_khong_tim_thay_tro_choi_hoac_lenh', { cmdName: cmdName }) };
    }

    try {
        Logger.info(tr('logs.devfunctions.info_devfunctions_dang_thuc_thi_lenh_cho_user', { name: command.data.name, id: message.author?.id, username: message.author?.username }));

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
            message: tr('messages.devfunctions.text_tro_choi_da_duoc_khoi_chay_thanh', { name: command.data.name })
        };
    } catch (err) {
        Logger.error(tr('logs.devfunctions.error_devfunctions_loi_khi_chay_lenh', { name: command.data.name }), err);
        return { success: false, error: err.message };
    }
}

/**
 * Xử lý Function Calling 'agent_code' từ Gemini
 */
export async function agent_code(args) {
    const { prompt, feature_name, action, user, channel, guild, message } = args;

    Logger.info(tr('logs.devfunctions.info_devfunctions_agent_code_tool_invoked_by_user', { id: user?.id, username: user?.username, action: action, prompt: prompt, feature_name: feature_name }));

    const client = channel?.client || guild?.client || message?.client;
    const lowerAction = (action || '').toLowerCase();

    // 0. Xử lý kịch bản khởi chạy trực tiếp một lệnh/trò chơi đã có sẵn ra kênh chat (run_feature)
    const isRunFeature = lowerAction === 'run_feature' || 
                         lowerAction === 'execute_feature' || 
                         lowerAction === 'launch_game';

    if (isRunFeature) {
        const targetCmd = feature_name || prompt;
        Logger.info(tr('logs.devfunctions.info_devfunctions_yeu_cau_khoi_chay_tinh_nang', { targetCmd: targetCmd }));
        const runResult = await executeCommandFromMessage(targetCmd, message, client);
        return JSON.stringify(runResult);
    }

    // 1. Xử lý kịch bản kiểm tra/truy vấn ngầm bằng script trong Sandbox (Dynamic Inspection & Modification Script)
    const isScript = lowerAction === 'create_script' || 
                     lowerAction === 'modify_script' ||
                     lowerAction === 'edit_script' ||
                     lowerAction === 'inspect_data';

    if (isScript) {
        Logger.info(tr('logs.devfunctions.info_devfunctions_chay_script_ngam_trong_sandbox_action', { lowerAction: lowerAction, prompt: prompt }));

        // Gửi tin nhắn tiến trình chờ sự kiện thời gian thực (tin nhắn ngắn hạn, tự ẩn sau khi hoàn tất hoặc bấm nút ẩn)
        let statusMsg = null;
        let progressInterval = null;
        let collector = null;
        const startTime = Date.now();

        let currentStage = 'init';
        let currentStageDescription = tr('messages.devfunctions.text_dolia_dang_len_kich_ban_va_chuan');

        const stageColors = {
            init: 0x5DADE2,       // xanh dương nhạt
            thinking: 0x9B59B6,   // tím (suy nghĩ)
            coding: 0xE67E22,     // cam (viết code)
            packages: 0xF39C12,   // vàng cam (chuẩn bị thư viện)
            executing: 0x3498DB,  // xanh dương đậm (thực thi sandbox)
            completed: 0x2ECC71,  // xanh lá (hoàn thành)
            failed: 0xE74C3C,     // đỏ (lỗi)
        };

        const createWaitEmbed = (elapsed, stage, desc) => {
            return new EmbedBuilder()
                .setColor(stageColors[stage] || 0x5DADE2)
                .setTitle(tr('messages.devfunctions.settitle_dolia_dang_thuc_hien_yeu_cau_cua'))
                .setDescription(
                    tr('messages.devfunctions.setdescription_thoi_gian_giay_trang_thai_ban_doi', { elapsed: elapsed, desc: desc })
                )
                .setTimestamp();
        };


        try {
            if (message && typeof message.reply === 'function') {
                statusMsg = await message.reply({
                    embeds: [createWaitEmbed(0, currentStage, currentStageDescription)]
                }).catch(() => null);
            }
            if (!statusMsg && channel && typeof channel.send === 'function') {
                statusMsg = await channel.send({
                    embeds: [createWaitEmbed(0, currentStage, currentStageDescription)]
                }).catch(() => null);
            }
        } catch (e) {
            Logger.warn(tr('logs.devfunctions.warn_devfunctions_khong_the_gui_tin_nhan_tien'), e.message);
        }

        if (statusMsg) {
            progressInterval = setInterval(async () => {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                const updatedEmbed = createWaitEmbed(elapsed, currentStage, currentStageDescription);
                await statusMsg.edit({ embeds: [updatedEmbed] }).catch(() => {});
            }, 2500);
        }

        const onProgress = (progress) => {
            if (progress && typeof progress === 'object') {
                currentStage = progress.stage || currentStage;
                currentStageDescription = progress.text || currentStageDescription;
            } else if (typeof progress === 'string') {
                currentStageDescription = progress;
            }
            if (statusMsg) {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                const updatedEmbed = createWaitEmbed(elapsed, currentStage, currentStageDescription);
                statusMsg.edit({ embeds: [updatedEmbed] }).catch(() => {});
            }
        };

        try {
            const inspectionResult = await SelfDevService.runDynamicScript({
                prompt,
                action: lowerAction,
                context: { client, guild, channel, user, message },
                onProgress
            });

            if (statusMsg) {
                onProgress({ stage: 'completed', text: tr('messages.devfunctions.text_da_hoan_thanh_xuat_sac_dang_dong') });
            }

            return typeof inspectionResult === 'string' ? inspectionResult : JSON.stringify(inspectionResult);
        } catch (err) {
            Logger.error(tr('logs.devfunctions.error_devfunctions_loi_chay_dynamic_script'), err);
            return JSON.stringify({ error: err.message });
        } finally {
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
            // Tin nhắn ngắn hạn: Tự động xóa sau 2 giây khi kết quả hoàn tất hiển thị
            if (statusMsg) {
                setTimeout(() => {
                    statusMsg.delete().catch(() => {});
                }, 2000);
            }
        }
    }

    // Các tác vụ thay đổi mã nguồn (tạo/xóa/sửa tính năng) chỉ dành cho Owner
    if (!SelfDevService.isOwner(user?.id)) {
        return tr('messages.devfunctions.text_tinh_nang_nay_chi_danh_rieng_cho');
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
            Logger.error(tr('logs.devfunctions.error_devfunctions_error_starting_delete_session'), err);
        });

        return tr('messages.devfunctions.text_minh_da_nhan_yeu_cau_go_bo');
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
        Logger.error(tr('logs.devfunctions.error_devfunctions_error_starting_self_dev_session'), err);
    });

    return tr('messages.devfunctions.text_minh_da_nhan_yeu_cau_cua_ban', { prompt: prompt });
}

/**
 * Tra cứu thông tin trên Internet qua Google Search theo thời gian thực (Google Search Grounding)
 */
export async function web_search({ query }) {
    if (!query || typeof query !== 'string') {
        return JSON.stringify({ error: tr('messages.devfunctions.text_vui_long_cung_cap_tu_khoa_tim') });
    }

    try {
        Logger.info(tr('logs.devfunctions.info_devfunctions_dang_tim_kiem_google_cho', { query: query }));

        const resultObj = await researchWeb(query);

        Logger.info(tr('logs.devfunctions.info_devfunctions_da_tim_kiem_thanh_cong_cho', { query: query, length: resultObj.sources.length }));
        return JSON.stringify(resultObj);
    } catch (err) {
        Logger.error(tr('logs.devfunctions.error_devfunctions_loi_khi_tim_kiem_google_cho', { query: query }), err.message);
        return JSON.stringify({
            query: query,
            error: tr('messages.devfunctions.text_khong_the_tim_kiem_tren_google_luc', { message: err.message }),
            fallbackMessage: tr('messages.devfunctions.text_hay_thu_lai_sau_giay_lat_hoac')
        });
    }
}

