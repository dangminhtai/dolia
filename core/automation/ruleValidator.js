import crypto from 'node:crypto';
import { t } from '../../services/i18nService.js';

export const EVENT_TRIGGERS = new Set(['messageCreate', 'guildMemberAdd', 'autoModerationActionExecution']);
export const SCHEDULE_TRIGGERS = new Set(['daily_at', 'daily_window', 'once']);
export const ACTION_CAPABILITIES = Object.freeze({
    react: 'discord.react',
    send_message: 'discord.send_message',
    send_dm: 'discord.dm',
    warn: 'discord.warn',
    timeout: 'discord.timeout',
    kick: 'discord.kick',
    research_web: 'web.research',
    filter: 'workflow.filter',
    branch: 'workflow.branch',
    delay_until: 'workflow.delay',
    update_state: 'workflow.state'
});

const HIGH_RISK = new Set(['timeout', 'kick']);
const MAX_STEPS = 20;

export class AutomationValidationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'AutomationValidationError';
        this.code = code;
    }
}

const fail = (code, fallback) => {
    const localized = t(`automation.validation.${code}`);
    throw new AutomationValidationError(code, localized === `automation.validation.${code}` ? fallback : localized);
};
const text = (value, max = 500) => String(value || '').normalize('NFKC').trim().slice(0, max);

export function assertTimezone(timezone) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    } catch {
        fail('INVALID_TIMEZONE', 'Múi giờ IANA không hợp lệ.');
    }
}

function normalizeTrigger(value = {}) {
    const type = text(value.type, 40);
    if (!EVENT_TRIGGERS.has(type) && !SCHEDULE_TRIGGERS.has(type)) {
        fail('INVALID_TRIGGER', 'Loại trigger chưa được hỗ trợ.');
    }
    const config = structuredClone(value.config || {});
    if (type === 'daily_at') {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.time || '')) fail('INVALID_TIME', 'daily_at cần giờ dạng HH:mm.');
    }
    if (type === 'daily_window') {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.start || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(config.end || '')) {
            fail('INVALID_WINDOW', 'daily_window cần start/end dạng HH:mm.');
        }
    }
    if (type === 'once' && !Number.isFinite(Date.parse(config.at || ''))) fail('INVALID_ONCE', 'once cần thời điểm ISO hợp lệ.');
    return { type, config };
}

function normalizeStep(step, index) {
    const kind = text(step?.kind || step?.op, 40);
    if (!ACTION_CAPABILITIES[kind]) fail('INVALID_STEP', `Bước ${index + 1} chưa được hỗ trợ.`);
    const normalized = structuredClone(step);
    normalized.kind = kind;
    normalized.stepId = text(step.stepId, 50) || `step_${index + 1}`;
    delete normalized.op;
    if (kind === 'react') {
        normalized.emoji = text(step.emoji, 30);
        if (!normalized.emoji) fail('INVALID_EMOJI', 'Reaction cần emoji.');
    }
    if ((kind === 'send_message' || kind === 'send_dm' || kind === 'warn') && !text(step.content || step.template, 1900)) {
        fail('MISSING_CONTENT', `${kind} cần nội dung hoặc template.`);
    }
    if (kind === 'timeout') {
        normalized.durationMinutes = Math.max(1, Math.min(Number(step.durationMinutes) || 10, 10080));
    }
    if (kind === 'research_web') {
        normalized.query = text(step.query, 300);
        if (!normalized.query) fail('MISSING_QUERY', 'research_web cần truy vấn.');
    }
    if (kind === 'delay_until' && !step.at && !Number.isFinite(Number(step.delaySeconds))) {
        fail('INVALID_DELAY', 'delay_until cần at hoặc delaySeconds.');
    }
    if (kind === 'filter' || kind === 'branch') {
        normalized.field = text(step.field, 80);
        normalized.operator = ['equals', 'not_equals', 'includes'].includes(step.operator) ? step.operator : 'equals';
        normalized.value = text(step.value, 300);
        if (!['event.type', 'event.actorId', 'event.subjectId', 'event.channelId'].includes(normalized.field)) {
            fail('INVALID_WORKFLOW_FIELD', `${kind} chỉ được đọc trường event đã cho phép.`);
        }
        if (kind === 'branch') {
            normalized.skipIfTrue = Math.max(0, Math.min(Number(step.skipIfTrue) || 0, MAX_STEPS));
            normalized.skipIfFalse = Math.max(0, Math.min(Number(step.skipIfFalse) || 0, MAX_STEPS));
        }
    }
    if (kind === 'update_state') {
        normalized.key = text(step.key, 80);
        normalized.value = text(step.value, 1000);
        if (!normalized.key || !/^[a-zA-Z0-9_.-]+$/.test(normalized.key)) fail('INVALID_STATE_KEY', 'Khóa state không hợp lệ.');
    }
    return normalized;
}

