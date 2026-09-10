import { GoogleGenAI } from '@google/genai';
import ApiKeyManager from '../class/apiKeyManager.js';
import GeminiModel from '../models/GeminiModel.js';
import Logger from '../class/Logger.js';

// Pattern 3 phần theo RULES_DOLIA:
// Phần 1: gemini
// Phần 2: Phiên bản số (vd: 2.5, 3.5, 3.6, 4.0,...)
// Phần 3: flash hoặc flash-lite
export const GEMINI_PATTERN = /^gemini-(\d+(?:\.\d+)*)-(flash(?:-lite)?)$/;

class GeminiModelService {
    constructor() {
        this.cachedModels = {};
        this.lastCacheTime = 0;
        this.cacheTTL = 10 * 60 * 1000; // Cache 10 phút để giảm tải DB
        this.syncInterval = null;
        this.isSyncing = false;
        this.modelCooldowns = new Map(); // modelId -> cooldownUntil (ms)
    }

    /**
     * Báo cáo model bị lỗi (vd 503 overloaded) để tạm thời hạ độ ưu tiên
     */
    reportModelFailure(modelId, reason = 'error', cooldownMs = 3 * 60 * 1000) {
        if (!modelId) return;
        const until = Date.now() + cooldownMs;
        this.modelCooldowns.set(modelId, until);
        if (this.cachedModels) {
            this.cachedModels = {}; // Xóa cache để chọn model khả dụng tiếp theo
        }
        Logger.warn(`[GeminiModelService] ⏳ Tạm đưa ${modelId} vào cooldown ${Math.round(cooldownMs / 1000)}s (${reason})`);
    }

    /**
     * Báo cáo model hoạt động tốt để gỡ cooldown
     */
    reportModelSuccess(modelId) {
        if (!modelId) return;
        if (this.modelCooldowns.has(modelId)) {
            this.modelCooldowns.delete(modelId);
        }
    }

    /**
     * Kiểm tra model có đang trong thời gian cooldown không
     */
    isModelInCooldown(modelId) {
        const until = this.modelCooldowns.get(modelId);
        if (!until) return false;
        if (Date.now() > until) {
            this.modelCooldowns.delete(modelId);
            return false;
        }
        return true;
    }

    /**
     * Lấy danh sách model ứng viên từ Database, ưu tiên theo preferType:
     * - primary models (không cooldown)
     * - secondary models (không cooldown)
     * - primary models (đang cooldown)
     * - secondary models (đang cooldown)
     * @param {'flash' | 'flash-lite'} preferType
     * @returns {Promise<string[]>}
     */
    async getCandidateModels(preferType = 'flash-lite') {
        const primaryType = preferType === 'flash' ? 'flash' : 'flash-lite';
        const secondaryType = preferType === 'flash' ? 'flash-lite' : 'flash';

        try {
            const primaryList = await GeminiModel.find({ isActive: true, type: primaryType })
                .sort({ versionMajor: -1, versionMinor: -1, versionPatch: -1 })
                .select('modelId');

            const secondaryList = await GeminiModel.find({ isActive: true, type: secondaryType })
                .sort({ versionMajor: -1, versionMinor: -1, versionPatch: -1 })
                .select('modelId');

            const allPrimary = primaryList.map(m => m.modelId);
            const allSecondary = secondaryList.map(m => m.modelId);

            const healthyPrimary = allPrimary.filter(m => !this.isModelInCooldown(m));
            const healthySecondary = allSecondary.filter(m => !this.isModelInCooldown(m));
            const cooldownPrimary = allPrimary.filter(m => this.isModelInCooldown(m));
            const cooldownSecondary = allSecondary.filter(m => this.isModelInCooldown(m));

            const ordered = [
                ...healthyPrimary,
                ...healthySecondary,
                ...cooldownPrimary,
                ...cooldownSecondary
            ];

            if (ordered.length > 0) {
                return ordered;
            }
        } catch (dbError) {
            Logger.error(`[GeminiModelService] Lỗi truy vấn candidate models: ${dbError.message}`);
        }

        return preferType === 'flash'
            ? ['gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-2.5-flash-lite']
            : ['gemini-2.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.6-flash'];
    }

