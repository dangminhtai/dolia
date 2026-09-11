import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatString } from '../helpers/placeHolder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESOURCE_DIR = path.resolve(__dirname, '../resources/vi');
const SANDBOX_I18N_DIR = path.resolve(__dirname, '../sandbox/i18n');

let resources = {};
let isInitialized = false;

/**
 * Khởi tạo và load toàn bộ tài nguyên tiếng Việt (cả built-in và sandbox)
 */
export function initI18n() {
    resources = {};
    const loadedFiles = [];

    // 1. Nạp tài nguyên gốc từ resources/vi
    if (fs.existsSync(RESOURCE_DIR)) {
        const files = fs.readdirSync(RESOURCE_DIR).filter(file => file.endsWith('.json'));
        for (const file of files) {
            const namespace = path.basename(file, '.json');
            const filePath = path.join(RESOURCE_DIR, file);
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                resources[namespace] = JSON.parse(content);
                loadedFiles.push(file);
            } catch (err) {
                console.error(`[i18n] Lỗi đọc file tài nguyên: ${file}`, err);
            }
        }
    }

    // 2. Nạp tài nguyên động từ sandbox/i18n (do Dolia tạo)
    if (fs.existsSync(SANDBOX_I18N_DIR)) {
        const sandboxFiles = fs.readdirSync(SANDBOX_I18N_DIR).filter(file => file.endsWith('.json'));
        for (const file of sandboxFiles) {
            const namespace = path.basename(file, '.json');
            const filePath = path.join(SANDBOX_I18N_DIR, file);
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                resources[namespace] = JSON.parse(content);
                loadedFiles.push(`sandbox/${file}`);
            } catch (err) {
                console.error(`[i18n] Lỗi đọc file tài nguyên sandbox: ${file}`, err);
            }
        }
    }

    isInitialized = true;
    console.log(`[i18n] Đã nạp ${loadedFiles.length} file tài nguyên tiếng Việt (vi): ${loadedFiles.join(', ')}`);
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
    let found = true;

    for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
            current = current[part];
        } else {
            found = false;
            break;
        }
    }

    // Nếu không tìm thấy theo dot-path, tìm kiếm tự động qua các namespace (hỗ trợ minigame sandbox)
    if (!found) {
        for (const ns of Object.keys(resources)) {
            if (resources[ns] && typeof resources[ns] === 'object' && key in resources[ns]) {
                current = resources[ns][key];
                found = true;
                break;
            }
        }
    }

    if (!found || typeof current !== 'string') {
        return key;
    }

    let result = current;

    // Thay thế params dạng {{key}} hoặc {key}
    if (params && typeof params === 'object') {
        for (const [k, v] of Object.entries(params)) {
            const regex = new RegExp(`\\{{1,2}\\s*${k}\\s*\\}{1,2}`, 'gi');
            result = result.replace(regex, v !== undefined && v !== null ? v : '');
        }
    }

    // Nếu có Discord context, áp dụng formatString từ placeHolder.js
    if (context) {
        result = formatString(result, context);
    }

    // Dọn dẹp an toàn các placeholder {{...}} còn sót lại nếu không được truyền params (tránh lộ raw template trên Discord)
    result = result.replace(/{{\s*[\w.-]+\s*}}/g, '');

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
