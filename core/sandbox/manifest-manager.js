import fs from 'fs';
import path from 'path';
import sandboxManager from './sandbox-manager.js';
import mappingRegistry from './mapping-registry.js';
import sandboxValidator from './sandbox-validator.js';

/**
 * ManifestManager - Quản lý và Re-validate Change Manifest
 * Coi mọi manifest từ Agent là Untrusted Input, bắt buộc phải Re-validate độc lập ở Host.
 */
export class ManifestManager {
    constructor() {
        this.manifestFileName = '.manifest.json';
    }

    /**
     * Tạo file đề xuất manifest ban đầu trong sandbox (Agent phase)
     */
    createProposedManifest(summary, changes = []) {
        const manifest = {
            status: 'ready',
            summary: summary || 'Thay đổi được đề xuất bởi Dolia Agent',
            createdAt: new Date().toISOString(),
            changes: changes.map(ch => ({
                action: ch.action || 'create', // 'create' | 'modify' | 'delete'
                source: mappingRegistry.normalizePath(ch.source || ''),
                target: ch.target ? mappingRegistry.normalizePath(ch.target) : mappingRegistry.resolveTarget(ch.source)
            }))
        };

        sandboxManager.writeFile(this.manifestFileName, JSON.stringify(manifest, null, 2));
        return manifest;
    }

    /**
     * Đọc manifest từ sandbox
     */
    readProposedManifest() {
        if (!sandboxManager.exists(this.manifestFileName)) {
            throw new Error(`MANIFEST_NOT_FOUND: File "${this.manifestFileName}" không tồn tại trong sandbox.`);
        }

        const raw = sandboxManager.readFile(this.manifestFileName);
        try {
            return JSON.parse(raw);
        } catch (e) {
            throw new Error(`MANIFEST_INVALID_JSON: Không thể parse file manifest: ${e.message}`);
        }
    }

    /**
     * HOST RE-VALIDATION (CỰC KỲ QUAN TRỌNG)
     * Re-validate toàn bộ manifest độc lập trước khi Apply, không tin tưởng mù quáng vào Agent.
     */
    async revalidateManifest(rawManifest) {
        const errors = [];
        const verifiedChanges = [];

        if (!rawManifest || typeof rawManifest !== 'object') {
            return { valid: false, errors: ['Manifest rỗng hoặc không phải là Object hợp lệ.'], verifiedChanges: [] };
        }

        if (!Array.isArray(rawManifest.changes) || rawManifest.changes.length === 0) {
            return { valid: false, errors: ['Manifest không chứa danh sách thay đổi hợp lệ (changes array empty).'], verifiedChanges: [] };
        }

        for (let i = 0; i < rawManifest.changes.length; i++) {
            const ch = rawManifest.changes[i];
            const changeIdx = i + 1;

            if (!ch || typeof ch !== 'object') {
                errors.push(`Mục thay đổi #${changeIdx} không hợp lệ.`);
                continue;
            }

            const action = (ch.action || '').toLowerCase();
            if (!['create', 'modify', 'delete'].includes(action)) {
                errors.push(`Mục #${changeIdx}: Hành động "${action}" không được hỗ trợ (chỉ chấp nhận create, modify, delete).`);
                continue;
            }

            let source = ch.source ? mappingRegistry.normalizePath(ch.source) : null;
            let target = ch.target ? mappingRegistry.normalizePath(ch.target) : null;

            // Xử lý action CREATE hoặc MODIFY
            if (action === 'create' || action === 'modify') {
                if (!source) {
                    errors.push(`Mục #${changeIdx}: Thiếu source path.`);
                    continue;
                }

                // 1. Kiểm tra source phải nằm an toàn trong sandbox
                let fullSourcePath;
                try {
                    fullSourcePath = sandboxManager.resolveSafePath(source);
                } catch (pe) {
                    errors.push(`Mục #${changeIdx}: Source path vi phạm an toàn: ${pe.message}`);
                    continue;
                }

                // 2. File source phải thực sự tồn tại trong sandbox
                if (!fs.existsSync(fullSourcePath)) {
                    errors.push(`Mục #${changeIdx}: File nguồn "${source}" không tồn tại trong sandbox.`);
                    continue;
                }

                // 3. Đối chiếu và kiểm tra Target qua Mapping Registry
                try {
                    const expectedTarget = mappingRegistry.resolveTarget(source);
                    if (target && target !== expectedTarget) {
                        errors.push(`Mục #${changeIdx}: Target "${target}" không khớp với quy tắc Mapping Registry cho "${source}" (mong đợi: "${expectedTarget}").`);
                        continue;
                    }
                    target = expectedTarget;
                } catch (mapErr) {
                    errors.push(`Mục #${changeIdx}: ${mapErr.message}`);
                    continue;
                }

                // 4. Kiểm tra target không được rơi vào Blacklist
                if (mappingRegistry.isTargetBlacklisted(target)) {
                    errors.push(`Mục #${changeIdx}: Target "${target}" nằm trong vùng cấm bảo vệ tuyệt đối (Blacklist).`);
                    continue;
                }

                // 5. Kiểm tra tính hợp lệ của file nguồn bằng SandboxValidator
                const valResult = await sandboxValidator.validateFile(fullSourcePath);
                if (!valResult.valid) {
                    errors.push(`Mục #${changeIdx} (${source}): Kiểm thử validation thất bại:\n${valResult.errors.join('\n')}`);
                    continue;
                }

                verifiedChanges.push({
                    action,
                    source,
                    target,
                    fullSourcePath,
                    fullTargetPath: path.resolve(process.cwd(), target)
                });
            }

            // Xử lý action DELETE
            if (action === 'delete') {
                if (!target) {
                    errors.push(`Mục #${changeIdx}: Action delete yêu cầu chỉ định rõ target path.`);
                    continue;
                }

                if (!mappingRegistry.isTargetAllowed(target)) {
                    errors.push(`Mục #${changeIdx}: Target xóa "${target}" không nằm trong vùng mapping được phép.`);
                    continue;
                }

                if (mappingRegistry.isTargetBlacklisted(target)) {
                    errors.push(`Mục #${changeIdx}: Không thể xóa target trong vùng cấm bảo vệ (Blacklist): ${target}`);
                    continue;
                }

                const fullTargetPath = path.resolve(process.cwd(), target);
                verifiedChanges.push({
                    action: 'delete',
                    source: null,
                    target,
                    fullSourcePath: null,
                    fullTargetPath
                });
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            verifiedChanges,
            summary: rawManifest.summary || 'Thay đổi đã qua Host Re-validation'
        };
    }
}

export default new ManifestManager();
