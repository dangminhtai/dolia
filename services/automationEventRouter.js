import crypto from 'node:crypto';
import mongoose from 'mongoose';
import AutomationRule from '../models/AutomationRule.js';
import { runAutomation } from './automationRunner.js';

const spamWindows = new Map();

function fingerprint(parts) {
    return crypto.createHash('sha256').update(parts.map(value => String(value ?? '')).join(':')).digest('hex').slice(0, 24);
}

export function canonicalMessageEvent(message) {
    return {
        eventId: `message:${message.id}`, type: 'messageCreate', guildId: message.guildId,
        channelId: message.channelId, actorId: message.author.id, subjectId: message.author.id,
        occurredAt: message.createdAt || new Date(), source: 'discord_gateway',
        data: { messageId: message.id, content: String(message.content || '').slice(0, 500), isBot: Boolean(message.author.bot), isWebhook: Boolean(message.webhookId) }
    };
}

export function canonicalMemberEvent(member) {
    return {
        eventId: `member_join:${member.guild.id}:${member.id}:${member.joinedTimestamp || Date.now()}`,
        type: 'guildMemberAdd', guildId: member.guild.id, channelId: null,
        actorId: member.id, subjectId: member.id, occurredAt: new Date(), source: 'discord_gateway',
        data: { isBot: Boolean(member.user.bot) }
    };
}

export function canonicalAutoModEvent(event) {
    const eventId = event.id || fingerprint([event.guildId, event.userId, event.ruleId, event.createdTimestamp]);
    return {
        eventId: `automod:${eventId}`, type: 'autoModerationActionExecution', guildId: event.guildId,
        channelId: event.channelId || null, actorId: event.userId, subjectId: event.userId,
        occurredAt: event.createdAt || new Date(), source: 'discord_gateway',
        data: { ruleId: event.ruleId, actionType: event.action?.type, matchedKeyword: String(event.matchedKeyword || '').slice(0, 100) }
    };
}

function conditionMatches(condition, event, rule) {
    switch (condition?.kind) {
        case 'author_is': return event.actorId === String(condition.userId || rule.createdBy);
        case 'channel_is': return event.channelId === String(condition.channelId || rule.channelId);
        case 'contains': return event.data?.content?.toLowerCase().includes(String(condition.text || '').toLowerCase());
        case 'member_not_bot': return !event.data?.isBot;
        case 'member_not_welcomed': return true; // occurrence uniqueness is the persistent welcome dedupe.
        case 'spam_threshold': {
            if (event.type !== 'messageCreate') return false;
            const windowSeconds = Math.max(2, Math.min(Number(condition.windowSeconds) || 10, 300));
            const count = Math.max(2, Math.min(Number(condition.count) || 5, 50));
            const key = `${rule.ruleId}:${event.actorId}`;
            const cutoff = Date.now() - windowSeconds * 1000;
            const entries = (spamWindows.get(key) || []).filter(item => item.at >= cutoff);
            entries.push({ at: Date.now(), content: event.data.content });
            spamWindows.set(key, entries.slice(-50));
            return entries.length >= count;
        }
        default: return false;
    }
}

export async function routeAutomationEvent(client, event) {
    if (mongoose.connection.readyState !== 1 || !event.guildId || event.data?.isBot || event.data?.isWebhook) return [];
    const rules = await AutomationRule.find({
        guildId: event.guildId, enabled: true, status: 'active', 'trigger.type': event.type
    }).limit(100);
    const results = [];
    for (const rule of rules) {
        if (rule.channelId && event.channelId && rule.channelId !== event.channelId) continue;
        if (rule.limits?.maxRuns && rule.limits.runCount >= rule.limits.maxRuns) {
            await AutomationRule.updateOne({ _id: rule._id }, { $set: { enabled: false, status: 'paused', lastErrorCode: 'MAX_RUNS_REACHED' } });
            continue;
        }
        if (rule.limits?.cooldownSeconds && rule.lastRunAt
            && Date.now() - new Date(rule.lastRunAt).getTime() < rule.limits.cooldownSeconds * 1000) continue;
        if ((rule.conditions || []).some(condition => !conditionMatches(condition, event, rule))) continue;
        const occurrenceKey = `event:${event.eventId}:r${rule.revision}`;
        results.push(await runAutomation(client, rule, event, { occurrenceKey }));
    }
    return results;
}

export async function handleMessageAutomation(message) {
    return routeAutomationEvent(message.client, canonicalMessageEvent(message));
}

export async function handleMemberAutomation(member) {
    return routeAutomationEvent(member.client, canonicalMemberEvent(member));
}

export async function handleAutoModAutomation(event) {
    return routeAutomationEvent(event.guild.client, canonicalAutoModEvent(event));
}
