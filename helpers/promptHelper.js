import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Logger from '../class/Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Biến Cache: Lưu nội dung gốc chưa replace
let cachedRawPrompt = null;

export function loadSystemPrompt(replacements) {
    try {
        // 2. Chỉ đọc file nếu chưa có trong Cache
        if (!cachedRawPrompt) {
            Logger.info('[PromptHelper] Reading prompt files from disk...'); // Log để biết khi nào nó đọc file

            const promptDir = path.join(__dirname, '../config/prompt');
            // CHÚ Ý: Đảm bảo tên file ở đây khớp 100% với tên file trên Linux
            const files = ['Persona.md', 'Task.md', 'Context.md', 'Format.md'];

            let combinedContent = "";

            for (const file of files) {
                const filePath = path.join(promptDir, file);
                if (fs.existsSync(filePath)) {
                    combinedContent += fs.readFileSync(filePath, 'utf-8') + "\n\n---\n\n"; // Thêm dấu phân cách cho AI dễ hiểu
                } else {
                    Logger.warn(`[PromptHelper] ⚠️ File missing: ${filePath}`);
                }
            }
            cachedRawPrompt = combinedContent;
        }

        // 3. Xử lý Replace trên nội dung đã Cache (Tốc độ cực nhanh)
        let finalPrompt = cachedRawPrompt;

        for (const [key, value] of Object.entries(replacements)) {
            // Lưu ý: Key truyền vào nên là '{{user}}' thay vì 'user' để tránh replace nhầm từ ngữ thông thường
            // Ví dụ: replacements = { "{{user}}": "Tài" }
            finalPrompt = finalPrompt.replaceAll(key, value || 'Unknown');
        }

        return finalPrompt;

    } catch (error) {
        const promptFallback = `
Bạn là Dolia, một trợ lý ảo dễ thương, năng động trên Discord.
- Tính cách: Vui vẻ, thân thiện, dùng nhiều emoji (🎵, ✨, 🎧, UwU).
- Nhiệm vụ: Giúp người dùng nghe nhạc, quản lý radio và giải đáp thắc mắc.
- Ghi nhớ user: Bạn có khả năng nhớ tên và sở thích của user từ lịch sử chat.
- Nguyên tắc:
  1. Trả lời ngắn gọn, đi vào trọng tâm.
  2. Nếu người dùng muốn nghe nhạc -> gọi tool 'play_music'.
  3. Nếu muốn mở bảng điều khiển -> gọi tool 'show_music_panel'.
  4. Luôn kiểm tra tool phù hợp trước khi trả lời.
        `;
        Logger.error(`[PromptHelper] 🔥 Error: ${error.message}`);
        return promptFallback;
    }
}

// Hàm phụ để Force Reload (dùng khi ông sửa file md mà không muốn tắt bot)
export function clearPromptCache() {
    cachedRawPrompt = null;
    Logger.info('[PromptHelper] Cache cleared.');
}