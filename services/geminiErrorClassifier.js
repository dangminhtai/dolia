const CATEGORIES = Object.freeze({
    RATE_LIMIT: 'RATE_LIMIT',
    SERVICE_OVERLOADED: 'SERVICE_OVERLOADED',
    INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
    TIMEOUT: 'TIMEOUT',
    NETWORK_ERROR: 'NETWORK_ERROR',
    INVALID_REQUEST: 'INVALID_REQUEST',
    AUTH_INVALID: 'AUTH_INVALID',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
    APPLICATION_ERROR: 'APPLICATION_ERROR',
    UNKNOWN: 'UNKNOWN'
});

function numericStatus(error) {
    const values = [
        error?.statusCode,
        error?.status,
        error?.httpMeta?.response?.status,
        error?.error?.code,
        error?.cause?.status,
        error?.cause?.statusCode
    ];
    for (const value of values) {
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) return parsed;
    }
    return 0;
}

function messageOf(error) {
    return [error?.message, error?.error?.message, error?.cause?.message, error?.status]
        .filter(Boolean).join(' ').trim();
}

function parseDuration(value) {
    if (value == null) return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
    if (typeof value === 'object') {
        const seconds = Number(value.seconds || 0);
        const nanos = Number(value.nanos || 0);
        return Math.max(0, seconds * 1000 + nanos / 1e6);
    }
    const match = String(value).trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/i);
    if (!match) return 0;
    const number = Number(match[1]);
    const unit = (match[2] || 's').toLowerCase();
    if (unit === 'ms') return number;
    if (unit === 'm') return number * 60000;
    return number * 1000;
}

export function extractRetryAfterMs(error) {
    const details = error?.error?.details || error?.details || [];
    for (const detail of Array.isArray(details) ? details : []) {
        if (String(detail?.['@type'] || detail?.type || '').includes('RetryInfo')) {
            const parsed = parseDuration(detail.retryDelay || detail.retry_delay);
            if (parsed > 0) return Math.ceil(parsed);
        }
    }
    const headers = error?.httpMeta?.response?.headers || error?.response?.headers;
    const retryAfter = headers?.get?.('retry-after') ?? headers?.['retry-after'];
    const parsedHeader = parseDuration(retryAfter);
    return parsedHeader > 0 ? Math.ceil(parsedHeader) : 0;
}

function result(category, scope, retryable, statusCode, reason, error) {
    return {
        category,
        scope,
        retryable,
        statusCode,
        retryAfterMs: extractRetryAfterMs(error),
        reason,
        rawCode: error?.error?.status || error?.code || error?.name || ''
    };
}

export function classifyGeminiError(error) {
    const statusCode = numericStatus(error);
    const message = messageOf(error);
    const lower = message.toLowerCase();

    if (error?.classification?.category) return error.classification;
    if (error instanceof SyntaxError || error instanceof ReferenceError) {
        return result(CATEGORIES.APPLICATION_ERROR, 'APPLICATION', false, statusCode, 'LOCAL_CODE_ERROR', error);
    }
    if (error?._isTimeout || error?.name === 'AbortError' || /requesttimeouterror|timed?\s*out|timeout/.test(lower)) {
        return result(CATEGORIES.TIMEOUT, 'HOST', true, statusCode, 'REQUEST_TIMEOUT', error);
    }
    if (/econnreset|econnrefused|enotfound|eai_again|socket|network|fetch failed|dns/.test(lower)) {
        return result(CATEGORIES.NETWORK_ERROR, 'HOST', true, statusCode, 'NETWORK_FAILURE', error);
    }
    if (statusCode === 429 || /resource_exhausted|quota|rate.?limit|too many requests/.test(lower)) {
        return result(CATEGORIES.RATE_LIMIT, 'PROJECT_MODEL', true, 429, 'RESOURCE_EXHAUSTED', error);
    }
    if (statusCode === 503 || /service unavailable|overloaded|high demand|\bunavailable\b/.test(lower)) {
        return result(CATEGORIES.SERVICE_OVERLOADED, 'MODEL', true, 503, 'SERVICE_UNAVAILABLE', error);
    }
    if ([500, 502, 504].includes(statusCode) || /internal server error|\binternal\b/.test(lower)) {
        return result(CATEGORIES.INTERNAL_SERVER_ERROR, 'PROJECT_MODEL', true, statusCode || 500, 'SERVER_ERROR', error);
    }
    if (statusCode === 400 || /invalid_argument|bad request|invalid request|payload|tool schema/.test(lower)) {
        return result(CATEGORIES.INVALID_REQUEST, 'REQUEST', false, statusCode || 400, 'INVALID_ARGUMENT', error);
    }
    if (statusCode === 404 || /model.+not found|not_found/.test(lower)) {
        return result(CATEGORIES.MODEL_NOT_FOUND, 'MODEL', false, statusCode || 404, 'MODEL_NOT_FOUND', error);
    }
    if (statusCode === 401 || /api_key_invalid|invalid api key|credential.+invalid|key.+revoked|key.+disabled/.test(lower)) {
        return result(CATEGORIES.AUTH_INVALID, 'KEY', false, statusCode || 401, 'CREDENTIAL_INVALID', error);
    }
    if (statusCode === 403 || /permission_denied|permission denied|forbidden|billing|restriction/.test(lower)) {
        const credentialInvalid = /api_key_invalid|invalid api key|key.+revoked|key.+disabled|reported as leaked/.test(lower);
        return credentialInvalid
            ? result(CATEGORIES.AUTH_INVALID, 'KEY', false, statusCode || 403, 'CREDENTIAL_INVALID', error)
            : result(CATEGORIES.PERMISSION_DENIED, 'PROJECT', false, statusCode || 403, 'PROJECT_PERMISSION_DENIED', error);
    }
    if (error instanceof TypeError) {
        return result(CATEGORIES.APPLICATION_ERROR, 'APPLICATION', false, statusCode, 'LOCAL_TYPE_ERROR', error);
    }

    const looksRemote = Boolean(statusCode || error?.httpMeta || error?.error?.status || /google(genai)?|gemini/.test(lower));
    return looksRemote
        ? result(CATEGORIES.UNKNOWN, 'UNKNOWN', false, statusCode, 'UNCLASSIFIED_REMOTE_ERROR', error)
        : result(CATEGORIES.APPLICATION_ERROR, 'APPLICATION', false, statusCode, 'LOCAL_APPLICATION_ERROR', error);
}

export function attachGeminiClassification(error, classification = classifyGeminiError(error)) {
    const target = error instanceof Error ? error : new Error(String(error || classification.reason));
    target.classification = classification;
    return target;
}

export function shouldStopModelFallback(classification) {
    if (!classification || classification.retryable) return false;
    return classification.scope !== 'MODEL';
}

export { CATEGORIES };
