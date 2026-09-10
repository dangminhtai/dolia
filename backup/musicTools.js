import { Type } from "@google/genai";

export const musicTools = [
    // 1. Play Music
    {
        type: 'function',
        name: "play_music",
        description: "Phát một bài hát hoặc playlist từ YouTube/Spotify/SoundCloud dựa trên tên hoặc link.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: {
                    type: Type.STRING,
                    description: "Tên bài hát hoặc đường link URL cần phát."
                },
                priority: {
                    type: Type.BOOLEAN,
                    description: "Nếu true, bài hát sẽ được ưu tiên phát ngay lập tức (chèn vào đầu hàng chờ). Mặc định là false."
                }
            },
            required: ["query"]
        }
    },

    // 2. Control Playback
    {
        type: 'function',
        name: "control_playback",
        description: "Điều khiển trình phát nhạc: Bỏ qua bài, Dừng hẳn, Tạm dừng hoặc Tiếp tục.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                action: {
                    type: Type.STRING,
                    description: "Hành động cần thực hiện.",
                    enum: ["skip", "stop", "pause", "resume"]
                }
            },
            required: ["action"]
        }
    },

    // 3. Audio Settings
    {
        type: 'function',
        name: "adjust_audio_settings",
        description: "Điều chỉnh các thông số âm thanh như âm lượng, tốc độ, cao độ và các hiệu ứng.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                volume: {
                    type: Type.NUMBER,
                    description: "Mức âm lượng từ 0 đến 150. (Mặc định: 100)"
                },
                speed: {
                    type: Type.NUMBER,
                    description: "Tốc độ phát nhạc (Speed) từ 0.5 đến 2.0. (Chuẩn: 1.0)"
                },
                pitch: {
                    type: Type.NUMBER,
                    description: "Cao độ âm thanh (Pitch) từ 0.5 đến 2.0. (Chuẩn: 1.0)"
                },
                nightcore: {
                    type: Type.BOOLEAN,
                    description: "Bật/Tắt chế độ Nightcore (Tự động chỉnh Speed/Pitch lên ~1.2)."
                },
                bassboost: {
                    type: Type.BOOLEAN,
                    description: "Bật/Tắt chế độ Bassboost (Tăng âm trầm)."
                },
                reset: {
                    type: Type.BOOLEAN,
                    description: "Nếu true, đặt lại toàn bộ cài đặt về mặc định."
                }
            }
        }
    },

    // 4. Manage Radio
    {
        type: 'function',
        name: "manage_radio",
        description: "Thêm hoặc xóa bài hát trong danh sách phát Radio 24/7.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                action: {
                    type: Type.STRING,
                    description: "Hành động: 'add' để thêm, 'remove' để xóa.",
                    enum: ["add", "remove"]
                },
                query: {
                    type: Type.STRING,
                    description: "Tên bài hát hoặc Link cần thêm (Chỉ dùng khi action là 'add')."
                },
                index: {
                    type: Type.INTEGER,
                    description: "Số thứ tự bài hát cần xóa (Chỉ dùng khi action là 'remove')."
                }
            },
            required: ["action"]
        }
    },

    // 5. Show Music Panel
    {
        type: 'function',
        name: "show_music_panel",
        description: "Hiển thị bảng điều khiển nhạc trực quan (Buttons) cho người dùng.",
        parameters: {
            type: Type.OBJECT,
            properties: {},
        }
    }
];
