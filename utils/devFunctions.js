import { SelfDevService } from '../services/selfDevService.js';
import Logger from '../class/Logger.js';

/**
 * Xử lý Function Calling 'agent_code' từ Gemini
 */
export async function agent_code(args) {
    const { prompt, feature_name, action, user, channel, guild } = args;

    Logger.info(`[DevFunctions] agent_code tool invoked by user ${user?.id} (${user?.username}): action="${action}", prompt="${prompt}", feature_name="${feature_name}"`);

    if (!SelfDevService.isOwner(user?.id)) {
        return "Bạn không phải là chủ nhân của Dolia. Dolia chỉ được phép nhận lệnh tự lập trình và can thiệp mã nguồn từ chủ nhân thôi ạ!";
    }

    const client = channel?.client || guild?.client;

    const lowerPrompt = (prompt || '').toLowerCase();
    const isDelete = action === 'delete_feature' || 
                     lowerPrompt.includes('xóa') || 
                     lowerPrompt.includes('xoa') || 
                     lowerPrompt.includes('gỡ bỏ') || 
                     lowerPrompt.includes('go bo') || 
                     lowerPrompt.includes('delete') || 
                     lowerPrompt.includes('remove');

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

        return `Dolia đã nhận lệnh xóa từ chủ nhân! Đang tìm file lệnh và gửi bảng xác nhận gỡ bỏ bên dưới nha!`;
    }

    // Kích hoạt tiến trình Self-Dev tạo mới tính năng
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
