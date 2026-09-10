import path from 'path';

/**
 * MappingRegistry - Fixed Host-side Security Policy
 * Nằm hoàn toàn trong core/sandbox/, Agent không có quyền can thiệp vào file này.
 */
class MappingRegistry {
    constructor() {
        // Danh bạ mapping cố định giữa thư mục trong sandbox/ và thư mục production
        this.mappings = {
            'slash/': 'commands/slash/',
            'i18n/': 'resources/vi/',
            'scripts/': 'scripts/',
            'utils/': 'utils/',
            'config/': 'config/'
        };

        // Danh sách các file & thư mục cấm can thiệp tuyệt đối (Blacklist)
        this.blacklistExact = new Set([
            '.env',
            '.env.example',
            'index.js',
            'db.js',
            'cookies.txt',
            'package.json',
            'package-lock.json',
            'nodemon.json',
            'deployCommands.js',
            'deployOnly.js',
            'SANDBOX.md',
            'RULES_DOLIA.md'
        ]);

        this.blacklistPrefixes = [
            'core/',
            '.git/',
            'node_modules/',
            '.apply/',
            '.worktrees/',
            'class/',
            'models/',
            'events/',
            'schema/'
        ];
    }

    /**
     * Chuẩn hóa đường dẫn tương đối (bỏ sandbox/ nếu có, chuẩn hóa dấu gạch chéo)
     */
    normalizePath(filePath) {
        if (!filePath || typeof filePath !== 'string') return '';
        let clean = filePath.trim().replace(/\\/g, '/');
        clean = clean.replace(/^(\.\/)+/, '');
        if (clean.startsWith('sandbox/')) {
            clean = clean.substring('sandbox/'.length);
        }
        return clean.replace(/^\/+/, '');
    }

    /**
     * Kiểm tra target có bị rơi vào vùng Blacklist không
     */
    isTargetBlacklisted(targetPath) {
        const clean = this.normalizePath(targetPath);
        const fileName = path.basename(clean);

        // 1. Kiểm tra exact file name
        if (this.blacklistExact.has(clean) || this.blacklistExact.has(fileName)) {
            return true;
        }

        // 2. Kiểm tra prefixes
        for (const prefix of this.blacklistPrefixes) {
            if (clean.startsWith(prefix) || clean === prefix.replace(/\/$/, '')) {
                return true;
            }
        }

        // 3. Chặn path traversal
        if (clean.includes('..') || path.isAbsolute(clean)) {
            return true;
        }

        return false;
    }

    /**
     * Chuyển đổi một source path trong sandbox thành target path trong production
     * @param {string} sourcePath - Đường dẫn bên trong sandbox (ví dụ 'slash/dice.js' hoặc 'sandbox/slash/dice.js')
     * @returns {string} - Đường dẫn target production tương ứng (ví dụ 'commands/slash/dice.js')
     */
    resolveTarget(sourcePath) {
        const cleanSource = this.normalizePath(sourcePath);

        // 1. Kiểm tra xem cleanSource có khớp với mapping prefix nào không
        for (const [sourcePrefix, targetPrefix] of Object.entries(this.mappings)) {
            if (cleanSource.startsWith(sourcePrefix)) {
                const relativeSubPath = cleanSource.substring(sourcePrefix.length);
                const targetPath = `${targetPrefix}${relativeSubPath}`;

                // 2. Kiểm tra target có nằm trong blacklist không
                if (this.isTargetBlacklisted(targetPath)) {
                    throw new Error(`BLACKLISTED_TARGET: Target "${targetPath}" is strictly protected by Host Security Policy.`);
                }

                return targetPath;
            }
        }

        throw new Error(`UNMAPPED_SOURCE: Source "${sourcePath}" does not match any registered prefix in Host Mapping Registry (${Object.keys(this.mappings).join(', ')}).`);
    }

    /**
     * Kiểm tra xem một target path có hợp lệ theo policy không
     */
    isTargetAllowed(targetPath) {
        const clean = this.normalizePath(targetPath);
        if (this.isTargetBlacklisted(clean)) return false;

        // Phải thuộc ít nhất một target prefix đã đăng ký
        for (const targetPrefix of Object.values(this.mappings)) {
            if (clean.startsWith(targetPrefix)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Lấy danh sách mapping hiện tại
     */
    getMappings() {
        return { ...this.mappings };
    }
}

export default new MappingRegistry();
