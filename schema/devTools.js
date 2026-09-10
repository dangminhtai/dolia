import { Type } from "@google/genai";

export const devTools = [
    {
        name: "agent_code",
        description: "Yêu cầu Agent lập trình tự động tạo hoặc sửa một tính năng/lệnh/script cho bot Dolia khi được chủ nhân (Owner) yêu cầu trong chat. Hãy gọi tool này khi người dùng muốn tạo lệnh mới, viết trò chơi mới, hoặc phát triển tính năng mới cho Dolia.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                prompt: {
                    type: Type.STRING,
                    description: "Mô tả chi tiết và yêu cầu đầy đủ của tính năng, trò chơi, hoặc lệnh mà người dùng muốn Dolia tự lập trình."
                },
                feature_name: {
                    type: Type.STRING,
                    description: "Tên định danh ngắn gọn của tính năng (dùng làm tên lệnh slash hoặc file, viết thường không dấu, ví dụ: dice, coinflip, userinfo, tictactoe)."
                },
                action: {
                    type: Type.STRING,
                    description: "Loại tác vụ lập trình cần thực hiện.",
                    enum: ["create_feature", "create_game", "create_script", "modify_feature"]
                }
            },
            required: ["prompt"]
        }
    }
];
