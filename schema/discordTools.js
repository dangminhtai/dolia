import { Type } from '@google/genai';

export const discordTools = [
    {
        name: 'discord_query',
        description: `Đọc dữ liệu Discord hiện tại trực tiếp từ guild/runtime, không chạy script và không dùng agent_code. Dùng cho số thành viên/người/bot, ai online, ai ở voice, thông tin server/kênh hoặc profile thành viên. target phải là entity reference có trong Discord Context như author, bot, u1, recent1... Không tự đoán ID hoặc fuzzy-match tên.`,
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
                    description: 'Entity reference trong Discord Context, ví dụ author, bot, u1, recent1. Chỉ cần cho member_profile.'
                }
            },
            required: ['action']
        }
    },
    {
        name: 'discord_action',
        description: `Thực hiện hành động Discord trực tiếp bằng discord.js, không sinh script/agent. Chỉ dùng khi người dùng yêu cầu thật sự thực hiện thao tác: xóa tin nhắn, đổi nickname, ngắt voice, kick, ban hoặc reaction. Với người cụ thể, dùng entity reference trong Discord Context (u1, recent1, replied_author...). Không truyền Snowflake ID hay tên tự đoán. Các action thay đổi server là owner-only ở executor.`,
        parameters: {
            type: Type.OBJECT,
            properties: {
                action: {
                    type: Type.STRING,
                    enum: [
                        'delete_replied_message',
                        'delete_recent_from',
                        'set_nickname',
                        'disconnect_voice',
                        'kick',
                        'ban',
                        'react_replied_message'
                    ],
                    description: 'Hành động Discord cần thực hiện.'
                },
                target: {
                    type: Type.STRING,
                    description: 'Entity reference trong Discord Context. Ví dụ author, bot, u1, recent1, replied_author.'
                },
                count: {
                    type: Type.INTEGER,
                    description: 'Số tin nhắn gần nhất cần xóa, từ 1 đến 20. Chỉ dùng với delete_recent_from.'
                },
                nickname: {
                    type: Type.STRING,
                    description: 'Biệt danh mới. Chỉ dùng với set_nickname.'
                },
                reason: {
                    type: Type.STRING,
                    description: 'Lý do ngắn gọn cho audit log nếu phù hợp.'
                },
                emoji: {
                    type: Type.STRING,
                    description: 'Emoji cần thả. Chỉ dùng với react_replied_message.'
                }
            },
            required: ['action']
        }
    }
];
