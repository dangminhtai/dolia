import { Type } from "@google/genai";

export const devTools = [
    {
        name: "agent_code",
        description: "Yêu cầu Agent tự động lập trình tạo mới, chỉnh sửa, TẠO LẠI hoặc XOÁ/GỠ BỎ một tính năng, trò chơi, hoặc lệnh cho bot Dolia khi được chủ nhân (Owner) yêu cầu trong chat. BẮT BUỘC gọi tool này khi người dùng muốn: tạo lệnh mới, viết trò chơi mới, sửa tính năng, XOÁ BỎ lệnh, HOẶC KHI NGƯỜI DÙNG BÁO LỆNH CHƯA ĐƯỢC TẠO / CHƯA CÓ KÌA / YÊU CẦU TẠO LẠI / HỎI SAO CHƯA CÓ LỆNH. TUYỆT ĐỐI KHÔNG ĐƯỢC chỉ trả lời hứa hẹn bằng văn bản mà không gọi tool này.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                prompt: {
                    type: Type.STRING,
                    description: "Mô tả chi tiết yêu cầu của người dùng (ví dụ: 'Tạo lệnh tung xúc xắc', 'Xóa trò chơi xúc xắc ban nãy tạo')."
                },
                feature_name: {
                    type: Type.STRING,
                    description: "Tên định danh ngắn gọn của lệnh/tính năng (viết thường không dấu, ví dụ: dice, roll, coinflip, userinfo, tictactoe)."
                },
                action: {
                    type: Type.STRING,
                    description: "Loại tác vụ cần thực hiện.",
                    enum: ["create_feature", "create_game", "create_script", "modify_feature", "delete_feature"]
                }
            },
            required: ["prompt", "action"]
        }
    }
];
