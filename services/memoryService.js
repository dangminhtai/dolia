import mongoose from 'mongoose';
import { PermissionFlagsBits } from 'discord.js';
import Memory from '../models/Memory.js';
import MemoryRevision from '../models/MemoryRevision.js';
import User from '../models/User.js';
import Logger from '../class/Logger.js';
import { isOwner } from './authorizationService.js';
import { t } from './i18nService.js';

const VALID_SCOPES = new Set(['user_private', 'channel_shared', 'guild_shared']);
const VALID_KINDS = new Set(['fact', 'preference', 'project', 'event', 'relationship', 'rule']);
const SENSITIVE = /(?:api[_ -]?key|\btoken\b|\bpassword\b|\bpasscode\b|mật\s*khẩu|private\s*key|\bsecret\b|bearer\s+[\w.-]+)/i;
const INSTRUCTION_LIKE = /(?:bỏ qua|ignore|override|vượt qua).{0,40}(?:quy tắc|instruction|permission|bảo mật|system)/i;

export function normalizeKey(value = '') {
    return String(value).normalize('NFKC').trim().toLowerCase()
        .replace(/[^\p{L}\p{N}:_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 120);
}

export function normalizeTags(values = []) {
    return [...new Set((Array.isArray(values) ? values : []).map(normalizeKey).filter(Boolean))].slice(0, 12);
}

function cleanText(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 1000);
}

function runtime(args) {
    const message = args.message;
    const user = args.user || message?.author;
    const guild = args.guild || message?.guild;
    const channel = args.channel || message?.channel;
    return {
        userId: user?.id,
        guildId: guild?.id || null,
        channelId: channel?.id || null,
        messageId: message?.id || null,
        member: args.member || message?.member || null
    };
}

export function visibilityFilter({ userId, guildId, channelId }, { includeDeleted = false } = {}) {
    const scopes = [{ scope: 'user_private', ownerId: userId }];
    if (guildId && channelId) scopes.push({ scope: 'channel_shared', guildId, channelId });
    if (guildId) scopes.push({ scope: 'guild_shared', guildId });
    const filter = { $or: scopes };
    if (!includeDeleted) filter.status = 'active';
    filter.$and = [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }];
    return filter;
}

function canManageGuildMemory(ctx) {
    return isOwner(ctx.userId) || Boolean(ctx.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild));
}

function identityFor(scope, ctx) {
    if (scope === 'user_private') return { ownerId: ctx.userId, guildId: null, channelId: null };
    if (scope === 'channel_shared') return { ownerId: null, guildId: ctx.guildId, channelId: ctx.channelId };
    return { ownerId: null, guildId: ctx.guildId, channelId: null };
}

function assertCreateAllowed(scope, ctx) {
    if (!ctx.userId) throw new Error(t('memory.errors.missing_identity'));
    if (!VALID_SCOPES.has(scope)) throw new Error(t('memory.errors.invalid_scope'));
    if (scope !== 'user_private' && !ctx.guildId) throw new Error(t('memory.errors.shared_in_dm'));
    if (scope === 'guild_shared' && !canManageGuildMemory(ctx)) throw new Error(t('memory.errors.guild_permission'));
}

export function assertSafeMemoryText(text) {
    if (!text) throw new Error(t('memory.errors.text_required'));
    if (SENSITIVE.test(text)) throw new Error(t('memory.errors.sensitive'));
    if (INSTRUCTION_LIKE.test(text)) throw new Error(t('memory.errors.unsafe_instruction'));
}

async function revision(memory, action, changedBy) {
    const snapshot = memory.toObject ? memory.toObject({ depopulate: true }) : memory;
    try {
        await MemoryRevision.create({ memoryId: memory._id, version: memory.version, action, snapshot, changedBy });
        return true;
    } catch (error) {
        Logger.error(t('logs.memoryservice.error_revision_failed', { memoryId: String(memory._id), message: error.message }));
        return false;
    }
}

function serialize(memory) {
    return {
        id: String(memory._id), scope: memory.scope, kind: memory.kind, key: memory.key,
        text: memory.text, tags: memory.tags || [], status: memory.status,
        version: memory.version, updatedAt: memory.updatedAt
    };
}

function tokenize(value = '') {
    return new Set(String(value).normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 1));
}

function relevance(memory, queryTokens) {
    if (!queryTokens.size) return (memory.kind === 'preference' ? 4 : 0) + new Date(memory.updatedAt).getTime() / 1e15;
    const haystack = tokenize(`${memory.key} ${memory.text} ${(memory.tags || []).join(' ')}`);
    let score = memory.kind === 'preference' ? 1 : 0;
    for (const token of queryTokens) if (haystack.has(token)) score += 3;
    return score;
}

export async function queryVisibleMemories(args = {}) {
    const ctx = runtime(args);
    if (!ctx.userId) return { ok: false, code: 'IDENTITY_REQUIRED', reply: t('memory.errors.missing_identity') };
    const limit = Math.max(1, Math.min(Number(args.limit) || 10, 20));
    const filter = visibilityFilter(ctx);
    if (args.scope && VALID_SCOPES.has(args.scope)) filter.scope = args.scope;
    if (args.kind && VALID_KINDS.has(args.kind)) filter.kind = args.kind;
    const candidates = await Memory.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
    const queryTokens = tokenize(args.query);
    const memories = candidates.map(item => ({ item, score: relevance(item, queryTokens) }))
        .filter(row => !queryTokens.size || row.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit).map(row => serialize(row.item));
    return {
        ok: true,
        memories,
        reply: memories.length ? t('memory.query.found', { count: memories.length }) : t('memory.query.empty')
    };
}

