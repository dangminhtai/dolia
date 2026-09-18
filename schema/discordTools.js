import { Type } from '@google/genai';

export const discordTools = [
    {
        name: 'discord_query',
        description: `Đọc dữ liệu Discord hiện tại trực tiếp từ guild/runtime, không chạy script và không dùng agent_code. Dùng tool này cho các câu hỏi như: server có bao nhiêu thành viên/người/bot, ai đang online, ai đang ở voice, thông tin server/kênh hiện tại, hoặc thông tin một thành viên được nhắc tới. Với thành viên cụ thể, target phải là entity reference có trong Discord Context của lượt hiện tại (author, bot, u1, u2...). Không tự đoán ID, username hoặc display name.`,
        parameters: {
            type: Type.OBJECT,
            properties: {
                action: {
                    type: Type.STRING,
                    enum: [
                        'server_overview',
                        'list_members',
                        'online_members',
                        'voice_members',
                        'member_profile',
                        'channel_overview'
                    ],
                    description: 'Loại dữ liệu Discord cần đọc.'
                },
                target: {
                    type: Type.STRING,
                    description: 'Entity reference của thành viên trong Discord Context, ví dụ author, bot, u1, u2. Chỉ cần cho member_profile.'
                }
            },
            required: ['action']
        }
    }
];