export function validateAutomationSpec(input, { forUpdate = false } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_SPEC', 'Automation spec phải là object.');
    const type = text(input.type, 20) || 'configured';
    if (!['configured', 'workflow', 'generated'].includes(type)) fail('INVALID_TYPE', 'Loại automation không hợp lệ.');
    const timezone = text(input.timezone, 80) || 'Asia/Ho_Chi_Minh';
    assertTimezone(timezone);
    const steps = (input.steps || input.actions || []).map(normalizeStep);
    if (steps.length === 0 && type !== 'generated') fail('MISSING_STEPS', 'Automation cần ít nhất một hành động.');
    if (steps.length > MAX_STEPS) fail('TOO_MANY_STEPS', `Automation chỉ được tối đa ${MAX_STEPS} bước.`);
    const trigger = normalizeTrigger(input.trigger || {});
    const capabilityGrants = [...new Set(steps.map(step => ACTION_CAPABILITIES[step.kind]))];
    const conditions = Array.isArray(input.conditions) ? structuredClone(input.conditions.slice(0, 20)) : [];
    for (const condition of conditions) {
        if (!['author_is', 'channel_is', 'contains', 'member_not_bot', 'member_not_welcomed', 'spam_threshold'].includes(condition?.kind)) {
            fail('INVALID_CONDITION', 'Điều kiện automation chưa được hỗ trợ.');
        }
        if (condition.kind === 'spam_threshold') {
            condition.count = Number(condition.count);
            condition.windowSeconds = Number(condition.windowSeconds);
            if (!Number.isInteger(condition.count) || condition.count < 2 || condition.count > 50
                || !Number.isFinite(condition.windowSeconds) || condition.windowSeconds < 2 || condition.windowSeconds > 300) {
                fail('INVALID_SPAM_THRESHOLD', 'Chống spam cần count 2-50 và windowSeconds 2-300.');
            }
        }
    }
    if (trigger.type === 'messageCreate' && steps.some(step => HIGH_RISK.has(step.kind))
        && !conditions.some(condition => condition.kind === 'spam_threshold')) {
        fail('SPAM_THRESHOLD_REQUIRED', 'Moderation từ messageCreate cần ngưỡng spam rõ ràng.');
    }
    const hasHighRisk = steps.some(step => HIGH_RISK.has(step.kind));
    const risk = type === 'generated' ? 'generated' : hasHighRisk ? 'high' : steps.some(step => step.kind === 'research_web') ? 'medium' : 'low';
    return {
        name: text(input.name, 100) || (forUpdate ? undefined : 'Automation mới'),
        description: text(input.description, 500), type, trigger,
        conditions,
        steps, capabilityGrants, timezone, risk,
        channelId: text(input.channelId || input.channel_id, 30) || null,
        schedule: {
            missedRunPolicy: ['skip', 'run_if_within_grace', 'run_once_on_recovery'].includes(input.schedule?.missedRunPolicy)
                ? input.schedule.missedRunPolicy : 'skip',
            graceMinutes: Math.max(0, Math.min(Number(input.schedule?.graceMinutes) || 60, 1440))
        },
        limits: {
            maxRuns: input.limits?.maxRuns == null ? null : Math.max(1, Math.min(Number(input.limits.maxRuns) || 1, 100000)),
            cooldownSeconds: Math.max(0, Math.min(
                input.limits?.cooldownSeconds == null ? (hasHighRisk ? 300 : 0) : Number(input.limits.cooldownSeconds) || 0,
                86400
            ))
        },
        retryPolicy: {
            maxAttempts: Math.max(1, Math.min(Number(input.retryPolicy?.maxAttempts) || 1, 3)),
            backoffMs: Math.max(0, Math.min(Number(input.retryPolicy?.backoffMs) || 1000, 30000))
        }
    };
}

export function createRuleId() {
    return `aut_${crypto.randomBytes(6).toString('hex')}`;
}

export function isDestructiveRule(rule) {
    return rule?.risk === 'high' || (rule?.steps || []).some(step => HIGH_RISK.has(step.kind));
}
