import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * SandboxValidator - Hệ thống Validator mô-đun mở rộng
 * Hỗ trợ: Common, JavaScript, JSON, Import Resolution và Type-specific (Slash, i18n, Script...)
 */
export class SandboxValidator {
    constructor() {
        // Regex bốc các câu lệnh import trong file JavaScript
        this.importRegex = /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
    }

    /**
     * 1. Common Validator - Kiểm tra cơ bản
     */
    validateCommon(filePath) {
        const errors = [];
        if (!fs.existsSync(filePath)) {
            errors.push(`File không tồn tại trên ổ đĩa: ${filePath}`);
            return errors;
        }

        const stat = fs.statSync(filePath);
        if (stat.size === 0) {
            errors.push(`File rỗng (0 bytes).`);
        }
        if (stat.size > 5 * 1024 * 1024) { // Max 5MB
            errors.push(`Kích thước file vượt quá giới hạn cho phép (5MB).`);
        }

        return errors;
    }

    /**
     * 2. JavaScript Validator - Kiểm tra cú pháp node -c & ESM
     */
    async validateJavaScript(filePath) {
        const errors = [];
        try {
            await execPromise(`node -c "${filePath}"`);
        } catch (syntaxErr) {
            errors.push(`Lỗi cú pháp JavaScript (node -c): ${syntaxErr.message}`);
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            if (content.includes('module.exports =') || content.includes('exports.')) {
                errors.push(`Phát hiện cú pháp CommonJS (module.exports). Dolia yêu cầu chuẩn ESM (export default / export).`);
            }
        } catch (e) {
            errors.push(`Không thể đọc file để kiểm tra ESM: ${e.message}`);
        }

        return errors;
    }

    /**
     * 3. JSON Validator - Kiểm tra cú pháp JSON
     */
    validateJson(filePath) {
        const errors = [];
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            JSON.parse(content);
        } catch (jsonErr) {
            errors.push(`Lỗi cú pháp JSON: ${jsonErr.message}`);
        }
        return errors;
    }

    /**
     * 4. Import Resolution Validator - Kiểm tra các module import tương đối có tồn tại thật không
     * Tránh lỗi "Verify syntax pass nhưng runtime fail do thiếu module"
     */
    validateImportResolution(filePath, rootDir = process.cwd()) {
        const errors = [];
        const warnings = [];

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const fileDir = path.dirname(filePath);

            let match;
            this.importRegex.lastIndex = 0;
            while ((match = this.importRegex.exec(content)) !== null) {
                const importTarget = match[1] || match[2];
                if (!importTarget) continue;

                // Chỉ kiểm tra các import tương đối nội bộ (./ hoặc ../)
                if (importTarget.startsWith('./') || importTarget.startsWith('../')) {
                    const resolved = path.resolve(fileDir, importTarget);

                    // Thử các đuôi mở rộng phổ biến nếu import không ghi đuôi
                    const candidateExtensions = ['', '.js', '.mjs', '.json'];
                    let found = false;

                    for (const ext of candidateExtensions) {
                        const testPath = resolved + ext;
                        if (fs.existsSync(testPath) && fs.statSync(testPath).isFile()) {
                            found = true;
                            break;
                        }
                    }

                    if (!found) {
                        errors.push(`UNRESOLVED_IMPORT: Import "${importTarget}" trong file không trỏ đến bất kỳ file thực tế nào.`);
                    }
                }
            }
        } catch (e) {
            warnings.push(`Không thể quét import resolution: ${e.message}`);
        }

        return { errors, warnings };
    }

    /**
     * 5. Type-Specific Validators
     */
    validateSlashCommand(filePath) {
        const errors = [];
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            if (!content.includes('SlashCommandBuilder') && !content.includes('name') && !content.includes('description')) {
                errors.push(`Slash Command thiếu khai báo cấu trúc data (SlashCommandBuilder).`);
            }
            if (!content.includes('async execute(') && !content.includes('execute(')) {
                errors.push(`Slash Command thiếu phương thức thực thi "execute(interaction)".`);
            }
        } catch (e) {
            errors.push(`Lỗi kiểm tra Slash Command: ${e.message}`);
        }
        return errors;
    }

    validateI18n(filePath) {
        const errors = [];
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);
            if (typeof data !== 'object' || data === null || Array.isArray(data)) {
                errors.push(`File tài nguyên ngôn ngữ i18n bắt buộc phải là một JSON Object.`);
            }
        } catch (e) {
            // Lỗi parse JSON đã được bắt ở JsonValidator
        }
        return errors;
    }

    /**
     * Validator Tổng Hợp
     * @param {string} filePath - Đường dẫn file cần kiểm tra (trong sandbox hoặc production)
     * @param {string} fileCategory - Loại file ('slash', 'i18n', 'script', 'utils', 'config', hoặc null để tự suy đoán)
     */
    async validateFile(filePath, fileCategory = null) {
        const result = {
            filePath,
            valid: true,
            errors: [],
            warnings: []
        };

        // 1. Common Checks
        const commonErrors = this.validateCommon(filePath);
        if (commonErrors.length > 0) {
            result.errors.push(...commonErrors);
            result.valid = false;
            return result;
        }

        const ext = path.extname(filePath).toLowerCase();

        // 2. JavaScript Checks
        if (ext === '.js' || ext === '.mjs') {
            const jsErrors = await this.validateJavaScript(filePath);
            result.errors.push(...jsErrors);

            // Import Resolution
            const importRes = this.validateImportResolution(filePath);
            result.errors.push(...importRes.errors);
            result.warnings.push(...importRes.warnings);
        }

        // 3. JSON Checks
        if (ext === '.json') {
            const jsonErrors = this.validateJson(filePath);
            result.errors.push(...jsonErrors);
        }

        // 4. Type-specific Checks
        const normalized = filePath.replace(/\\/g, '/');
        const isSlash = fileCategory === 'slash' || normalized.includes('/slash/') || normalized.includes('commands/slash/');
        const isI18n = fileCategory === 'i18n' || normalized.includes('/i18n/') || normalized.includes('resources/');

        if (isSlash && (ext === '.js' || ext === '.mjs')) {
            const slashErrors = this.validateSlashCommand(filePath);
            result.errors.push(...slashErrors);
        }

        if (isI18n && ext === '.json') {
            const i18nErrors = this.validateI18n(filePath);
            result.errors.push(...i18nErrors);
        }

        result.valid = result.errors.length === 0;
        return result;
    }
}

export default new SandboxValidator();
