import { Type } from "@google/genai";

export const devTools = [
    {
        name: "agent_code",
        description: "Công cụ thông minh của Dolia để: (1) KHỞI CHẠY LỆNH/TRÒ CHƠI ĐÃ CÓ SẴN (action: 'run_feature'): Khi người dùng muốn chơi một trò chơi hoặc dùng tính năng ĐÃ CÓ SẴN trong danh sách hệ thống/sandbox (ví dụ: 'mình muốn chơi 7 viên ngọc rồng' -> gọi run_feature với feature_name: 'dragon_ball_quiz'; 'chơi nối từ' -> feature_name: 'word_chain'; 'chơi đố vui' -> feature_name: 'trivia'; 'chơi cờ caro' -> feature_name: 'tictactoe'). BẮT BUỘC gọi tool này để mở giao diện nút bấm và Embed ra kênh chat cho người dùng chơi ngay. TUYỆT ĐỐI KHÔNG TỰ TẠO TRÒ CHƠI BẰNG VĂN BẢN (TEXT)!; (2) KIỂM TRA NGẦM DỮ LIỆU DISCORD THỰC TẾ (action: 'inspect_data' hoặc 'create_script'): Kiểm tra server có mấy người, kênh chat có những ai, số lượng bot/thành viên, ngày tạo server, v.v.; (3) TỰ ĐỘNG LẬP TRÌNH TẠO MỚI (action: 'create_game'/'create_feature'): Khi người dùng yêu cầu một game/tính năng HOÀN TOÀN MỚI CHƯA CÓ TRONG DANH SÁCH; (4) XOÁ LỆNH (action: 'delete_feature').",
        parameters: {
            type: Type.OBJECT,
            properties: {
                prompt: {
                    type: Type.STRING,
                    description: "Mô tả chi tiết nội dung cần kiểm tra dữ liệu, khởi chạy tính năng hoặc tạo tính năng mới (ví dụ: 'Chơi 7 viên ngọc rồng', 'Kiểm tra xem trong server có mấy người', 'Tạo lệnh tung xúc xắc')."
                },
                feature_name: {
                    type: Type.STRING,
                    description: "Tên định danh ngắn gọn của lệnh/tính năng (ví dụ: dragon_ball_quiz, word_chain, trivia, tictactoe, inspect_members, dice)."
                },
                action: {
                    type: Type.STRING,
                    description: "Loại tác vụ: 'run_feature' (khởi chạy ngay game/lệnh đã có sẵn trong danh sách ra kênh chat), 'inspect_data' (kiểm tra ngầm dữ liệu Discord, đếm người, xem thành viên, role, kênh), 'create_script' (chạy script kiểm tra, vẽ canvas, render video), 'modify_script' (chỉnh sửa, cập nhật lại script đã tạo trước đó trong kênh), 'create_game' (tạo game mới chưa có), 'create_feature' (tạo lệnh mới chưa có), 'modify_feature' (sửa lệnh), 'delete_feature' (xoá lệnh).",
                    enum: ["run_feature", "inspect_data", "create_script", "modify_script", "create_feature", "create_game", "modify_feature", "delete_feature"]
                }
            },
            required: ["prompt", "action"]
        }
    },
    {
        name: "web_search",
        description: "Tìm kiếm thông tin thực tế trên Internet thông qua Google Search theo thời gian thực (tin tức mới nhất, sự kiện hiện tại, tra cứu nhân vật, cốt truyện, công nghệ, thời tiết, giá cả, kiến thức ngoài thế giới...). BẮT BUỘC gọi công cụ này khi người dùng hỏi về thông tin mới, tin tức, tra cứu trên mạng hoặc thông tin bạn chưa chắc chắn.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: {
                    type: Type.STRING,
                    description: "Từ khóa hoặc câu hỏi tìm kiếm rõ ràng, súc tích trên Google."
                }
            },
            required: ["query"]
        }
    }
];
