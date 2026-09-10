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
        console.warn(`[RollbackManager] ⚠️ Đang kích hoạt ROLLBACK cho giao dịch ${transactionData.transactionId}... Lý do: ${errorReason}`);
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
                        console.log(`[RollbackManager] 🗑️ Đã xóa file mới tạo dở dang: ${relativePath}`);
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
                        console.log(`[RollbackManager] 🔄 Đã khôi phục file ban đầu: ${item.relativeTargetPath}`);
                    }
                }
            }

            // 3. Ghi log trạng thái rollback vào transaction audit
            transactionManager.recordRollback(transactionData, errorReason);
            console.log(`[RollbackManager] ✅ Rollback hoàn tất thành công! Production đã quay về trạng thái ban đầu.`);

            return {
                success: true,
                restoredCount,
                removedCount,
                transactionId: transactionData.transactionId
            };
        } catch (rollbackErr) {
            console.error(`[RollbackManager] ❌ LỖI NGHIÊM TRỌNG TRONG KHI ROLLBACK:`, rollbackErr);
            transactionManager.recordRollback(transactionData, `Rollback failed: ${rollbackErr.message}`);
            throw rollbackErr;
        }
    }
}

export default new RollbackManager();
