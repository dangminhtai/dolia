import AutomationExecution from '../models/AutomationExecution.js';
import AutomationRule from '../models/AutomationRule.js';
import AutomationState from '../models/AutomationState.js';
import { executeCapability } from './automationCapabilities.js';

const instanceId = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

function errorCode(error) {
    return String(error?.code || error?.name || 'AUTOMATION_FAILED').slice(0, 100);
}

export async function claimExecution(rule, occurrenceKey, event, scheduledFor = null) {
    try {
        return await AutomationExecution.create({
            ruleId: rule.ruleId, ruleRevision: rule.revision, occurrenceKey,
            scheduledFor, eventId: event.eventId, claimedBy: instanceId,
            leaseExpiresAt: new Date(Date.now() + 120000)
        });
    } catch (error) {
        if (error?.code === 11000) return null;
        throw error;
    }
}

function delayDate(step) {
    if (step.at) return new Date(step.at);
    return new Date(Date.now() + Math.max(1, Number(step.delaySeconds) || 1) * 1000);
}

function workflowValue(field, event) {
    if (field === 'event.type') return event.type;
    if (field === 'event.actorId') return event.actorId;
    if (field === 'event.subjectId') return event.subjectId;
    if (field === 'event.channelId') return event.channelId;
    return undefined;
}

function predicate(step, event) {
    const actual = String(workflowValue(step.field, event) ?? '');
    const expected = String(step.value ?? '');
    if (step.operator === 'not_equals') return actual !== expected;
    if (step.operator === 'includes') return actual.includes(expected);
    return actual === expected;
}

export async function runAutomation(client, rule, event, { occurrenceKey, scheduledFor = null, execution = null, startStep = 0, values = {} } = {}) {
    const record = execution || await claimExecution(rule, occurrenceKey, event, scheduledFor);
    if (!record) return { duplicate: true };
    if (rule.type === 'generated') {
        record.status = 'needs_review';
        record.errorCode = 'GENERATED_RUNTIME_DISABLED';
        record.finishedAt = new Date();
        await record.save();
        return { status: record.status, errorCode: record.errorCode };
    }
    record.status = 'running';
    await record.save();
    const context = { client, rule, event, values: structuredClone(values || {}) };
    try {
        for (let index = startStep; index < rule.steps.length; index++) {
            const step = rule.steps[index];
            if (step.kind === 'filter' && !predicate(step, event)) {
                record.status = 'skipped';
                record.errorCode = 'FILTER_NOT_MATCHED';
                record.finishedAt = new Date();
                record.actionReceipts.push({ stepId: step.stepId, status: 'skipped' });
                await record.save();
                return { status: 'skipped', errorCode: record.errorCode };
            }
            if (step.kind === 'branch') {
                const matched = predicate(step, event);
                record.actionReceipts.push({ stepId: step.stepId, status: 'succeeded', matched });
                index += matched ? step.skipIfTrue : step.skipIfFalse;
                continue;
            }
            if (step.kind === 'update_state') {
                context.values[step.key] = step.value;
                record.actionReceipts.push({ stepId: step.stepId, status: 'succeeded' });
                continue;
            }
            if (step.kind === 'delay_until') {
                const dueAt = delayDate(step);
                await AutomationState.create({
                    ruleId: rule.ruleId, executionId: record._id, nextStep: index + 1,
                    dueAt, event, values: context.values
                });
                record.status = 'waiting';
                record.actionReceipts.push({ stepId: step.stepId, status: 'waiting', dueAt });
                await record.save();
                return { status: 'waiting', dueAt };
            }
            const receipt = await executeCapability(step, context);
            if (step.kind === 'research_web') {
                const previous = await AutomationState.findOne({ ruleId: rule.ruleId, namespace: 'digest', status: 'completed' })
                    .sort({ updatedAt: -1 }).lean();
                const previousUrls = new Set(previous?.values?.urls || []);
                context.values.research.sources = (context.values.research.sources || []).filter(source => !previousUrls.has(source.uri));
                if (context.values.research.sources.length === 0) throw Object.assign(new Error('NO_NEW_RESEARCH_SOURCES'), { code: 'NO_NEW_RESEARCH_SOURCES' });
                context.values.digestUrls = context.values.research.sources.map(source => source.uri);
            }
            record.actionReceipts.push({ stepId: step.stepId, ...receipt });
            await record.save();
        }
        record.status = 'succeeded';
        record.finishedAt = new Date();
        await record.save();
        if (context.values.digestUrls?.length) {
            await AutomationState.create({
                ruleId: rule.ruleId, executionId: record._id, namespace: 'digest', status: 'completed',
                dueAt: new Date(), event: { eventId: event.eventId, type: event.type },
                values: { urls: context.values.digestUrls }, expiresAt: new Date(Date.now() + 90 * 86400000)
            });
        }
        await AutomationRule.updateOne({ ruleId: rule.ruleId, revision: rule.revision }, {
            $set: {
                lastRunAt: new Date(), lastSuccessAt: new Date(), lastErrorCode: null,
                ...(rule.trigger?.type === 'once' ? { enabled: false, status: 'paused' } : {})
            },
            $inc: { 'limits.runCount': 1 }
        });
        return { status: 'succeeded', receipts: record.actionReceipts };
    } catch (error) {
        record.status = ['DM_CLOSED', 'MODERATION_EXEMPT', 'ROLE_HIERARCHY_BLOCKED'].includes(errorCode(error)) ? 'skipped' : 'failed';
        record.errorCode = errorCode(error);
        record.finishedAt = new Date();
        await record.save();
        await AutomationRule.updateOne({ ruleId: rule.ruleId }, {
            $set: {
                lastRunAt: new Date(), lastFailureAt: new Date(), lastErrorCode: record.errorCode,
                ...(rule.trigger?.type === 'once' ? { enabled: false, status: 'error' } : {})
            }
        });
        return { status: record.status, errorCode: record.errorCode };
    }
}

export async function resumeDueWorkflows(client, now = new Date()) {
    const states = await AutomationState.find({ status: 'waiting', dueAt: { $lte: now } }).limit(20);
    for (const state of states) {
        const claimed = await AutomationState.findOneAndUpdate(
            { _id: state._id, status: 'waiting' }, { $set: { status: 'ready' } }, { new: true }
        );
        if (!claimed) continue;
        const [rule, execution] = await Promise.all([
            AutomationRule.findOne({ ruleId: claimed.ruleId, enabled: true, status: 'active' }),
            AutomationExecution.findById(claimed.executionId)
        ]);
        if (!rule || !execution) {
            claimed.status = 'cancelled';
            await claimed.save();
            continue;
        }
        await runAutomation(client, rule, claimed.event, {
            execution, startStep: claimed.nextStep, values: claimed.values,
            occurrenceKey: execution.occurrenceKey
        });
        claimed.status = 'completed';
        await claimed.save();
    }
}
