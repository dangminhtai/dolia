import { t as tr } from '../services/i18nService.js';
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
            Logger.info(tr('logs.prompthelper.info_prompthelper_reading_prompt_files_from_disk')); // Log để biết khi nào nó đọc file

            const promptDir = path.join(__dirname, '../config/prompt');
            // CHÚ Ý: Đảm bảo tên file ở đây khớp 100% với tên file trên Linux
            const files = ['Persona.md', 'Task.md', 'Context.md', 'Format.md'];

            let combinedContent = "";

            for (const file of files) {
                const filePath = path.join(promptDir, file);
                if (fs.existsSync(filePath)) {
                    combinedContent += fs.readFileSync(filePath, 'utf-8') + "\n\n---\n\n"; // Thêm dấu phân cách cho AI dễ hiểu
                } else {
                    Logger.warn(tr('logs.prompthelper.warn_prompthelper_file_missing', { filePath: filePath }));
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
Bạn là Dolia, trợ lý Discord thân thiện, nhanh nhẹn và hơi tinh nghịch.
- Xưng mình, gọi người dùng là bạn.
- Trả lời ngắn gọn, tự nhiên; emoji không bắt buộc và không dùng quá 1–2 icon khi thật sự phù hợp.
- Nhiệm vụ: Giúp người dùng nghe nhạc, quản lý radio và giải đáp thắc mắc.
- Ghi nhớ user: Dùng tên và sở thích khi chúng đã có trong ngữ cảnh.
- Nguyên tắc:
  1. Trả lời đi thẳng vào trọng tâm.
  2. Nếu người dùng muốn nghe nhạc -> gọi tool 'play_music'.
  3. Nếu muốn mở bảng điều khiển -> gọi tool 'show_music_panel'.
  4. Luôn kiểm tra tool phù hợp trước khi trả lời.
        `;
        Logger.error(tr('logs.prompthelper.error_prompthelper_error', { message: error.message }));
        return promptFallback;
    }
}

// Hàm phụ để Force Reload (dùng khi ông sửa file md mà không muốn tắt bot)
export function clearPromptCache() {
    cachedRawPrompt = null;
    Logger.info(tr('logs.prompthelper.info_prompthelper_cache_cleared'));
}

/**
 * Đọc file prompt riêng của Agent từ config/prompt/agent/ và thay thế placeholders
 * @param {string} fileName - Tên file (ví dụ: 'AntigravityInstruction.md')
 * @param {Object} replacements - Các cặp placeholder và giá trị (ví dụ: { '{{prompt}}': '...', '{{safeSlug}}': '...' })
 */
export function loadAgentPrompt(fileName, replacements = {}) {
    try {
        const filePath = path.join(__dirname, '../config/prompt/agent', fileName);
        if (!fs.existsSync(filePath)) {
            Logger.warn(tr('logs.prompthelper.warn_prompthelper_agent_prompt_file_missing', { filePath: filePath }));
            return '';
        }

        const isTermux = process.platform === 'android'
            || Boolean(process.env.TERMUX_VERSION)
            || String(process.env.PREFIX || '').includes('com.termux');

        const termuxPrefix = process.env.PREFIX || '/data/data/com.termux/files/usr';
        const defaultReplacements = {
            '{{host_os}}': isTermux
                ? 'Android / Termux (android)'
                : process.platform === 'win32'
                    ? 'Windows (win32)'
                    : `${process.platform}`,
            '{{python_cmd}}': isTermux || process.platform === 'win32' ? 'python' : 'python3',
            '{{font_dir}}': isTermux
                ? path.join(termuxPrefix, 'share/fonts/TTF')
                : process.platform === 'win32'
                    ? 'C:\\Windows\\Fonts'
                    : '/usr/share/fonts/truetype'
        };

        const allReplacements = { ...defaultReplacements, ...replacements };

        let content = fs.readFileSync(filePath, 'utf-8');
        for (const [key, value] of Object.entries(allReplacements)) {
            content = content.replaceAll(key, value ?? '');
        }
        return content;
    } catch (error) {
        Logger.error(tr('logs.prompthelper.error_prompthelper_error_loading_agent_prompt', { fileName: fileName, message: error.message }));
        return '';
    }
}
