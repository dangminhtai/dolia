import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatString } from '../helpers/placeHolder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESOURCE_DIR = path.resolve(__dirname, '../resources/vi');

let resources = {};
let isInitialized = false;

/**
 * Khởi tạo và load toàn bộ tài nguyên tiếng Việt
 */
export function initI18n() {
    resources = {};
    if (!fs.existsSync(RESOURCE_DIR)) {
        console.warn(`[i18n] Thư mục tài nguyên không tồn tại: ${RESOURCE_DIR}`);
        return;
    }

    const files = fs.readdirSync(RESOURCE_DIR).filter(file => file.endsWith('.json'));
    for (const file of files) {
        const namespace = path.basename(file, '.json');
        const filePath = path.join(RESOURCE_DIR, file);
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            resources[namespace] = JSON.parse(content);
        } catch (err) {
            console.error(`[i18n] Lỗi đọc file tài nguyên: ${file}`, err);
        }
    }
    isInitialized = true;
    console.log(`[i18n] Đã nạp ${files.length} file tài nguyên tiếng Việt (vi): ${files.join(', ')}`);
}

/**
 * Nạp lại toàn bộ tài nguyên (Hot-reload mà không cần khởi động lại bot)
 */
export function reloadI18n() {
    initI18n();
}

/**
 * Lấy chuỗi bản dịch theo key dạng dot-notation (vd: 'music.track_start')
 * @param {string} key - Đường dẫn key phân tách bằng dấu chấm
 * @param {object} [params] - Đối tượng chứa tham số thay thế { title: 'abc', ... }
 * @param {object} [context] - Discord interaction hoặc message context để giải quyết placeholder Discord
 * @returns {string} Chuỗi sau khi đã thay thế tham số
 */
export function t(key, params = {}, context = null) {
    if (!isInitialized) {
        initI18n();
    }

    const parts = key.split('.');
    let current = resources;

    for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
            current = current[part];
        } else {
            console.warn(`[i18n] Không tìm thấy key: ${key}`);
            return key;
        }
    }

    if (typeof current !== 'string') {
        return key;
    }

    let result = current;

    // Thay thế params dạng {{key}}
    if (params && typeof params === 'object') {
        for (const [k, v] of Object.entries(params)) {
            const regex = new RegExp(`{{\\s*${k}\\s*}}`, 'gi');
            result = result.replace(regex, v !== undefined && v !== null ? v : '');
        }
    }

    // Nếu có Discord context, áp dụng formatString từ placeHolder.js
    if (context) {
        result = formatString(result, context);
    }

    return result;
}

export function getLocale() {
    return 'vi';
}

export default {
    t,
    initI18n,
    reloadI18n,
    getLocale
};
