import { t as tr } from '../../services/i18nService.js';
import fs from 'fs';
import path from 'path';

/**
 * SandboxManager - Quản lý File System an toàn cho Agent
 * Bắt buộc mọi thao tác file của Agent phải nằm bên trong thư mục sandbox/
 */
export class SandboxManager {
    constructor(customRoot = null) {
        this.sandboxRoot = customRoot 
            ? path.resolve(customRoot) 
            : path.resolve(process.cwd(), 'sandbox');
        this.init();
        if (fs.lstatSync(this.sandboxRoot).isSymbolicLink()) {
            throw new Error('PATH_OUTSIDE_SANDBOX: Thư mục sandbox không được là symlink hoặc junction.');
        }
        this.realSandboxRoot = fs.realpathSync(this.sandboxRoot);
    }

    /**
     * Đảm bảo thư mục sandbox/ luôn tồn tại
     */
    init() {
        if (!fs.existsSync(this.sandboxRoot)) {
            fs.mkdirSync(this.sandboxRoot, { recursive: true });
        }
    }

    /**
     * Kiểm tra và giải quyết đường dẫn tuyệt đối an toàn trong sandbox.
     * Bảo vệ các thao tác đi qua manager; không cô lập mã gọi fs trực tiếp.
     */
    resolveSafePath(subPath) {
        if (typeof subPath !== 'string' || subPath.includes('\0')) {
            throw new Error('PATH_OUTSIDE_SANDBOX: Đường dẫn không hợp lệ.');
        }

        // Bỏ tiền tố sandbox/ nếu có
        let clean = subPath.trim().replace(/\\/g, '/');
        clean = clean.replace(/^(\.\/)+/, '');
        if (clean === '.') clean = '';
        if (clean.startsWith('sandbox/')) {
            clean = clean.substring('sandbox/'.length);
        }
        if (path.win32.isAbsolute(clean) && !path.isAbsolute(clean)) {
            throw new Error('PATH_OUTSIDE_SANDBOX: Đường dẫn không thuộc hệ thống hiện tại.');
        }

        // Resolve đường dẫn tuyệt đối
        const resolved = clean ? path.resolve(this.sandboxRoot, clean) : this.sandboxRoot;

        // Kiểm tra xem resolved path có nằm hoàn toàn bên trong sandboxRoot không
        const isInside = resolved === this.sandboxRoot || resolved.startsWith(this.sandboxRoot + path.sep);
        if (!isInside) {
            throw new Error(`PATH_OUTSIDE_SANDBOX: Đường dẫn "${subPath}" cố tình vượt khỏi thư mục sandbox.`);
        }

        const parts = path.relative(this.sandboxRoot, resolved).split(path.sep).filter(Boolean);
        if (parts.some(part => /[:<>"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
            throw new Error('PATH_OUTSIDE_SANDBOX: Tên tệp không hợp lệ.');
        }
        if (fs.lstatSync(this.sandboxRoot).isSymbolicLink() || fs.realpathSync(this.sandboxRoot) !== this.realSandboxRoot) {
            throw new Error('PATH_OUTSIDE_SANDBOX: Thư mục sandbox đã bị thay thế.');
        }
        // Check existing parents too: a new file can be beneath an escaping symlink.
        let current = this.sandboxRoot;
        for (const part of parts) {
            current = path.join(current, part);
            let stat;
            try { stat = fs.lstatSync(current); }
            catch (error) { if (error.code === 'ENOENT') break; throw error; }
            const real = fs.realpathSync(current);
            const relative = path.relative(this.realSandboxRoot, real);
            if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || (stat.isFile() && stat.nlink > 1)) {
                throw new Error('PATH_OUTSIDE_SANDBOX: Liên kết tệp không được phép.');
            }
        }

        return resolved;
    }

    /**
     * Ghi nội dung vào file trong sandbox (Tự tạo thư mục cha nếu chưa có)
     */
    writeFile(subPath, content, encoding = 'utf-8') {
        const fullPath = this.resolveSafePath(subPath);
        const parentDir = path.dirname(fullPath);

        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }

        this.resolveSafePath(fullPath);
        fs.writeFileSync(fullPath, content, encoding);
        return fullPath;
    }

    /**
     * Đọc nội dung file trong sandbox
     */
    readFile(subPath, encoding = 'utf-8') {
        const fullPath = this.resolveSafePath(subPath);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`FILE_NOT_FOUND: File "${subPath}" không tồn tại trong sandbox.`);
        }
        return fs.readFileSync(fullPath, encoding);
    }

    /**
     * Kiểm tra file có tồn tại trong sandbox không
     */
    exists(subPath) {
        try {
            const fullPath = this.resolveSafePath(subPath);
            return fs.existsSync(fullPath);
        } catch (_) {
            return false;
        }
    }

    /**
     * Xóa một file trong sandbox
     */
    deleteFile(subPath) {
        const fullPath = this.resolveSafePath(subPath);
        if (fullPath === this.sandboxRoot) throw new Error('PATH_OUTSIDE_SANDBOX: Không được xóa gốc sandbox.');
        if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            return true;
        }
        return false;
    }

    /**
     * Liệt kê tất cả các file bên trong sandbox (dạng đường dẫn tương đối)
     */
    listFiles(subDir = '') {
        const targetDir = this.resolveSafePath(subDir);
        if (!fs.existsSync(targetDir)) return [];

        const fileList = [];
        const scan = (dir) => {
            this.resolveSafePath(dir);
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scan(full);
                } else if (entry.isFile()) {
                    const relative = path.relative(this.sandboxRoot, full).replace(/\\/g, '/');
                    fileList.push(relative);
                }
            }
        };

        scan(targetDir);
        return fileList;
    }

    /**
     * Dọn dẹp file trong sandbox. TUYỆT ĐỐI KHÔNG xóa sạch sandboxRoot vì làm mất các lệnh slash command đang chạy!
     */
    cleanSandbox(targetRelPath = null) {
        try {
            if (targetRelPath) {
                const fullPath = this.resolveSafePath(targetRelPath);
                if (fs.existsSync(fullPath)) {
                    fs.unlinkSync(fullPath);
                }
            } else {
                // Chỉ dọn thư mục tạm nếu có
                const tempDir = this.resolveSafePath('temp');
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    fs.mkdirSync(tempDir, { recursive: true });
                }
            }
        } catch (err) {
            console.warn(tr('logs.sandbox_manager.warn_sandboxmanager_warning_on_cleansandbox', { message: err.message }));
        }
        return this;
    }

    getSandboxRoot() {
        return this.sandboxRoot;
    }

    get sandboxDir() {
        return this.sandboxRoot;
    }
}

export default new SandboxManager();
