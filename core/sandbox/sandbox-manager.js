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
     * Ngăn chặn hoàn toàn Path Traversal (../, absolute path, symlink escape).
     */
    resolveSafePath(subPath) {
        if (typeof subPath !== 'string') {
            throw new Error('PATH_OUTSIDE_SANDBOX: Đường dẫn không hợp lệ.');
        }

        // Bỏ tiền tố sandbox/ nếu có
        let clean = subPath.trim().replace(/\\/g, '/');
        clean = clean.replace(/^(\.\/)+/, '');
        if (clean === '.') clean = '';
        if (clean.startsWith('sandbox/')) {
            clean = clean.substring('sandbox/'.length);
        }

        // Resolve đường dẫn tuyệt đối
        const resolved = clean ? path.resolve(this.sandboxRoot, clean) : this.sandboxRoot;

        // Kiểm tra xem resolved path có nằm hoàn toàn bên trong sandboxRoot không
        const isInside = resolved === this.sandboxRoot || resolved.startsWith(this.sandboxRoot + path.sep);
        if (!isInside) {
            throw new Error(`PATH_OUTSIDE_SANDBOX: Đường dẫn "${subPath}" cố tình vượt khỏi thư mục sandbox.`);
        }

        // Kiểm tra symlink (nếu file/dir tồn tại) để tránh symlink escape
        if (fs.existsSync(resolved)) {
            try {
                const real = fs.realpathSync(resolved);
                const realInside = real === this.sandboxRoot || real.startsWith(this.sandboxRoot + path.sep);
                if (!realInside) {
                    throw new Error(`PATH_OUTSIDE_SANDBOX: Symlink trỏ ra ngoài sandbox ("${subPath}").`);
                }
            } catch (_) { }
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
                const tempDir = path.join(this.sandboxRoot, 'temp');
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    fs.mkdirSync(tempDir, { recursive: true });
                }
            }
        } catch (err) {
            console.warn(`[SandboxManager] Warning on cleanSandbox: ${err.message}`);
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
