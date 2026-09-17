import { t as tr } from '../../services/i18nService.js';
import fs from 'fs';
import path from 'path';

/**
 * TransactionManager - Quản lý Giao Dịch và Snapshot Backup
 * Lưu trữ audit trail vĩnh viễn trong .apply/apply-YYYYMMDD-XXX/
 */
export class TransactionManager {
    constructor() {
        this.applyRoot = path.resolve(process.cwd(), '.apply');
        this.init();
    }

    init() {
        if (!fs.existsSync(this.applyRoot)) {
            fs.mkdirSync(this.applyRoot, { recursive: true });
        }
    }

    /**
     * Sinh mã Transaction ID duy nhất theo thời gian thực: apply-YYYYMMDD-HHmmss-XXX
     */
    generateTransactionId() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const rand = Math.floor(100 + Math.random() * 900);
        return `apply-${y}${m}${d}-${hh}${mm}${ss}-${rand}`;
    }

    /**
     * Bắt đầu một phiên giao dịch mới, tạo thư mục backup và lưu manifest
     */
    beginTransaction(manifest, meta = {}) {
        const transactionId = this.generateTransactionId();
        const txDir = path.join(this.applyRoot, transactionId);
        const backupDir = path.join(txDir, 'backup');

        fs.mkdirSync(backupDir, { recursive: true });

        // Lưu bản snapshot manifest vào thư mục transaction
        fs.writeFileSync(
            path.join(txDir, 'manifest.json'),
            JSON.stringify(manifest, null, 2),
            'utf-8'
        );

        const transactionData = {
            transactionId,
            txDir,
            backupDir,
            status: 'IN_PROGRESS',
            startedAt: new Date().toISOString(),
            approvedBy: meta.approvedBy || 'Owner',
            summary: manifest.summary || '',
            backedUpFiles: [],
            createdFiles: [],
            modifiedFiles: [],
            deletedFiles: []
        };

        this.saveResult(transactionData);
        return transactionData;
    }

    /**
     * Sao lưu một file production hiện có trước khi bị ghi đè hoặc xóa
     */
    backupProductionFile(transactionData, relativeTargetPath) {
        const prodPath = path.resolve(process.cwd(), relativeTargetPath);
        if (!fs.existsSync(prodPath)) {
            return null; // File chưa tồn tại (trường hợp create mới)
        }

        const backupFilePath = path.join(transactionData.backupDir, relativeTargetPath);
        const backupFileParent = path.dirname(backupFilePath);

        if (!fs.existsSync(backupFileParent)) {
            fs.mkdirSync(backupFileParent, { recursive: true });
        }

        fs.copyFileSync(prodPath, backupFilePath);
        transactionData.backedUpFiles.push({
            relativeTargetPath,
            backupFilePath
        });

        return backupFilePath;
    }

    /**
     * Hoàn tất giao dịch thành công (COMMIT)
     */
    commitTransaction(transactionData, resultDetails = {}) {
        transactionData.status = 'COMMITTED';
        transactionData.completedAt = new Date().toISOString();
        transactionData.result = resultDetails;
        this.saveResult(transactionData);
        return transactionData;
    }

    /**
     * Ghi nhận giao dịch bị Rollback
     */
    recordRollback(transactionData, errorReason) {
        transactionData.status = 'ROLLED_BACK';
        transactionData.failedAt = new Date().toISOString();
        transactionData.error = errorReason;
        this.saveResult(transactionData);
        return transactionData;
    }

    /**
     * Lưu kết quả phiên giao dịch vào result.json để audit vĩnh viễn
     */
    saveResult(transactionData) {
        try {
            const resultPath = path.join(transactionData.txDir, 'result.json');
            fs.writeFileSync(resultPath, JSON.stringify(transactionData, null, 2), 'utf-8');
        } catch (e) {
            console.error(tr('logs.transaction_manager.error_transactionmanager_failed_to_save_result_json'), e);
        }
    }

    /**
     * Tra cứu thông tin một transaction trong quá khứ
     */
    getTransaction(transactionId) {
        const txDir = path.join(this.applyRoot, transactionId);
        const resultPath = path.join(txDir, 'result.json');
        if (fs.existsSync(resultPath)) {
            return JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
        }
        return null;
    }
}

export default new TransactionManager();
