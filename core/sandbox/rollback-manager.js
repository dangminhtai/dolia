import { t as tr } from '../../services/i18nService.js';
import fs from 'fs';
import path from 'path';
import transactionManager from './transaction-manager.js';

/**
 * RollbackManager - Khôi phục nguyên tử trạng thái Production
 * Được kích hoạt tự động nếu có bất kỳ lỗi nào trong quá trình Apply hoặc Deep Verification
 */
export class RollbackManager {
    /**
     * Thực hiện khôi phục toàn diện giao dịch
     */
    async rollback(transactionData, errorReason) {
        console.warn(tr('logs.rollback_manager.warn_rollbackmanager_dang_kich_hoat_rollback_cho_giao', { transactionId: transactionData.transactionId, errorReason: errorReason }));
        let restoredCount = 0;
        let removedCount = 0;

        try {
            // 1. Xóa các file mới tạo trong production nếu có
            if (Array.isArray(transactionData.createdFiles)) {
                for (const relativePath of transactionData.createdFiles) {
                    const prodPath = path.resolve(process.cwd(), relativePath);
                    if (fs.existsSync(prodPath)) {
                        fs.rmSync(prodPath, { recursive: true, force: true });
                        removedCount++;
                        console.log(tr('logs.rollback_manager.log_rollbackmanager_da_xoa_file_moi_tao_do', { relativePath: relativePath }));
                    }
                }
            }

            // 2. Phục hồi các file đã bị sửa hoặc xóa từ thư mục backup/
            if (Array.isArray(transactionData.backedUpFiles)) {
                for (const item of transactionData.backedUpFiles) {
                    const prodPath = path.resolve(process.cwd(), item.relativeTargetPath);
                    const prodParent = path.dirname(prodPath);

                    if (!fs.existsSync(prodParent)) {
                        fs.mkdirSync(prodParent, { recursive: true });
                    }

                    if (fs.existsSync(item.backupFilePath)) {
                        fs.copyFileSync(item.backupFilePath, prodPath);
                        restoredCount++;
                        console.log(tr('logs.rollback_manager.log_rollbackmanager_da_khoi_phuc_file_ban_dau', { relativeTargetPath: item.relativeTargetPath }));
                    }
                }
            }

            // 3. Ghi log trạng thái rollback vào transaction audit
            transactionManager.recordRollback(transactionData, errorReason);
            console.log(tr('logs.rollback_manager.log_rollbackmanager_rollback_hoan_tat_thanh_cong_production'));

            return {
                success: true,
                restoredCount,
                removedCount,
                transactionId: transactionData.transactionId
            };
        } catch (rollbackErr) {
            console.error(tr('logs.rollback_manager.error_rollbackmanager_loi_nghiem_trong_trong_khi_rollback'), rollbackErr);
            transactionManager.recordRollback(transactionData, `Rollback failed: ${rollbackErr.message}`);
            throw rollbackErr;
        }
    }
}

export default new RollbackManager();