export async function actOnMemory(args = {}) {
    const ctx = runtime(args);
    const action = args.action;
    try {
        if (action === 'set_enabled') {
            if (!ctx.userId) throw new Error(t('memory.errors.missing_identity'));
            if (typeof args.enabled !== 'boolean') throw new Error(t('memory.errors.enabled_required'));
            const enabled = Boolean(args.enabled);
            await User.updateOne({ userId: ctx.userId }, { $set: { memoryEnabled: enabled } }, { upsert: true });
            return { ok: true, enabled, reply: t(enabled ? 'memory.action.enabled' : 'memory.action.disabled') };
        }
        if (action === 'create') {
            const scope = args.scope || 'user_private';
            const kind = VALID_KINDS.has(args.kind) ? args.kind : 'fact';
            const text = cleanText(args.text);
            const key = normalizeKey(args.key || text.slice(0, 60));
            assertCreateAllowed(scope, ctx);
            assertSafeMemoryText(text);
            const policy = await User.findOne({ userId: ctx.userId }).select('memoryEnabled').lean();
            if (policy?.memoryEnabled === false) throw new Error(t('memory.errors.disabled'));
            if (!key) throw new Error(t('memory.errors.key_required'));
            const identity = identityFor(scope, ctx);
            const duplicate = await Memory.findOne({ ...identity, scope, key, status: 'active' });
            if (duplicate) {
                if (duplicate.text === text) return { ok: true, duplicate: true, memory: serialize(duplicate), reply: t('memory.action.duplicate') };
                return { ok: false, code: 'KEY_CONFLICT', memory: serialize(duplicate), reply: t('memory.errors.key_conflict') };
            }
            const memory = await Memory.create({
                ...identity, scope, kind, key, text, tags: normalizeTags(args.tags), confidence: 1,
                provenance: {
                    source: args.source === 'manual_ui' ? 'manual_ui' : 'explicit_user',
                    messageIds: ctx.messageId ? [ctx.messageId] : [],
                    sourceChannelId: ctx.channelId,
                    recordedBy: ctx.userId
                }
            });
            await revision(memory, 'created', ctx.userId);
            return { ok: true, memory: serialize(memory), reply: t('memory.action.created') };
        }

        if (!mongoose.isValidObjectId(args.memory_id)) return { ok: false, code: 'INVALID_ID', reply: t('memory.errors.invalid_id') };
        const memory = await Memory.findOne({ _id: args.memory_id, ...visibilityFilter(ctx, { includeDeleted: true }) });
        if (!memory) return { ok: false, code: 'NOT_FOUND', reply: t('memory.errors.not_found') };
        if (memory.scope === 'guild_shared' && !canManageGuildMemory(ctx)) return { ok: false, code: 'FORBIDDEN', reply: t('memory.errors.guild_permission') };
        if (memory.scope === 'channel_shared' && memory.provenance.recordedBy !== ctx.userId && !canManageGuildMemory(ctx)) {
            return { ok: false, code: 'FORBIDDEN', reply: t('memory.errors.shared_permission') };
        }

        if (action === 'update') {
            const text = cleanText(args.text || memory.text);
            assertSafeMemoryText(text);
            memory.text = text;
            if (args.key) memory.key = normalizeKey(args.key);
            if (args.kind && VALID_KINDS.has(args.kind)) memory.kind = args.kind;
            if (args.tags) memory.tags = normalizeTags(args.tags);
            memory.version += 1;
            await memory.save();
            await revision(memory, 'updated', ctx.userId);
            return { ok: true, memory: serialize(memory), reply: t('memory.action.updated') };
        }
        if (action === 'delete' || action === 'restore') {
            memory.status = action === 'delete' ? 'deleted' : 'active';
            memory.version += 1;
            await memory.save();
            await revision(memory, action === 'delete' ? 'deleted' : 'restored', ctx.userId);
            return { ok: true, memory: serialize(memory), reply: t(`memory.action.${action}d`) };
        }
        return { ok: false, code: 'INVALID_ACTION', reply: t('memory.errors.invalid_action') };
    } catch (error) {
        return { ok: false, code: 'MEMORY_ERROR', reply: error.message || t('memory.errors.generic') };
    }
}

export async function getMemoryHistory(memoryId, args = {}) {
    const ctx = runtime(args);
    if (!mongoose.isValidObjectId(memoryId)) return [];
    const memory = await Memory.findOne({ _id: memoryId, ...visibilityFilter(ctx, { includeDeleted: true }) }).lean();
    if (!memory) return [];
    return MemoryRevision.find({ memoryId }).sort({ version: -1 }).limit(20).lean();
}

export async function buildMemoryContext(args = {}) {
    const ctx = runtime(args);
    const policy = ctx.userId ? await User.findOne({ userId: ctx.userId }).select('memoryEnabled').lean() : null;
    if (policy?.memoryEnabled === false) return t('memory.context.disabled');
    const result = await queryVisibleMemories({ ...args, query: args.query, limit: 12 });
    if (!result.ok || !result.memories.length) return t('memory.context.empty');
    const lines = result.memories.map((item, index) => `${index + 1}. [${item.scope}/${item.kind}] ${item.text}`);
    return `${t('memory.context.warning')}\n${lines.join('\n')}`;
}

export async function exportVisibleMemories(args = {}) {
    const ctx = runtime(args);
    const memories = await Memory.find(visibilityFilter(ctx, { includeDeleted: true })).sort({ updatedAt: -1 }).lean();
    return memories.map(serialize);
}
