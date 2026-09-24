import { PermissionFlagsBits } from 'discord.js';
import { isOwner } from './authorizationService.js';
import { formatResearchDigest, researchWeb } from './automationResearchService.js';

const mentionPolicy = Object.freeze({ parse: [], repliedUser: false });

function capabilityError(code) {
    return Object.assign(new Error(code), { code });
}

async function fetchGuild(client, guildId) {
    if (!guildId) throw capabilityError('GUILD_REQUIRED');
    return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId);
}

async function assertRuleAuthority(client, rule, { destructive = false } = {}) {
    if (isOwner(rule.createdBy)) return;
    const guild = await fetchGuild(client, rule.guildId);
    const creator = await guild.members.fetch(rule.createdBy).catch(() => null);
    if (!creator) throw capabilityError('CREATOR_LEFT_GUILD');
    const required = destructive ? PermissionFlagsBits.Administrator : PermissionFlagsBits.ManageGuild;
    if (!creator.permissions.has(required)) throw capabilityError('CREATOR_PERMISSION_REVOKED');
}

async function fetchChannel(client, id) {
    if (!id) throw capabilityError('CHANNEL_REQUIRED');
    const channel = client.channels.cache.get(id) || await client.channels.fetch(id).catch(() => null);
    if (!channel?.isTextBased?.()) throw capabilityError('CHANNEL_NOT_FOUND');
    return channel;
}

function render(template, ctx) {
    const values = {
        'event.actorId': ctx.event.actorId,
        'event.subjectId': ctx.event.subjectId,
        'event.channelId': ctx.event.channelId,
        'research.summary': ctx.values.research?.summary || '',
        'research.digest': ctx.values.research ? formatResearchDigest(ctx.values.research) : ''
    };
    return String(template || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => String(values[key] ?? '')).slice(0, 2000);
}

async function moderationTarget(client, rule, step, event) {
    await assertRuleAuthority(client, rule, { destructive: true });
    if (!rule.approvedBy) throw capabilityError('APPROVAL_REQUIRED');
    const guild = await fetchGuild(client, rule.guildId);
    const userId = step.userId || event.subjectId || event.actorId;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw capabilityError('MEMBER_NOT_FOUND');
    if (member.user.bot || member.id === guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator)) {
        throw capabilityError('MODERATION_EXEMPT');
    }
    const botMember = guild.members.me || await guild.members.fetchMe();
    if (member.roles.highest.position >= botMember.roles.highest.position) throw capabilityError('ROLE_HIERARCHY_BLOCKED');
    return member;
}

export async function executeCapability(step, ctx) {
    const { client, rule, event } = ctx;
    switch (step.kind) {
        case 'filter':
        case 'branch':
        case 'update_state':
            return { status: 'succeeded', data: { operation: step.kind } };
        case 'research_web': {
            const result = await researchWeb(step.query, {
                lookbackHours: step.lookbackHours,
                maxSources: step.maxSources,
                maxAttempts: rule.retryPolicy?.maxAttempts || 1,
                modelScope: 'agent'
            });
            ctx.values.research = result;
            return { status: 'succeeded', data: { sources: result.sources, researchedAt: result.researchedAt } };
        }
        case 'react': {
            if (event.type !== 'messageCreate' || !event.data?.messageId) throw capabilityError('REACTION_REQUIRES_MESSAGE');
            const channel = await fetchChannel(client, event.channelId);
            const message = await channel.messages.fetch(event.data.messageId).catch(() => null);
            if (!message || message.author?.bot) throw capabilityError('MESSAGE_NOT_FOUND');
            await message.react(step.emoji);
            return { status: 'succeeded', discordMessageId: message.id, targetId: channel.id };
        }
        case 'send_message': {
            await assertRuleAuthority(client, rule);
            const channel = await fetchChannel(client, step.channelId || rule.channelId || event.channelId);
            if (channel.guildId && channel.guildId !== rule.guildId) throw capabilityError('TARGET_OUT_OF_SCOPE');
            const sent = await channel.send({ content: render(step.content || step.template, ctx), allowedMentions: mentionPolicy });
            return { status: 'succeeded', discordMessageId: sent.id, targetId: channel.id };
        }
        case 'send_dm':
        case 'warn': {
            await assertRuleAuthority(client, rule);
            const userId = step.userId || event.subjectId || event.actorId;
            if (!userId) throw capabilityError('USER_REQUIRED');
            const user = await client.users.fetch(userId).catch(() => null);
            if (!user || (user.bot && !step.includeBots)) throw capabilityError('USER_NOT_FOUND');
            const sent = await user.send({ content: render(step.content || step.template, ctx), allowedMentions: mentionPolicy })
                .catch(error => { throw Object.assign(error, { code: 'DM_CLOSED' }); });
            return { status: 'succeeded', discordMessageId: sent.id, targetId: user.id };
        }
        case 'timeout': {
            const member = await moderationTarget(client, rule, step, event);
            if (!member.moderatable) throw capabilityError('MEMBER_NOT_MODERATABLE');
            await member.timeout(step.durationMinutes * 60000, `Dolia automation ${rule.ruleId}`);
            return { status: 'succeeded', targetId: member.id };
        }
        case 'kick': {
            const member = await moderationTarget(client, rule, step, event);
            if (!member.kickable) throw capabilityError('MEMBER_NOT_KICKABLE');
            await member.kick(`Dolia automation ${rule.ruleId}`);
            return { status: 'succeeded', targetId: member.id };
        }
        default:
            throw capabilityError('CAPABILITY_NOT_SUPPORTED');
    }
}
