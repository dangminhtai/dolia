import { PermissionFlagsBits } from 'discord.js';
import AutomationExecution from '../models/AutomationExecution.js';
import AutomationRule from '../models/AutomationRule.js';
import { createRuleId, isDestructiveRule, validateAutomationSpec } from '../core/automation/ruleValidator.js';
import { nextScheduleAt } from '../core/automation/schedule.js';
import { isOwner } from './authorizationService.js';
import { runAutomation } from './automationRunner.js';
import { t } from './i18nService.js';

function runtime(args) {
    const message = args.message;
    const interaction = args.interaction;
    const user = args.user || message?.author || interaction?.user;
    const guild = args.guild || message?.guild || interaction?.guild;
    const channel = args.channel || message?.channel || interaction?.channel;
    const member = args.member || message?.member || interaction?.member;
    return { userId: user?.id, guildId: guild?.id || null, channelId: channel?.id || null, member, client: guild?.client || message?.client || interaction?.client };
}

function hasPermission(ctx, permission) {
    return isOwner(ctx.userId) || Boolean(ctx.member?.permissions?.has?.(permission));
}

function personalReaction(spec, ctx) {
    return spec.trigger.type === 'messageCreate' && spec.steps.every(step => step.kind === 'react')
        && Boolean(spec.channelId)
        && spec.conditions.some(condition => condition.kind === 'author_is' && String(condition.userId || ctx.userId) === ctx.userId);
}

function assertManage(spec, ctx, { destructive = false } = {}) {
    if (!ctx.userId || !ctx.guildId) throw Object.assign(new Error(t('automation.errors.guild_required')), { code: 'GUILD_REQUIRED' });
    if (personalReaction(spec, ctx)) return;
    const permission = destructive ? PermissionFlagsBits.Administrator : PermissionFlagsBits.ManageGuild;
    if (!hasPermission(ctx, permission)) throw Object.assign(new Error(t(destructive ? 'automation.errors.admin_required' : 'automation.errors.manage_required')), { code: 'PERMISSION_DENIED' });
}

function visibleFilter(ctx) {
    if (isOwner(ctx.userId) || hasPermission(ctx, PermissionFlagsBits.ManageGuild)) return { guildId: ctx.guildId, status: { $ne: 'deleted' } };
    return { guildId: ctx.guildId, createdBy: ctx.userId, status: { $ne: 'deleted' } };
}

function serialize(rule) {
    return {
        ruleId: rule.ruleId, name: rule.name, description: rule.description, type: rule.type,
        trigger: rule.trigger, conditions: rule.conditions, steps: rule.steps,
        capabilityGrants: rule.capabilityGrants, timezone: rule.timezone,
        scope: rule.scope, retryPolicy: rule.retryPolicy,
        enabled: rule.enabled, status: rule.status, risk: rule.risk, revision: rule.revision,
        channelId: rule.channelId, nextRunAt: rule.schedule?.nextRunAt,
        lastRunAt: rule.lastRunAt, lastErrorCode: rule.lastErrorCode, createdBy: rule.createdBy
    };
}

async function findManageable(ruleId, ctx) {
    const rule = await AutomationRule.findOne({ ruleId, ...visibleFilter(ctx) });
    if (!rule) throw Object.assign(new Error(t('automation.errors.not_found')), { code: 'RULE_NOT_FOUND' });
    return rule;
}

export async function automationQuery(args) {
    const ctx = runtime(args);
    if (!ctx.userId || !ctx.guildId) throw new Error(t('automation.errors.guild_required'));
    const action = args.action || 'list';
    if (action === 'preview') return { reply: t('automation.query.preview'), preview: validateAutomationSpec(args.spec || {}) };
    if (action === 'list') {
        const filter = visibleFilter(ctx);
        if (['personal', 'channel', 'guild'].includes(args.scope)) filter.scope = args.scope;
        const rules = await AutomationRule.find(filter).sort({ updatedAt: -1 }).limit(Math.max(1, Math.min(Number(args.limit) || 20, 50)));
        return { reply: rules.length ? t('automation.query.found', { count: rules.length }) : t('automation.query.empty'), rules: rules.map(serialize) };
    }
    const rule = await findManageable(args.rule_id, ctx);
    if (action === 'get') return { reply: t('automation.query.detail', { name: rule.name }), rule: serialize(rule) };
    if (action === 'history') {
        const history = await AutomationExecution.find({ ruleId: rule.ruleId }).sort({ createdAt: -1 }).limit(Math.max(1, Math.min(Number(args.limit) || 20, 50))).lean();
        return { reply: t('automation.query.history', { count: history.length }), history, revisions: rule.revisionHistory || [] };
    }
    throw new Error(t('automation.errors.invalid_action'));
}

