import AutomationRule from '../models/AutomationRule.js';
import AutomationExecution from '../models/AutomationExecution.js';
import mongoose from 'mongoose';
import Logger from '../class/Logger.js';
import { nextScheduleAt, scheduleOccurrenceKey, shouldSkipMissedRun } from '../core/automation/schedule.js';
import { claimExecution, runAutomation, resumeDueWorkflows } from './automationRunner.js';
import { t } from './i18nService.js';

const instanceId = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const SCHEDULE_TYPES = ['daily_at', 'daily_window', 'once'];

export class AutomationScheduler {
    constructor({ intervalMs = 30000 } = {}) {
        this.intervalMs = intervalMs;
        this.timer = null;
        this.client = null;
        this.ticking = false;
    }

    start(client) {
        if (this.timer) return;
        this.client = client;
        this.timer = setInterval(() => this.tick().catch(error => Logger.error(t('automation.logs.scheduler_failed', { message: error.message }))), this.intervalMs);
        this.timer.unref?.();
        void this.tick();
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.client = null;
    }

    async claimDueRule(now) {
        return AutomationRule.findOneAndUpdate({
            enabled: true, status: 'active', 'trigger.type': { $in: SCHEDULE_TYPES },
            'schedule.nextRunAt': { $ne: null, $lte: now },
            $or: [{ 'schedule.leaseExpiresAt': null }, { 'schedule.leaseExpiresAt': { $lte: now } }]
        }, {
            $set: { 'schedule.leaseOwner': instanceId, 'schedule.leaseExpiresAt': new Date(now.getTime() + 120000) }
        }, { sort: { 'schedule.nextRunAt': 1 }, new: true });
    }

    async recoverUnstartedExecutions(now) {
        const stale = await AutomationExecution.find({
            status: 'claimed', scheduledFor: { $ne: null }, leaseExpiresAt: { $lte: now }
        }).sort({ scheduledFor: 1 }).limit(10);
        for (const staleExecution of stale) {
            const execution = await AutomationExecution.findOneAndUpdate({
                _id: staleExecution._id, status: 'claimed', leaseExpiresAt: { $lte: now }
            }, {
                $set: { claimedBy: instanceId, leaseExpiresAt: new Date(now.getTime() + 120000) }
            }, { new: true });
            if (!execution) continue;
            const rule = await AutomationRule.findOne({
                ruleId: execution.ruleId, revision: execution.ruleRevision,
                enabled: true, status: 'active'
            });
            if (!rule) {
                execution.status = 'skipped'; execution.errorCode = 'RULE_NOT_ACTIVE'; execution.finishedAt = now;
                await execution.save();
                continue;
            }
            const event = {
                eventId: execution.eventId, type: rule.trigger.type, guildId: rule.guildId,
                channelId: rule.channelId, actorId: rule.createdBy, subjectId: rule.createdBy,
                occurredAt: execution.scheduledFor, source: 'automation_scheduler_recovery', data: {}
            };
            await runAutomation(this.client, rule, event, { execution, occurrenceKey: execution.occurrenceKey, scheduledFor: execution.scheduledFor });
        }
    }

    async tick(now = new Date()) {
        if (this.ticking || !this.client || mongoose.connection.readyState !== 1) return;
        this.ticking = true;
        try {
            await this.recoverUnstartedExecutions(now);
            await resumeDueWorkflows(this.client, now);
            for (let count = 0; count < 20; count++) {
                const rule = await this.claimDueRule(now);
                if (!rule) break;
                if (rule.limits?.maxRuns && rule.limits.runCount >= rule.limits.maxRuns) {
                    await AutomationRule.updateOne({ _id: rule._id }, {
                        $set: { enabled: false, status: 'paused', lastErrorCode: 'MAX_RUNS_REACHED', 'schedule.leaseOwner': null, 'schedule.leaseExpiresAt': null }
                    });
                    continue;
                }
                const scheduledFor = new Date(rule.schedule.nextRunAt);
                const occurrenceKey = scheduleOccurrenceKey(rule, scheduledFor);
                const nextRunAt = rule.trigger.type === 'once' ? null : nextScheduleAt(rule, new Date(scheduledFor.getTime() + 1000));
                const event = {
                    eventId: occurrenceKey, type: rule.trigger.type, guildId: rule.guildId,
                    channelId: rule.channelId, actorId: rule.createdBy, subjectId: rule.createdBy,
                    occurredAt: scheduledFor, source: 'automation_scheduler', data: {}
                };
                const execution = await claimExecution(rule, occurrenceKey, event, scheduledFor);
                await AutomationRule.updateOne({ _id: rule._id, 'schedule.leaseOwner': instanceId }, {
                    $set: {
                        'schedule.nextRunAt': nextRunAt,
                        'schedule.leaseOwner': null,
                        'schedule.leaseExpiresAt': null,
                        ...(rule.trigger.type === 'once' ? { 'schedule.nextRunAt': null } : {})
                    }
                });
                if (!execution) continue;
                if (shouldSkipMissedRun(rule, scheduledFor, now)) {
                    execution.status = 'skipped'; execution.errorCode = 'MISSED_RUN'; execution.finishedAt = now;
                    await execution.save();
                    await AutomationRule.updateOne({ _id: rule._id }, { $set: { lastRunAt: now, lastErrorCode: 'MISSED_RUN' } });
                    continue;
                }
                await runAutomation(this.client, rule, event, { execution, occurrenceKey, scheduledFor });
            }
        } finally {
            this.ticking = false;
        }
    }
}

export default new AutomationScheduler();
