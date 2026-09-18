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
    },
    {
        name: "get_avatar",
        description: "Lấy URL ảnh đại diện (avatar) thật của người gọi hoặc thành viên được chỉ định. Không yêu cầu quyền chủ nhân.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                target: {
                    type: Type.STRING,
                    description: "Entity handle từ [DISCORD_ENTITIES] ('author', 'bot', 'u1', 'u2'...). Mặc định bỏ trống là 'author'."
                }
            }
        }
    },
    {
        name: "moderate_discord",
        description: "Chỉ chủ nhân bot: xóa tin nhắn trong kênh hiện tại, kick, ban, timeout (tạm khóa) hoặc untimeout (gỡ tạm khóa) thành viên. BẮT BUỘC chỉ gọi khi chủ nhân yêu cầu rõ ràng. Kick/ban/timeout cần target là thành viên được mention (u1, u2...).",
        parameters: {
            type: Type.OBJECT,
            properties: {
                action: {
                    type: Type.STRING,
                    description: "Hành động quản trị: delete_messages (xóa tin), kick (đuổi khỏi server), ban (cấm khỏi server), timeout (tạm khóa chat/voice), untimeout (gỡ tạm khóa).",
                    enum: ["delete_messages", "kick", "ban", "timeout", "untimeout"]
                },
                target: {
                    type: Type.STRING,
                    description: "Entity handle của đối tượng từ [DISCORD_ENTITIES]: người bị xử lý ('u1', 'u2'...) hoặc tin nhắn cần xóa ('current_message', 'replied_message')."
                },
                count: {
                    type: Type.INTEGER,
                    description: "Số lượng tin nhắn gần nhất trong kênh cần xóa (từ 1 đến 100). Dùng cho action delete_messages theo số lượng."
                },
                duration_minutes: {
                    type: Type.INTEGER,
                    description: "Thời gian tạm khóa tính theo phút (mặc định 5 phút, tối đa 40320 phút = 28 ngày). Dùng cho action timeout."
                },
                reason: {
                    type: Type.STRING,
                    description: "Lý do thực hiện thao tác quản trị."
                }
            },
            required: ["action"]
        }
    },
    {
        name: "manage_member",
        description: "Chỉ chủ nhân bot: quản lý thành viên trong máy chủ bao gồm đổi/xóa biệt danh, thêm/xóa vai trò (role), di chuyển hoặc ngắt kết nối kênh thoại.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                action: {
                    type: Type.STRING,
                    description: "Hành động: set_nickname (đổi hoặc xóa biệt danh), add_role (thêm role), remove_role (gỡ role), move_voice (chuyển kênh thoại), disconnect_voice (ngắt kết nối thoại).",
                    enum: ["set_nickname", "add_role", "remove_role", "move_voice", "disconnect_voice"]
                },
                target: {
                    type: Type.STRING,
                    description: "Entity handle của thành viên từ [DISCORD_ENTITIES] (ví dụ: 'bot' để đổi tên bot Dolia, 'author' cho người gọi, 'u1', 'u2' cho người được @ nhắc tên). Mặc định là 'bot'."
                },
                nickname: {
                    type: Type.STRING,
                    description: "Biệt danh mới muốn đặt. Bỏ trống hoặc để rỗng nếu muốn xóa biệt danh hiện tại về tên gốc."
                },
                role: {
                    type: Type.STRING,
                    description: "Entity handle của vai trò từ [DISCORD_ENTITIES] (ví dụ: 'r1', 'r2'...). Dùng cho add_role, remove_role."
                },
                target_channel: {
                    type: Type.STRING,
                    description: "Entity handle của kênh thoại đích từ [DISCORD_ENTITIES] (ví dụ: 'c1', 'current_channel'). Dùng cho action move_voice."
                },
                reason: {
                    type: Type.STRING,
                    description: "Lý do thực hiện thao tác."
                }
            },
            required: ["action"]
        }
    },
    {
        name: "manage_message",
        description: "Chỉ chủ nhân bot: quản lý tin nhắn trong kênh bao gồm thả cảm xúc (react), gỡ cảm xúc (unreact), ghim tin nhắn (pin), bỏ ghim (unpin) hoặc tạo luồng thảo luận (thread).",
        parameters: {
            type: Type.OBJECT,
            properties: {
                action: {
                    type: Type.STRING,
                    description: "Hành động: react (thả emoji), unreact (gỡ emoji của bot), pin (ghim tin), unpin (bỏ ghim), create_thread (tạo thread từ tin nhắn).",
                    enum: ["react", "unreact", "pin", "unpin", "create_thread"]
                },
                target: {
                    type: Type.STRING,
                    description: "Entity handle của tin nhắn từ [DISCORD_ENTITIES]: 'current_message' (tin nhắn hiện tại) hoặc 'replied_message' (tin nhắn được reply). Mặc định là 'current_message'."
                },
                emoji: {
                    type: Type.STRING,
                    description: "Emoji cần thả hoặc gỡ (ví dụ: 👍, ❤️, hoặc format custom emoji <a:name:id>)."
                },
                thread_name: {
                    type: Type.STRING,
                    description: "Tên luồng thảo luận muốn tạo (dùng cho action create_thread)."
                }
            },
            required: ["action"]
        }
    },
    {
        name: "manage_channel",
        description: "Chỉ chủ nhân bot: quản lý kênh trong máy chủ bao gồm đổi tên, cập nhật chủ đề (topic), cài chế độ chậm (slowmode), khóa/mở khóa kênh, tạo hoặc xóa kênh.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                action: {
                    type: Type.STRING,
                    description: "Hành động: rename (đổi tên), set_topic (cập nhật chủ đề), slowmode (chế độ chậm), lock (khóa gửi tin), unlock (mở khóa), create_channel (tạo kênh mới), delete_channel (xóa kênh).",
                    enum: ["rename", "set_topic", "slowmode", "lock", "unlock", "create_channel", "delete_channel"]
                },
                target: {
                    type: Type.STRING,
                    description: "Entity handle của kênh từ [DISCORD_ENTITIES]: 'current_channel' (kênh chat hiện tại) hoặc 'c1', 'c2' (kênh được nhắc tới). Mặc định là 'current_channel'."
                },
                name: {
                    type: Type.STRING,
                    description: "Tên mới của kênh (dùng cho rename, create_channel)."
                },
                topic: {
                    type: Type.STRING,
                    description: "Chủ đề mới của kênh văn bản (dùng cho set_topic)."
                },
                slowmode_seconds: {
                    type: Type.INTEGER,
                    description: "Số giây chế độ chậm (0 để tắt, tối đa 21600 = 6 tiếng)."
                },
                channel_type: {
                    type: Type.STRING,
                    description: "Loại kênh cần tạo: \"text\" (kênh chat chữ) hoặc \"voice\" (kênh chat thoại). Mặc định là text.",
                    enum: ["text", "voice"]
                },
                reason: {
                    type: Type.STRING,
                    description: "Lý do thao tác kênh."
                }
            },
            required: ["action"]
        }
    }
];