export async function automationAction(args) {
    const ctx = runtime(args);
    const action = args.action;
    if (action === 'draft' || action === 'create') {
        const spec = validateAutomationSpec(args.spec || {});
        if (!spec.channelId && (spec.trigger.type === 'messageCreate' || spec.steps.some(step => step.kind === 'send_message'))) {
            spec.channelId = ctx.channelId;
        }
        assertManage(spec, ctx, { destructive: spec.risk === 'high' });
        const scope = personalReaction(spec, ctx) ? 'personal' : spec.channelId ? 'channel' : 'guild';
        const ruleId = createRuleId();
        const rule = await AutomationRule.create({
            ...spec, ruleId, guildId: ctx.guildId, channelId: spec.channelId, scope,
            createdBy: ctx.userId, enabled: false,
            status: spec.risk === 'high' || spec.type === 'generated' ? 'pending_approval' : 'draft',
            schedule: { ...spec.schedule, nextRunAt: null }
        });
        return { reply: t('automation.action.created', { name: rule.name, id: rule.ruleId }), rule: serialize(rule) };
    }
    const rule = await findManageable(args.rule_id, ctx);
    if (action === 'update') {
        const spec = validateAutomationSpec({ ...rule.toObject(), ...(args.spec || {}) }, { forUpdate: true });
        assertManage(spec, ctx, { destructive: spec.risk === 'high' });
        const snapshot = serialize(rule);
        const scope = personalReaction(spec, ctx) ? 'personal' : spec.channelId ? 'channel' : 'guild';
        Object.assign(rule, spec, { scope, enabled: false, status: spec.risk === 'high' || spec.type === 'generated' ? 'pending_approval' : 'draft', approvedBy: null });
        rule.revisionHistory.push({ revision: rule.revision, changedAt: new Date(), changedBy: ctx.userId, snapshot });
        rule.revision += 1;
        rule.schedule.nextRunAt = null;
        await rule.save();
        return { reply: t('automation.action.updated', { name: rule.name }), rule: serialize(rule) };
    }
    if (action === 'enable') {
        assertManage(rule, ctx, { destructive: isDestructiveRule(rule) });
        if (rule.type === 'generated') throw Object.assign(new Error(t('automation.errors.generated_disabled')), { code: 'GENERATED_RUNTIME_DISABLED' });
        rule.enabled = true;
        rule.status = 'active';
        if (isDestructiveRule(rule)) rule.approvedBy = ctx.userId;
        rule.schedule.nextRunAt = nextScheduleAt(rule, new Date());
        await rule.save();
        return { reply: t('automation.action.enabled', { name: rule.name }), rule: serialize(rule) };
    }
    if (action === 'disable') {
        assertManage(rule, ctx);
        rule.enabled = false; rule.status = 'paused';
        rule.schedule.leaseOwner = null; rule.schedule.leaseExpiresAt = null;
        await rule.save();
        return { reply: t('automation.action.disabled', { name: rule.name }), rule: serialize(rule) };
    }
    if (action === 'delete') {
        assertManage(rule, ctx, { destructive: isDestructiveRule(rule) });
        rule.enabled = false; rule.status = 'deleted'; rule.revision += 1;
        await rule.save();
        return { reply: t('automation.action.deleted', { name: rule.name }) };
    }
    if (action === 'run_once') {
        assertManage(rule, ctx, { destructive: isDestructiveRule(rule) });
        if (rule.type === 'generated') throw new Error(t('automation.errors.generated_disabled'));
        const event = {
            eventId: `manual:${ctx.userId}:${Date.now()}`, type: 'manual', guildId: ctx.guildId,
            channelId: rule.channelId || ctx.channelId, actorId: ctx.userId, subjectId: ctx.userId,
            occurredAt: new Date(), source: 'manual_run', data: {}
        };
        const result = await runAutomation(ctx.client, rule, event, { occurrenceKey: event.eventId });
        return { reply: t('automation.action.ran', { name: rule.name, status: result.status }), result };
    }
    throw new Error(t('automation.errors.invalid_action'));
}
