import { t as tr } from '../../services/i18nService.js';
import fs from 'fs';
import path from 'path';
import manifestManager from './manifest-manager.js';
import transactionManager from './transaction-manager.js';
import rollbackManager from './rollback-manager.js';
import sandboxValidator from './sandbox-validator.js';

/**
 * ApplyEngine - Host Apply Controller (Trusted Zone)
 * Là cổng kiểm soát duy nhất được phép đưa code từ Sandbox vào Production sau khi Chủ nhân phê duyệt.
 */
export class ApplyEngine {
    /**
     * Thực thi quy trình Apply nguyên tử
     * @param {object} manifest - Manifest do Agent đề xuất (Được coi là Untrusted Input)
     * @param {object} options - { isApproved: boolean, approvedBy: string }
     */
    async apply(manifest, options = {}) {
        // 1. APPROVAL GATE: Phải có xác nhận phê duyệt từ Chủ nhân
        if (!options.isApproved) {
            throw new Error('APPLY_BLOCKED: Giao dịch bị chặn vì chưa nhận được phê duyệt (APPROVED) từ Chủ nhân.');
        }

        console.log(tr('logs.apply_engine.log_applyengine_bat_dau_quy_trinh_apply_cho'));

        // 2. HOST RE-VALIDATION: Tự kiểm tra độc lập toàn bộ manifest và các file nguồn
        const reval = await manifestManager.revalidateManifest(manifest);
        if (!reval.valid) {
            const errDetail = reval.errors.join('; ');
            throw new Error(`HOST_REVALIDATION_FAILED: Đề xuất manifest không đạt chuẩn bảo mật của Host: ${errDetail}`);
        }

        // 3. TRANSACTION BEGIN: Mở phiên giao dịch và chuẩn bị snapshot backup
        const txData = transactionManager.beginTransaction(manifest, options);
        console.log(tr('logs.apply_engine.log_applyengine_khoi_tao_giao_dich', { transactionId: txData.transactionId }));

        try {
            // 4. BACKUP & ATOMIC COPY / DELETE
            for (const change of reval.verifiedChanges) {
                const targetRelative = change.target;

                // Sao lưu file production hiện tại nếu đã tồn tại
                const isExisting = fs.existsSync(change.fullTargetPath);
                if (isExisting) {
                    transactionManager.backupProductionFile(txData, targetRelative);
                }

                if (change.action === 'create' || change.action === 'modify') {
                    const targetParent = path.dirname(change.fullTargetPath);
                    if (!fs.existsSync(targetParent)) {
                        fs.mkdirSync(targetParent, { recursive: true });
                    }

                    // Copy file từ sandbox sang production
                    fs.copyFileSync(change.fullSourcePath, change.fullTargetPath);

                    if (isExisting) {
                        txData.modifiedFiles.push(targetRelative);
                    } else {
                        txData.createdFiles.push(targetRelative);
                    }
                    console.log(tr('logs.apply_engine.log_applyengine_da_ap_dung', { value: change.action.toUpperCase(), targetRelative: targetRelative }));
                } else if (change.action === 'delete') {
                    if (fs.existsSync(change.fullTargetPath)) {
                        fs.rmSync(change.fullTargetPath, { recursive: true, force: true });
                        txData.deletedFiles.push(targetRelative);
                        console.log(tr('logs.apply_engine.log_applyengine_da_xoa_delete', { targetRelative: targetRelative }));
                    }
                }
            }

            // 5. DEEP VERIFICATION TRONG PRODUCTION
            // Kiểm tra syntax và import resolution của tất cả file vừa ghi vào production
            for (const change of reval.verifiedChanges) {
                if (change.action === 'create' || change.action === 'modify') {
                    const prodVerify = await sandboxValidator.validateFile(change.fullTargetPath);
                    if (!prodVerify.valid) {
                        throw new Error(`PRODUCTION_VERIFY_FAILED: File "${change.target}" không vượt qua kiểm tra sau khi áp dụng vào production:\n${prodVerify.errors.join('\n')}`);
                    }
                }
            }

            // 6. COMMIT TRANSACTION
            transactionManager.commitTransaction(txData, {
                status: 'APPLIED',
                appliedChangesCount: reval.verifiedChanges.length
            });

            console.log(tr('logs.apply_engine.log_applyengine_giao_dich_da_commit_thanh_cong', { transactionId: txData.transactionId }));

            return {
                status: 'APPLIED',
                next_action: 'ready_for_reload',
                transactionId: txData.transactionId,
                summary: reval.summary,
                appliedFiles: reval.verifiedChanges.map(c => ({ action: c.action, target: c.target }))
            };

        } catch (applyErr) {
            console.error(tr('logs.apply_engine.error_applyengine_loi_trong_qua_trinh_apply', { message: applyErr.message }));

            // Tự động kích hoạt Rollback để bảo vệ 100% tính toàn vẹn của production
            await rollbackManager.rollback(txData, applyErr.message);

            throw new Error(`APPLY_FAILED_ROLLED_BACK: Quá trình apply thất bại và hệ thống đã tự động Rollback an toàn: ${applyErr.message}`);
        }
    }
}

export default new ApplyEngine();
