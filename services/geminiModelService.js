import { t as tr } from './i18nService.js';
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
        // In-memory mirror of DB blocks (sync mỗi 30s hoặc on-demand)
        this.blockCache = new Map(); // modelId -> { until: Date, reason: string } (chat / transient)
        this.agentBlockCache = new Map(); // modelId -> { until: Date, reason: string } (agent pipeline)
        this.lastBlockSync = 0;
        this.blockSyncInterval = 30 * 1000; // 30s
    }

    /**
     * Sync trạng thái block từ MongoDB vào in-memory cache
     */
    async syncBlockCache() {
        try {
            const now = new Date();
            const blockedModels = await GeminiModel.find({
                isActive: true,
                $or: [
                    { blockedUntil: { $ne: null } },
                    { agentBlockedUntil: { $ne: null } }
                ]
            }).select('modelId blockedUntil blockReason agentBlockedUntil agentBlockReason').lean();

            this.blockCache.clear();
            this.agentBlockCache.clear();

            for (const m of blockedModels) {
                // 1. Transient Chat Block
                if (m.blockedUntil && m.blockedUntil > now) {
                    this.blockCache.set(m.modelId, {
                        until: m.blockedUntil,
                        reason: m.blockReason || 'UNKNOWN'
                    });
                } else if (m.blockedUntil && m.blockedUntil <= now) {
                    // Auto-clear expired blocks (non-blocking)
                    GeminiModel.updateOne(
                        { modelId: m.modelId },
                        { $set: { blockedUntil: null, blockReason: null } }
                    ).exec().catch(e => Logger.warn(tr('logs.geminimodelservice.warn_geminimodelservice_failed_to_auto_clear_expired_block', { message: e.message })));
                }

                // 2. Agent Specific Block (Antigravity & SelfDev)
                if (m.agentBlockedUntil && m.agentBlockedUntil > now) {
                    this.agentBlockCache.set(m.modelId, {
                        until: m.agentBlockedUntil,
                        reason: m.agentBlockReason || 'MANUAL_BLOCK'
                    });
                } else if (m.agentBlockedUntil && m.agentBlockedUntil <= now) {
                    GeminiModel.updateOne(
                        { modelId: m.modelId },
                        { $set: { agentBlockedUntil: null, agentBlockReason: null } }
                    ).exec().catch(e => Logger.warn(tr('logs.geminimodelservice.warn_geminimodelservice_failed_to_auto_clear_expired_agent', { message: e.message })));
                }
            }

            this.lastBlockSync = Date.now();
        } catch (err) {
            Logger.warn(tr('logs.geminimodelservice.warn_geminimodelservice_failed_to_sync_block_cache', { message: err.message }));
        }
    }

    /**
     * Block model RIÊNG CHO AGENT (Antigravity & SelfDev)
     * KHÔNG ẢNH HƯỞNG đến chat bình thường của Dolia!
     */
    async blockAgentModel(modelId, reason = 'MANUAL_BLOCK', cooldownMs = 24 * 60 * 60 * 1000) {
        if (!modelId) return;
        const until = new Date(Date.now() + cooldownMs);

        // 1. Cập nhật cache agent ngay lập tức
        this.agentBlockCache.set(modelId, { until, reason });

        // 2. Xóa model cache để force query lại
        this.cachedModels = {};

        // 3. Persist vào MongoDB
        await GeminiModel.updateOne(
            { modelId },
            { $set: { agentBlockedUntil: until, agentBlockReason: reason } }
        ).exec().catch(e => Logger.warn(tr('logs.geminimodelservice.warn_geminimodelservice_failed_to_persist_agent_block', { message: e.message })));

        Logger.warn(tr('logs.geminimodelservice.warn_geminimodelservice_agent_only_blocked_for_s', { modelId: modelId, value: Math.round(cooldownMs / 1000), reason: reason }));
    }

    /**
     * Unblock model cho AGENT
     */
    async unblockAgentModel(modelId) {
        if (!modelId) return;
        this.agentBlockCache.delete(modelId);
        this.cachedModels = {};

        await GeminiModel.updateOne(
            { modelId },
            { $set: { agentBlockedUntil: null, agentBlockReason: null } }
        ).exec().catch(e => Logger.warn(tr('logs.geminimodelservice.warn_geminimodelservice_failed_to_clear_agent_block', { message: e.message })));

        Logger.info(tr('logs.geminimodelservice.info_geminimodelservice_agent_only_unblocked', { modelId: modelId }));
    }

    /**
     * Kiểm tra model có đang bị block cho AGENT không
     */
    isAgentBlocked(modelId) {
        const cached = this.agentBlockCache.get(modelId);
        if (!cached) return false;

        const now = new Date();
        if (now >= cached.until) {
            this.agentBlockCache.delete(modelId);
            GeminiModel.updateOne(
                { modelId },
                { $set: { agentBlockedUntil: null, agentBlockReason: null } }
            ).exec().catch(() => {});
            return false;
        }
        return true;
    }

    /**
     * Báo cáo model bị lỗi trong chat thường (vd 503 overloaded) → persistent block trong MongoDB
     * Default block 503: 60 phút
     */
    async reportModelFailure(modelId, reason = 'error', cooldownMs = 60 * 60 * 1000) {
        if (!modelId) return;
        const until = new Date(Date.now() + cooldownMs);

        // 1. Cập nhật in-memory cache ngay lập tức
        this.blockCache.set(modelId, { until, reason });

        // 2. Xóa model cache để force re-query
        this.cachedModels = {};

        // 3. Persist vào MongoDB (non-blocking)
        GeminiModel.updateOne(
            { modelId },
            { $set: { blockedUntil: until, blockReason: reason } }
        ).exec().catch(e => Logger.warn(tr('logs.geminimodelservice.warn_geminimodelservice_failed_to_persist_model_block', { message: e.message })));

        Logger.warn(tr('logs.geminimodelservice.warn_geminimodelservice_blocked_for_s_in_mongodb', { modelId: modelId, value: Math.round(cooldownMs / 1000), reason: reason }));
    }

    /**
     * Báo cáo model hoạt động tốt trong chat thường → clear block trong DB + cache
     * CHÚ Ý: KHÔNG clear agentBlockedUntil!
     */
    reportModelSuccess(modelId) {
        if (!modelId) return;
        if (this.blockCache.has(modelId)) {
            this.blockCache.delete(modelId);
            // Non-blocking DB clear
            GeminiModel.updateOne(
                { modelId },
                { $set: { blockedUntil: null, blockReason: null } }
            ).exec().catch(e => Logger.warn(tr('logs.geminimodelservice.warn_geminimodelservice_failed_to_clear_model_block', { message: e.message })));
        }
    }

    /**
     * Kiểm tra model có đang bị block chat thường không
     */
    isModelInCooldown(modelId) {
        const cached = this.blockCache.get(modelId);
        if (!cached) return false;

        const now = new Date();
        if (now >= cached.until) {
            this.blockCache.delete(modelId);
            // Auto-clear trong DB (non-blocking)
            GeminiModel.updateOne(
                { modelId },
                { $set: { blockedUntil: null, blockReason: null } }
            ).exec().catch(() => {});
            return false;
        }
        return true;
    }

    /**
     * Lấy danh sách model ứng viên từ Database, ưu tiên theo preferType:
     * - primary models (không block)
     * - secondary models (không block)
     * - primary models (đang block, nhưng sắp hết)
     * - secondary models (đang block)
     * @param {'flash' | 'flash-lite'} preferType
     * @param {'chat' | 'agent'} scope - Phạm vi: 'chat' (bình thường, không bị block bởi /block-agent) hoặc 'agent' (Antigravity/SelfDev)
     * @returns {Promise<string[]>}
     */
    async getCandidateModels(preferType = 'flash-lite', scope = 'chat') {
        // Sync block cache nếu quá hạn
        if (Date.now() - this.lastBlockSync > this.blockSyncInterval) {
            await this.syncBlockCache();
        }

        const primaryType = preferType === 'flash' ? 'flash' : 'flash-lite';
        const secondaryType = preferType === 'flash' ? 'flash-lite' : 'flash';

        try {
            const now = new Date();

            // Nếu scope là agent: chỉ lọc theo agentBlockedUntil
            // Nếu scope là chat: chỉ lọc theo blockedUntil (hoàn toàn bỏ qua agentBlockedUntil!)
            const blockCondition = scope === 'agent'
                ? {
                    $or: [
                        { agentBlockedUntil: null },
                        { agentBlockedUntil: { $lte: now } }
                    ]
                }
                : {
                    $or: [
                        { blockedUntil: null },
                        { blockedUntil: { $lte: now } }
                    ]
                };

            // Query tất cả model active, ưu tiên model không bị block
            const primaryList = await GeminiModel.find({
                isActive: true,
                type: primaryType,
                ...blockCondition
            })
                .sort({ versionMajor: -1, versionMinor: -1, versionPatch: -1 })
                .select('modelId')
                .lean();

            const secondaryList = await GeminiModel.find({
                isActive: true,
                type: secondaryType,
                ...blockCondition
            })
                .sort({ versionMajor: -1, versionMinor: -1, versionPatch: -1 })
                .select('modelId')
                .lean();

            // Fallback: model đang bị block (chỉ dùng nếu tất cả model đều bị block)
            const fallbackBlockField = scope === 'agent' ? 'agentBlockedUntil' : 'blockedUntil';
            const blockedPrimary = await GeminiModel.find({
                isActive: true,
                type: primaryType,
                [fallbackBlockField]: { $gt: now }
            })
                .sort({ [fallbackBlockField]: 1 }) // Sắp xếp theo thời gian hết block sớm nhất
                .select('modelId')
                .lean();

            const blockedSecondary = await GeminiModel.find({
                isActive: true,
                type: secondaryType,
                [fallbackBlockField]: { $gt: now }
            })
                .sort({ [fallbackBlockField]: 1 })
                .select('modelId')
                .lean();

            const ordered = [
                ...primaryList.map(m => m.modelId),
                ...secondaryList.map(m => m.modelId),
                ...blockedPrimary.map(m => m.modelId),
                ...blockedSecondary.map(m => m.modelId)
            ];

            if (ordered.length > 0) {
                return ordered;
            }
        } catch (dbError) {
            Logger.error(tr('logs.geminimodelservice.error_geminimodelservice_loi_truy_van_candidate_models', { message: dbError.message }));
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
            Logger.info(tr('logs.geminimodelservice.info_geminimodelservice_dang_quet_danh_sach_model_tu'));

            const validModels = await ApiKeyManager.execute('model-sync', async (key) => {
                const ai = ApiKeyManager.getClient(key);
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
                // Upsert vào MongoDB (không ghi đè blockedUntil/blockReason nếu đang block)
                for (const modelData of validModels) {
                    await GeminiModel.findOneAndUpdate(
                        { modelId: modelData.modelId },
                        {
                            $set: {
                                version: modelData.version,
                                versionMajor: modelData.versionMajor,
                                versionMinor: modelData.versionMinor,
                                versionPatch: modelData.versionPatch,
                                type: modelData.type,
                                displayName: modelData.displayName,
                                isActive: modelData.isActive,
                                lastSyncedAt: modelData.lastSyncedAt
                            }
                        },
                        { upsert: true, new: true }
                    );
                }

                Logger.info(tr('logs.geminimodelservice.info_geminimodelservice_da_luu_model_hop_le_vao', { length: validModels.length, value: validModels.map(m => m.modelId).join(', ') }));
                // Làm mới cache bộ nhớ
                this.cachedModels = {};
            } else {
                Logger.warn(tr('logs.geminimodelservice.warn_geminimodelservice_khong_tim_thay_model_nao_khop'));
            }
        } catch (error) {
            Logger.error(tr('logs.geminimodelservice.error_geminimodelservice_loi_khi_dong_bo_danh_sach', { message: error.message }));
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Lấy model tốt nhất từ Database theo quy tắc:
     * - Nếu preferType === 'flash': Ưu tiên flash cao nhất (khả dụng) -> fallback flash-lite cao nhất
     * - Nếu preferType === 'flash-lite': Ưu tiên flash-lite cao nhất (khả dụng) -> fallback flash cao nhất
     * @param {'flash' | 'flash-lite'} preferType
     * @param {'chat' | 'agent'} scope - Phạm vi: 'chat' (mặc định) hoặc 'agent'
     * @returns {Promise<string>}
     */
    async getActiveModel(preferType = 'flash-lite', scope = 'chat') {
        const cacheKey = `${preferType}_${scope}`;
        const now = Date.now();
        if (!this.cachedModels) this.cachedModels = {};
        if (this.cachedModels[cacheKey] && (now - (this.lastCacheTime || 0) < this.cacheTTL)) {
            const cached = this.cachedModels[cacheKey];
            const isBlocked = scope === 'agent' ? this.isAgentBlocked(cached) : this.isModelInCooldown(cached);
            if (!isBlocked) {
                return cached;
            }
        }

        const candidates = await this.getCandidateModels(preferType, scope);
        if (candidates && candidates.length > 0) {
            // Chọn model đầu tiên không bị block trong scope tương ứng
            const best = candidates.find(m => scope === 'agent' ? !this.isAgentBlocked(m) : !this.isModelInCooldown(m)) || candidates[0];
            this.cachedModels[cacheKey] = best;
            this.lastCacheTime = now;
            return best;
        }

        return preferType === 'flash' ? 'gemini-2.5-flash' : 'gemini-2.5-flash-lite';
    }

    /**
     * Khởi tạo service khi bot bật
     */
    async init() {
        // Boot-time recovery: load trạng thái block từ DB
        await this.syncBlockCache();
        const chatBlockedCount = this.blockCache.size;
        const agentBlockedCount = this.agentBlockCache.size;

        if (chatBlockedCount > 0) {
            const blockedList = [...this.blockCache.entries()]
                .map(([id, b]) => `${id} (${b.reason}, hết: ${b.until.toLocaleTimeString()})`)
                .join(', ');
            Logger.warn(tr('logs.geminimodelservice.warn_geminimodelservice_boot_recovery_chat_model_s_dang', { chatBlockedCount: chatBlockedCount, blockedList: blockedList }));
        }

        if (agentBlockedCount > 0) {
            const blockedList = [...this.agentBlockCache.entries()]
                .map(([id, b]) => `${id} (${b.reason}, hết: ${b.until.toLocaleTimeString()})`)
                .join(', ');
            Logger.warn(tr('logs.geminimodelservice.warn_geminimodelservice_boot_recovery_agent_only_model_s', { agentBlockedCount: agentBlockedCount, blockedList: blockedList }));
        }

        // Đồng bộ ngay khi khởi động
        await this.syncModelsFromAPI();

        // Đặt lịch tự động đồng bộ lại mỗi 6 giờ
        if (this.syncInterval) clearInterval(this.syncInterval);
        this.syncInterval = setInterval(() => {
            this.syncModelsFromAPI().catch(err => {
                Logger.error(tr('logs.geminimodelservice.error_geminimodelservice_dinh_ky_dong_bo_that_bai', { message: err.message }));
            });
        }, 6 * 60 * 60 * 1000);
    }
}

export default new GeminiModelService();