    /**
     * Tách phiên bản số thành major, minor, patch
     * @param {string} versionStr 
     */
    parseVersion(versionStr) {
        const parts = versionStr.split('.').map(n => parseInt(n, 10) || 0);
        return {
            major: parts[0] ?? 0,
            minor: parts[1] ?? 0,
            patch: parts[2] ?? 0
        };
    }

    /**
     * Đồng bộ danh sách model từ Google Gemini API vào MongoDB
     */
    async syncModelsFromAPI() {
        if (this.isSyncing) return;
        this.isSyncing = true;

        try {
            Logger.info('[GeminiModelService] Đang quét danh sách model từ Google API...');

            const validModels = await ApiKeyManager.execute('model-sync', async (key) => {
                const ai = new GoogleGenAI({ apiKey: key });
                const matched = [];

                for await (const m of await ai.models.list()) {
                    const rawName = m.name || '';
                    const cleanId = rawName.replace(/^models\//, '');
                    const match = cleanId.match(GEMINI_PATTERN);

                    if (match) {
                        const versionStr = match[1];
                        const typeStr = match[2]; // 'flash' hoặc 'flash-lite'
                        const vParts = this.parseVersion(versionStr);

                        matched.push({
                            modelId: cleanId,
                            version: versionStr,
                            versionMajor: vParts.major,
                            versionMinor: vParts.minor,
                            versionPatch: vParts.patch,
                            type: typeStr,
                            displayName: m.displayName || cleanId,
                            isActive: true,
                            lastSyncedAt: new Date()
                        });
                    }
                }
                return matched;
            });

            if (validModels && validModels.length > 0) {
                // Upsert vào MongoDB
                for (const modelData of validModels) {
                    await GeminiModel.findOneAndUpdate(
                        { modelId: modelData.modelId },
                        { $set: modelData },
                        { upsert: true, new: true }
                    );
                }

                Logger.info(`[GeminiModelService] ✅ Đã lưu ${validModels.length} model hợp lệ vào Database: ${validModels.map(m => m.modelId).join(', ')}`);
                // Làm mới cache bộ nhớ
                this.cachedModels = {};
            } else {
                Logger.warn('[GeminiModelService] Không tìm thấy model nào khớp với pattern.');
            }
        } catch (error) {
            Logger.error(`[GeminiModelService] Lỗi khi đồng bộ danh sách model: ${error.message}`);
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Lấy model tốt nhất từ Database theo quy tắc:
     * - Nếu preferType === 'flash': Ưu tiên flash cao nhất (khả dụng) -> fallback flash-lite cao nhất
     * - Nếu preferType === 'flash-lite': Ưu tiên flash-lite cao nhất (khả dụng) -> fallback flash cao nhất
     * @param {'flash' | 'flash-lite'} preferType
     * @returns {Promise<string>}
     */
    async getActiveModel(preferType = 'flash-lite') {
        const now = Date.now();
        if (!this.cachedModels) this.cachedModels = {};
        if (this.cachedModels[preferType] && (now - (this.lastCacheTime || 0) < this.cacheTTL)) {
            // Kiểm tra xem model trong cache có đang bị cooldown không
            if (!this.isModelInCooldown(this.cachedModels[preferType])) {
                return this.cachedModels[preferType];
            }
        }

        const candidates = await this.getCandidateModels(preferType);
        if (candidates && candidates.length > 0) {
            const best = candidates[0];
            this.cachedModels[preferType] = best;
            this.lastCacheTime = now;
            return best;
        }

        return preferType === 'flash' ? 'gemini-2.5-flash' : 'gemini-2.5-flash-lite';
    }

    /**

     * Khởi tạo service khi bot bật
     */
    async init() {
        // Đồng bộ ngay khi khởi động
        await this.syncModelsFromAPI();

        // Đặt lịch tự động đồng bộ lại mỗi 6 giờ
        if (this.syncInterval) clearInterval(this.syncInterval);
        this.syncInterval = setInterval(() => {
            this.syncModelsFromAPI().catch(err => {
                Logger.error(`[GeminiModelService] Định kỳ đồng bộ thất bại: ${err.message}`);
            });
        }, 6 * 60 * 60 * 1000);
    }
}

export default new GeminiModelService();
