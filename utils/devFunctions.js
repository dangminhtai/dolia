import { SelfDevService } from '../services/selfDevService.js';
import Logger from '../class/Logger.js';

/**
 * Xử lý Function Calling 'agent_code' từ Gemini
 */
export async function agent_code(args) {
    const { prompt, feature_name, action, user, channel, guild, message } = args;

    Logger.info(`[DevFunctions] agent_code tool invoked by user ${user?.id} (${user?.username}): action="${action}", prompt="${prompt}", feature_name="${feature_name}"`);

    if (!SelfDevService.isOwner(user?.id)) {
        return "Tính năng này chỉ dành riêng cho bạn chủ nhân của mình thôi nha! 🫧";
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
