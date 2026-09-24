import ApiKeyManager from '../class/apiKeyManager.js';
import Logger from '../class/Logger.js';
import geminiModelService from './geminiModelService.js';
import { classifyGeminiError, shouldStopModelFallback } from './geminiErrorClassifier.js';
import { t } from './i18nService.js';

export async function researchWeb(query, { maxSources = 5, lookbackHours = null, maxAttempts = 3, modelScope = 'chat' } = {}) {
    const cleanQuery = String(query || '').normalize('NFKC').trim().slice(0, 300);
    if (!cleanQuery) throw Object.assign(new Error('RESEARCH_QUERY_REQUIRED'), { code: 'RESEARCH_QUERY_REQUIRED' });
    const freshness = Number.isFinite(Number(lookbackHours))
        ? `Chỉ ưu tiên nguồn được xuất bản trong ${Math.max(1, Math.min(Number(lookbackHours), 720))} giờ gần đây; nêu rõ nếu không xác minh được ngày.`
        : 'Ưu tiên nguồn có ngày xuất bản rõ ràng.';
    const candidateModels = await geminiModelService.getCandidateModels('flash-lite', modelScope === 'agent' ? 'agent' : 'chat');
    const attemptLimit = Math.max(1, Math.min(Number(maxAttempts) || 1, 3));
    const budget = ApiKeyManager.createBudget(attemptLimit);
    let response = null;
    let lastError = null;
    try {
        for (let index = 0; index < candidateModels.length && index < 2 && budget.used < budget.max; index++) {
            const modelId = candidateModels[index];
            if (index > 0) ApiKeyManager.recordModelSwitch(budget);
            try {
                response = await ApiKeyManager.execute(modelId, async (key, requestContext) => {
                    const ai = ApiKeyManager.getClient(key);
                    return ai.models.generateContent({
                        model: modelId,
                        contents: `Tra cứu Google cho chủ đề sau: "${cleanQuery}". ${freshness}\nTóm tắt ngắn, không bịa dữ kiện, kèm mốc thời gian và chỉ dựa trên nguồn tìm được.`,
                        config: ApiKeyManager.requestConfig({ tools: [{ googleSearch: {} }], temperature: 0.2 }, requestContext)
                    });
                }, { timeoutMs: 30000, maxAttempts: attemptLimit, budget });
                if (response) break;
            } catch (error) {
                lastError = error;
                const classification = classifyGeminiError(error);
                if (shouldStopModelFallback(classification)) throw error;
                Logger.warn(t('automation.logs.research_model_failed', { modelId, message: error.message }));
            }
        }
        if (!response) throw lastError || Object.assign(new Error('NO_RESEARCH_MODEL'), { code: 'NO_RESEARCH_MODEL' });
        const grounding = response.candidates?.[0]?.groundingMetadata;
        const sources = (grounding?.groundingChunks || []).map(chunk => ({
            title: String(chunk.web?.title || '').trim(),
            uri: String(chunk.web?.uri || '').trim()
        })).filter(source => source.uri).slice(0, Math.max(1, Math.min(Number(maxSources) || 5, 10)));
        return {
            query: cleanQuery,
            summary: String(response.text || '').trim(),
            searchQueries: grounding?.webSearchQueries || [],
            sources,
            researchedAt: new Date().toISOString()
        };
    } finally {
        ApiKeyManager.completeBudget(budget, Boolean(response));
    }
}

export function formatResearchDigest(result) {
    const summary = String(result?.summary || '').trim();
    if (!summary) throw Object.assign(new Error('RESEARCH_EMPTY'), { code: 'RESEARCH_EMPTY' });
    const sources = (result.sources || []).slice(0, 5).map((source, index) =>
        `${index + 1}. [${source.title || 'Nguồn'}](<${source.uri}>)`
    );
    if (sources.length === 0) throw Object.assign(new Error('RESEARCH_SOURCES_MISSING'), { code: 'RESEARCH_SOURCES_MISSING' });
    return `${summary}${sources.length ? `\n\n${t('automation.research.sources')}\n${sources.join('\n')}` : ''}`.slice(0, 2000);
}
