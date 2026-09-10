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
        this.cachedModelId = null;
        this.lastCacheTime = 0;
        this.cacheTTL = 10 * 60 * 1000; // Cache 10 phút để giảm tải DB
        this.syncInterval = null;
        this.isSyncing = false;
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
                this.cachedModelId = null;
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
     * Ưu tiên 1: flash-lite có phiên bản cao nhất
     * Ưu tiên 2: flash có phiên bản cao nhất
     * @param {'flash-lite' | 'flash'} preferType
     * @returns {Promise<string>}
     */
    async getActiveModel(preferType = 'flash-lite') {
        const now = Date.now();
        if (this.cachedModelId && (now - this.lastCacheTime < this.cacheTTL)) {
            return this.cachedModelId;
        }

        try {
            // 1. Ưu tiên tìm flash-lite phiên bản cao nhất
            let bestModel = await GeminiModel.findOne({ isActive: true, type: 'flash-lite' })
                .sort({ versionMajor: -1, versionMinor: -1, versionPatch: -1 });

            // 2. Nếu không có flash-lite, tìm flash phiên bản cao nhất
            if (!bestModel) {
                bestModel = await GeminiModel.findOne({ isActive: true, type: 'flash' })
                    .sort({ versionMajor: -1, versionMinor: -1, versionPatch: -1 });
            }

            // 3. Nếu Database chưa có dữ liệu, kích hoạt đồng bộ ngay
            if (!bestModel) {
                Logger.warn('[GeminiModelService] Chưa có dữ liệu model trong Database, kích hoạt đồng bộ...');
                await this.syncModelsFromAPI();

                // Thử lại sau khi đồng bộ
                bestModel = await GeminiModel.findOne({ isActive: true, type: 'flash-lite' })
                    .sort({ versionMajor: -1, versionMinor: -1, versionPatch: -1 });

                if (!bestModel) {
                    bestModel = await GeminiModel.findOne({ isActive: true, type: 'flash' })
                        .sort({ versionMajor: -1, versionMinor: -1, versionPatch: -1 });
                }
            }

            if (bestModel) {
                this.cachedModelId = bestModel.modelId;
                this.lastCacheTime = now;
                return bestModel.modelId;
            }
        } catch (dbError) {
            Logger.error(`[GeminiModelService] Lỗi truy vấn Database: ${dbError.message}`);
        }

        // Tận dụng cache gần nhất trong RAM nếu có
        if (this.cachedModelId) {
            return this.cachedModelId;
        }

        throw new Error('[GeminiModelService] Không tìm thấy bất kỳ model Gemini nào từ Database hoặc Google API.');
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
