import { SelfDevService } from '../services/selfDevService.js';
import Logger from '../class/Logger.js';

/**
 * Xử lý Function Calling 'agent_code' từ Gemini
 */
export async function agent_code(args) {
    const { prompt, feature_name, user, channel, guild } = args;

    Logger.info(`[DevFunctions] agent_code tool invoked by user ${user?.id} (${user?.username}): "${prompt}"`);

    if (!SelfDevService.isOwner(user?.id)) {
        return "Bạn không phải là chủ nhân của Dolia. Dolia chỉ được phép nhận lệnh tự lập trình và can thiệp mã nguồn từ chủ nhân thôi ạ!";
    }

    const client = channel?.client || guild?.client;

    // Kích hoạt tiến trình Self-Dev (tạo worktree, gọi Antigravity và gửi UI duyệt lên channel)
    SelfDevService.startSession({
        prompt,
        featureName: feature_name,
        user,
        channel,
        client
    }).catch(err => {
        Logger.error('[DevFunctions] Error starting Self-Dev session:', err);
    });

    return `Dolia đã nhận lệnh từ chủ nhân! Đang bắt đầu khởi tạo môi trường thử nghiệm độc lập và kết nối Gemini Coding Agent để lập trình tính năng: "${prompt}". Chủ nhân vui lòng xem bảng tiến trình và nút duyệt bên dưới nha!`;
}
