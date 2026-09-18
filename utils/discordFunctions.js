import {
    ChannelType,
    GuildScheduledEventEntityType,
    GuildScheduledEventPrivacyLevel,
    GuildScheduledEventStatus,
    StageInstancePrivacyLevel,
    AutoModerationRuleTriggerType,
    AutoModerationRuleEventType,
    AutoModerationActionType,
    ActivityType,
    PermissionFlagsBits
} from 'discord.js';

function uniqueRoles(member) {
    if (!member?.roles?.cache) return [];
    return [...member.roles.cache.values()]
        .filter(role => role?.name && role.name !== '@everyone')
        .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
        .map(role => role.name);
}

function statusOf(member) {
    return member?.presence?.status || 'offline';
}

function activitySummary(member) {
    const activities = member?.presence?.activities || [];
    return activities
        .map(activity => ({
            name: activity.name || null,
            type: activity.type ?? null,
            state: activity.state || null,
            details: activity.details || null
        }))
        .filter(activity => activity.name || activity.state || activity.details);
}

function memberLabel(member) {
    return member?.displayName
        || member?.user?.globalName
        || member?.user?.username
        || member?.globalName
        || member?.username
        || 'Unknown';
}

function roleLabel(role) {
    return role?.name || 'Unknown role';
}

function channelLabel(channel) {
    return channel?.name ? `#${channel.name}` : 'Unknown channel';
}

function messageLabel(message) {
    const who = memberLabel(message?.member || message?.author);
    return `${who}: ${excerpt(message?.content, 72)}`;
}

function memberSnapshot(member) {
    return {
        display_name: memberLabel(member),
        username: member?.user?.username || null,
        global_name: member?.user?.globalName || null,
        nickname: member?.nickname || null,
        is_bot: Boolean(member?.user?.bot),
        status: statusOf(member),
        joined_at: member?.joinedAt?.toISOString?.() || null,
        account_created_at: member?.user?.createdAt?.toISOString?.() || null,
        roles: uniqueRoles(member),
        voice_channel: member?.voice?.channel?.name || null,
        timed_out_until: member?.communicationDisabledUntil?.toISOString?.() || null,
        activities: activitySummary(member),
        avatar_url: member?.displayAvatarURL?.({ size: 512 }) || member?.user?.displayAvatarURL?.({ size: 512 }) || null
    };
}

function channelSnapshot(channel) {
    return {
        name: channel?.name || null,
        type: channel?.type ?? null,
        topic: channel?.topic || null,
        nsfw: Boolean(channel?.nsfw),
        parent: channel?.parent?.name || null,
        position: channel?.position ?? null,
        created_at: channel?.createdAt?.toISOString?.() || null,
        slowmode_seconds: channel?.rateLimitPerUser ?? null,
        bitrate: channel?.bitrate ?? null,
        user_limit: channel?.userLimit ?? null,
        member_count: channel?.members?.size ?? null,
        thread: Boolean(channel?.isThread?.()),
        archived: channel?.archived ?? null,
        locked: channel?.locked ?? null
    };
}

function roleSnapshot(role) {
    return {
        name: role?.name || null,
        color: role?.hexColor || null,
        position: role?.position ?? null,
        hoist: Boolean(role?.hoist),
        mentionable: Boolean(role?.mentionable),
        managed: Boolean(role?.managed),
        members: role?.members?.size ?? null,
        permissions: role?.permissions?.toArray?.() || []
    };
}

function messageSnapshot(msg) {
    return {
        author: memberLabel(msg?.member || msg?.author),
        content: msg?.content || '',
        created_at: msg?.createdAt?.toISOString?.() || null,
        edited_at: msg?.editedAt?.toISOString?.() || null,
        pinned: Boolean(msg?.pinned),
        attachments: msg?.attachments ? [...msg.attachments.values()].map(a => ({ name: a.name, content_type: a.contentType || null, size: a.size ?? null })) : [],
        reactions: msg?.reactions?.cache ? [...msg.reactions.cache.values()].map(r => ({ emoji: r.emoji?.name || r.emoji?.id || null, count: r.count })) : [],
        has_thread: Boolean(msg?.hasThread),
        poll: msg?.poll ? {
            question: msg.poll.question?.text || null,
            answers: msg.poll.answers?.values ? [...msg.poll.answers.values()].map(a => ({ id: a.id, text: a.text, votes: a.voteCount })) : []
        } : null
    };
}

function isOwner(userId) {
    return Boolean(process.env.OWNER_ID && userId && String(userId) === String(process.env.OWNER_ID));
}

function excerpt(text, max = 56) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '(không có nội dung text)';
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function clampInt(value, min, max, fallback = min) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(Math.trunc(n), min), max);
}

function resolveEntity(discordEntities, ref) {
    if (!discordEntities?.get || !ref) return null;
    return discordEntities.get(ref) || null;
}

function registerEntities(discordEntities, prefix, values, labeler = () => '') {
    if (!discordEntities?.set) return [];
    const refs = [];
    let index = 1;
    for (const value of values) {
        const ref = `${prefix}${index++}`;
        discordEntities.set(ref, value);
        refs.push({ ref, label: labeler(value) });
    }
    return refs;
}

async function requireOwner(message) {
    if (!isOwner(message?.author?.id)) {
        return {
            ok: false,
            code: 'OWNER_ONLY',
            message: 'Thao tác này chỉ chủ bot mới được phép yêu cầu.',
            reply: 'Cái này mình chỉ nhận lệnh từ chủ bot thôi nha.'
        };
    }
    return null;
}

async function fetchMembers(guild, withPresences = false) {
    if (!guild?.members) return { members: null, complete: false, presenceRequested: false };
    try {
        const members = withPresences
            ? await guild.members.fetch({ withPresences: true })
            : await guild.members.fetch();
        return { members, complete: true, presenceRequested: withPresences };
    } catch (_) {
        return {
            members: guild.members.cache,
            complete: false,
            presenceRequested: withPresences
        };
    }
}

async function fetchRecentMessages(channel, limit = 50) {
    if (!channel?.messages?.fetch) return [];
    try {
        const collection = await channel.messages.fetch({ limit: clampInt(limit, 1, 100, 50) });
        return [...collection.values()];
    } catch (_) {
        return [];
    }
}

function mutationError(error) {
    const code = error?.code || error?.rawError?.code || 'DISCORD_API_ERROR';
    const msg = error?.message || 'Unknown error';
    return {
        ok: false,
        code: String(code),
        message: `Discord từ chối thao tác: ${msg}`,
        reply: `Mình thử rồi nhưng Discord từ chối thao tác: ${msg}`
    };
}

function success(action, reply, extra = {}) {
    return { ok: true, action, reply, ...extra };
}

function targetRequired(message = 'Không xác định được đối tượng cần thao tác.') {
    return { ok: false, code: 'TARGET_REQUIRED', message, reply: message };
}

function normalizeDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

async function attachmentBuffer(attachment) {
    if (!attachment?.url) throw new Error('Attachment không có URL hợp lệ.');
    const res = await fetch(attachment.url);
    if (!res.ok) throw new Error(`Không tải được attachment (${res.status}).`);
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > 12 * 1024 * 1024) throw new Error('Attachment quá lớn để xử lý trực tiếp.');
    return Buffer.from(arrayBuffer);
}

function customEmojiRefs(message, guild) {
    const found = [];
    const seen = new Set();
    const text = String(message?.content || '');
    const regex = /<a?:([\w~]+):(\d{17,20})>/g;
    let m;
    while ((m = regex.exec(text))) {
        const emoji = guild?.emojis?.cache?.get?.(m[2]);
        if (emoji && !seen.has(emoji.id)) {
            seen.add(emoji.id);
            found.push(emoji);
        }
    }
    return found;
}


function sanitizePermissionNames(values) {
    if (!Array.isArray(values)) return [];
    const valid = new Set(Object.keys(PermissionFlagsBits));
    return [...new Set(values.map(v => String(v || '').trim()).filter(v => valid.has(v)))];
}

function permissionOverwritePayload(allow, deny, clear) {
    const payload = {};
    for (const key of sanitizePermissionNames(allow)) payload[key] = true;
    for (const key of sanitizePermissionNames(deny)) payload[key] = false;
    for (const key of sanitizePermissionNames(clear)) payload[key] = null;
    return payload;
}

function normalizeActivityType(value) {
    const key = String(value || 'playing').toLowerCase();
    if (key === 'listening') return ActivityType.Listening;
    if (key === 'watching') return ActivityType.Watching;
    if (key === 'competing') return ActivityType.Competing;
    return ActivityType.Playing;
}

function normalizeAutoArchiveMinutes(value) {
    const n = Number(value);
    return [60, 1440, 4320, 10080].includes(n) ? n : 1440;
}


function normalizeAfkTimeoutSeconds(value) {
    const n = Number(value);
    return [60, 300, 900, 1800, 3600].includes(n) ? n : 300;
}

function findReaction(message, emoji) {
    if (!message?.reactions?.cache) return null;
    const wanted = String(emoji || '').trim();
    const all = [...message.reactions.cache.values()];
    if (!wanted && all.length === 1) return all[0];
    return all.find(r => r.emoji?.name === wanted || r.emoji?.id === wanted || r.emoji?.toString?.() === wanted) || null;
}

function forumTagIds(channel, names) {
    const wanted = Array.isArray(names) ? names.map(x => String(x || '').trim().toLowerCase()).filter(Boolean) : [];
    if (!wanted.length) return [];
    const available = Array.isArray(channel?.availableTags) ? channel.availableTags : [];
    const ids = [];
    for (const name of wanted) {
        const tag = available.find(t => String(t?.name || '').toLowerCase() === name);
        if (tag?.id) ids.push(tag.id);
    }
    return ids;
}

function forumTagPayload(channel, names) {
    const requested = Array.isArray(names) ? names.map(x => String(x || '').trim()).filter(Boolean).slice(0, 20) : [];
    const existing = Array.isArray(channel?.availableTags) ? channel.availableTags : [];
    return requested.map(name => {
        const old = existing.find(t => String(t?.name || '').toLowerCase() === name.toLowerCase());
        if (!old) return { name };
        return {
            id: old.id,
            name: old.name,
            moderated: Boolean(old.moderated),
            emoji: old.emoji || undefined
        };
    });
}

function resolveDefaultReaction(discordEntities, emoji) {
    const raw = String(emoji || '').trim();
    if (!raw) return null;
    const ent = resolveEntity(discordEntities, raw);
    if (ent?.id && ent?.name) return { id: ent.id, name: null };
    const customMatch = raw.match(/^<a?:[^:]+:(\d{17,20})>$/);
    if (customMatch) return { id: customMatch[1], name: null };
    return { id: null, name: raw };
}

/**
 * Request-scoped Discord entity registry.
 * AI sees stable aliases (u1/r1/c1/e1/a1...) instead of Snowflake IDs.
 */
export async function buildDiscordRuntimeContext(message) {
    const entities = new Map();
    const guild = message?.guild;
    const lines = [];

    if (message?.member) {
        entities.set('author', message.member);
        lines.push(`- author = @${memberLabel(message.member)}`);
    }

    const botMember = guild?.members?.me || await guild?.members?.fetchMe?.().catch?.(() => null);
    if (botMember) {
        entities.set('bot', botMember);
        lines.push(`- bot = @${memberLabel(botMember)}`);
    }

    if (message?.channel) {
        entities.set('current_channel', message.channel);
        lines.push(`- current_channel = ${channelLabel(message.channel)}`);
    }
    if (message) entities.set('current_message', message);

    if (message?.mentions?.members?.values) {
        let i = 1;
        for (const member of message.mentions.members.values()) {
            const ref = `u${i++}`;
            entities.set(ref, member);
            lines.push(`- ${ref} = @${memberLabel(member)} (member mention)`);
        }
    }

    if (message?.mentions?.roles?.values) {
        let i = 1;
        for (const role of message.mentions.roles.values()) {
            const ref = `r${i++}`;
            entities.set(ref, role);
            lines.push(`- ${ref} = @${roleLabel(role)} (role mention)`);
        }
    }

    if (message?.mentions?.channels?.values) {
        let i = 1;
        for (const channel of message.mentions.channels.values()) {
            const ref = `c${i++}`;
            entities.set(ref, channel);
            lines.push(`- ${ref} = ${channelLabel(channel)} (channel mention)`);
        }
    }

    const emojis = customEmojiRefs(message, guild);
    emojis.forEach((emoji, index) => {
        const ref = `e${index + 1}`;
        entities.set(ref, emoji);
        lines.push(`- ${ref} = :${emoji.name}: (custom emoji)`);
    });

    if (message?.attachments?.values) {
        let i = 1;
        for (const attachment of message.attachments.values()) {
            const ref = `a${i++}`;
            entities.set(ref, attachment);
            lines.push(`- ${ref} = attachment "${attachment.name || 'unnamed'}" (${attachment.contentType || 'unknown'})`);
        }
    }

    if (message?.reference?.messageId && message?.channel?.messages?.fetch) {
        try {
            const replied = await message.channel.messages.fetch(message.reference.messageId);
            if (replied) {
                entities.set('replied_message', replied);
                if (replied.member) entities.set('replied_author', replied.member);
                lines.push(`- replied_message = ${messageLabel(replied)}`);
                if (replied.member) lines.push(`- replied_author = @${memberLabel(replied.member)}`);
                if (replied.attachments?.values) {
                    let i = 1;
                    for (const attachment of replied.attachments.values()) {
                        const ref = `ra${i++}`;
                        entities.set(ref, attachment);
                        lines.push(`- ${ref} = replied attachment "${attachment.name || 'unnamed'}" (${attachment.contentType || 'unknown'})`);
                    }
                }
            }
        } catch (_) {}
    }

    if (message?.channel?.messages?.fetch) {
        try {
            const recent = await message.channel.messages.fetch({ limit: 12 });
            const seen = new Set();
            let recentIndex = 1;
            for (const msg of recent.values()) {
                if (!msg?.author?.id || msg.id === message.id) continue;
                if (seen.has(msg.author.id)) continue;
                if (message.author?.id && msg.author.id === message.author.id) continue;
                if (message.client?.user?.id && msg.author.id === message.client.user.id) continue;

                let member = msg.member || guild?.members?.cache?.get?.(msg.author.id) || null;
                if (!member && guild?.members?.fetch) member = await guild.members.fetch(msg.author.id).catch(() => null);
                if (!member) continue;

                const ref = `recent${recentIndex++}`;
                entities.set(ref, member);
                lines.push(`- ${ref} = @${memberLabel(member)} (recent author: "${excerpt(msg.content)}")`);
                seen.add(msg.author.id);
                if (recentIndex > 5) break;
            }
        } catch (_) {}
    }

    return {
        text: lines.join('\n') || '- Không có Discord entity nào khả dụng.',
        entities
    };
}

export async function discord_query({ action, target, secondary_target, limit = 25, emoji, guild, channel, message, discordEntities }) {
    if (!guild) return { ok: false, code: 'GUILD_REQUIRED', message: 'Dữ liệu này chỉ có trong server Discord.' };

    const safeLimit = clampInt(limit, 1, 100, 25);
    const currentChannel = resolveEntity(discordEntities, target) || channel || message?.channel;

    try {
        switch (action) {
            case 'server_overview': {
                const { members, complete } = await fetchMembers(guild, false);
                const list = members ? [...members.values()] : [];
                const bots = list.filter(m => m?.user?.bot).length;
                const humans = list.filter(m => m?.user && !m.user.bot).length;
                return {
                    ok: true,
                    guild: {
                        name: guild.name,
                        description: guild.description || null,
                        total_members: guild.memberCount ?? list.length,
                        humans,
                        bots,
                        member_breakdown_complete: complete,
                        channels: guild.channels?.cache?.size ?? null,
                        roles: guild.roles?.cache?.size ?? null,
                        emojis: guild.emojis?.cache?.size ?? null,
                        stickers: guild.stickers?.cache?.size ?? null,
                        boosts: guild.premiumSubscriptionCount ?? 0,
                        boost_tier: guild.premiumTier ?? 0,
                        created_at: guild.createdAt?.toISOString?.() || null,
                        preferred_locale: guild.preferredLocale || null,
                        owner: guild.members?.cache?.get?.(guild.ownerId)?.displayName || null
                    }
                };
            }

            case 'list_members': {
                const { members, complete } = await fetchMembers(guild, true);
                const list = members ? [...members.values()].slice(0, safeLimit) : [];
                const refs = registerEntities(discordEntities, 'member', list, m => memberLabel(m));
                return {
                    ok: true,
                    complete,
                    count: members?.size ?? list.length,
                    shown: list.length,
                    members: list.map((m, i) => ({ ref: refs[i]?.ref, name: memberLabel(m), is_bot: Boolean(m?.user?.bot), status: statusOf(m) }))
                };
            }

            case 'online_members': {
                const { members, complete } = await fetchMembers(guild, true);
                const all = members ? [...members.values()] : [];
                const online = all.filter(m => statusOf(m) !== 'offline').slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'online', online, m => memberLabel(m));
                return {
                    ok: true,
                    complete,
                    presence_observed: all.some(m => Boolean(m?.presence)),
                    count: all.filter(m => statusOf(m) !== 'offline').length,
                    members: online.map((m, i) => ({ ref: refs[i]?.ref, name: memberLabel(m), is_bot: Boolean(m?.user?.bot), status: statusOf(m), activities: activitySummary(m) }))
                };
            }

            case 'voice_members': {
                const { members, complete } = await fetchMembers(guild, false);
                const all = members ? [...members.values()] : [];
                const inVoice = all.filter(m => Boolean(m?.voice?.channel)).slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'voice', inVoice, m => memberLabel(m));
                return {
                    ok: true,
                    complete,
                    count: all.filter(m => Boolean(m?.voice?.channel)).length,
                    members: inVoice.map((m, i) => ({
                        ref: refs[i]?.ref,
                        name: memberLabel(m),
                        is_bot: Boolean(m?.user?.bot),
                        channel: m.voice.channel?.name || null,
                        self_mute: Boolean(m.voice.selfMute),
                        self_deaf: Boolean(m.voice.selfDeaf),
                        server_mute: Boolean(m.voice.serverMute),
                        server_deaf: Boolean(m.voice.serverDeaf)
                    }))
                };
            }

            case 'member_profile': {
                const ref = target || 'author';
                const member = resolveEntity(discordEntities, ref);
                if (!member?.user) return targetRequired('Không xác định được thành viên. Hãy @mention, reply hoặc dùng entity ref hiện có.');
                return {
                    ok: true,
                    target: ref,
                    profile: memberSnapshot(member),
                    about_me: null,
                    about_me_note: 'Discord Bot API không cung cấp About Me/bio của thành viên khác như dữ liệu guild tiêu chuẩn.'
                };
            }

            case 'member_permissions': {
                const member = resolveEntity(discordEntities, target || 'author');
                if (!member?.permissions) return targetRequired('Không xác định được thành viên cần xem quyền.');
                const inChannel = resolveEntity(discordEntities, secondary_target) || channel;
                return {
                    ok: true,
                    member: memberLabel(member),
                    guild_permissions: member.permissions.toArray?.() || [],
                    channel: inChannel?.name || null,
                    channel_permissions: inChannel && member.permissionsIn ? member.permissionsIn(inChannel).toArray() : []
                };
            }

            case 'channel_overview': {
                if (!currentChannel) return targetRequired('Không xác định được kênh cần xem.');
                return { ok: true, channel: channelSnapshot(currentChannel) };
            }

            case 'channel_permissions': {
                const ch = resolveEntity(discordEntities, target) || channel;
                const subject = resolveEntity(discordEntities, secondary_target || 'bot');
                if (!ch?.permissionsFor || !subject) return targetRequired('Cần một channel và member/role hợp lệ.');
                return { ok: true, channel: ch.name || null, subject: subject?.user ? memberLabel(subject) : roleLabel(subject), permissions: ch.permissionsFor(subject)?.toArray?.() || [] };
            }

            case 'list_channels': {
                const all = [...(guild.channels?.cache?.values?.() || [])]
                    .filter(ch => !ch?.isThread?.())
                    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0));
                const shown = all.slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'channel', shown, c => channelLabel(c));
                return { ok: true, count: all.length, channels: shown.map((c, i) => ({ ref: refs[i]?.ref, ...channelSnapshot(c) })) };
            }

            case 'list_roles': {
                const all = [...(guild.roles?.cache?.values?.() || [])]
                    .filter(r => r.name !== '@everyone')
                    .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
                const shown = all.slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'role', shown, r => roleLabel(r));
                return { ok: true, count: all.length, roles: shown.map((r, i) => ({ ref: refs[i]?.ref, ...roleSnapshot(r) })) };
            }

            case 'role_overview': {
                const role = resolveEntity(discordEntities, target);
                if (!role?.permissions) return targetRequired('Không xác định được role cần xem. Hãy mention role hoặc lấy ref từ list_roles.');
                return { ok: true, role: roleSnapshot(role) };
            }

            case 'recent_messages': {
                const ch = resolveEntity(discordEntities, target) || channel;
                const messages = (await fetchRecentMessages(ch, safeLimit)).slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'msg', messages, m => messageLabel(m));
                return { ok: true, channel: ch?.name || null, messages: messages.map((m, i) => ({ ref: refs[i]?.ref, ...messageSnapshot(m) })) };
            }

            case 'pinned_messages': {
                const ch = resolveEntity(discordEntities, target) || channel;
                if (!ch?.messages?.fetchPins) return targetRequired('Kênh này không hỗ trợ đọc pin.');
                const pins = await ch.messages.fetchPins();
                const items = Array.isArray(pins?.items) ? pins.items : (pins?.values ? [...pins.values()] : []);
                const list = items.slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'pinmsg', list, m => messageLabel(m));
                return { ok: true, count: items.length, has_more: pins?.hasMore ?? null, messages: list.map((m, i) => ({ ref: refs[i]?.ref, ...messageSnapshot(m) })) };
            }

            case 'message_overview': {
                const msg = resolveEntity(discordEntities, target || 'replied_message') || resolveEntity(discordEntities, 'current_message');
                if (!msg?.author) return targetRequired('Không xác định được tin nhắn cần xem.');
                return { ok: true, message: messageSnapshot(msg) };
            }

            case 'list_emojis': {
                const collection = await guild.emojis.fetch().catch(() => guild.emojis.cache);
                const list = [...collection.values()].slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'emoji', list, e => e.name || 'emoji');
                return { ok: true, count: collection.size, emojis: list.map((e, i) => ({ ref: refs[i]?.ref, name: e.name, animated: Boolean(e.animated), available: e.available ?? null, url: e.url || null })) };
            }

            case 'list_stickers': {
                const collection = await guild.stickers.fetch().catch(() => guild.stickers.cache);
                const list = [...collection.values()].slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'sticker', list, s => s.name || 'sticker');
                return { ok: true, count: collection.size, stickers: list.map((s, i) => ({ ref: refs[i]?.ref, name: s.name, description: s.description || null, tags: s.tags || null, available: s.available ?? null, url: s.url || null })) };
            }

            case 'list_soundboard_sounds': {
                if (!guild.soundboardSounds?.fetch) return { ok: false, code: 'UNAVAILABLE', message: 'discord.js/runtime hiện tại không expose soundboard manager cho guild này.' };
                const collection = await guild.soundboardSounds.fetch().catch(() => guild.soundboardSounds.cache);
                const list = [...collection.values()].slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'sound', list, s => s.name || 'sound');
                return { ok: true, count: collection.size, sounds: list.map((s, i) => ({ ref: refs[i]?.ref, name: s.name, volume: s.volume ?? null, available: s.available ?? null, emoji: s.emoji?.name || null })) };
            }

            case 'list_bans': {
                const ownerError = await requireOwner(message);
                if (ownerError) return ownerError;
                const bans = await guild.bans.fetch();
                const list = [...bans.values()].slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'ban', list.map(b => b.user), u => u.globalName || u.username);
                return { ok: true, count: bans.size, bans: list.map((b, i) => ({ ref: refs[i]?.ref, user: b.user.globalName || b.user.username, reason: b.reason || null })) };
            }

            case 'list_invites': {
                const ownerError = await requireOwner(message);
                if (ownerError) return ownerError;
                const invites = await guild.invites.fetch();
                const list = [...invites.values()].slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'invite', list, inv => inv.code || 'invite');
                return { ok: true, count: invites.size, invites: list.map((inv, i) => ({ ref: refs[i]?.ref, code: inv.code, channel: inv.channel?.name || null, uses: inv.uses ?? null, max_uses: inv.maxUses ?? null, temporary: Boolean(inv.temporary), expires_at: inv.expiresAt?.toISOString?.() || null })) };
            }

            case 'list_scheduled_events': {
                const events = await guild.scheduledEvents.fetch();
                const list = [...events.values()].slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'event', list, e => e.name || 'event');
                return { ok: true, count: events.size, events: list.map((e, i) => ({ ref: refs[i]?.ref, name: e.name, description: e.description || null, status: e.status, entity_type: e.entityType, channel: e.channel?.name || null, location: e.entityMetadata?.location || null, starts_at: e.scheduledStartAt?.toISOString?.() || null, ends_at: e.scheduledEndAt?.toISOString?.() || null, users: e.userCount ?? null })) };
            }

            case 'list_active_threads': {
                const active = await guild.channels.fetchActiveThreads();
                const collection = active?.threads || active;
                const list = collection?.values ? [...collection.values()].slice(0, safeLimit) : [];
                const refs = registerEntities(discordEntities, 'thread', list, t => t.name || 'thread');
                return { ok: true, count: collection?.size ?? list.length, threads: list.map((t, i) => ({ ref: refs[i]?.ref, ...channelSnapshot(t), owner: t.ownerId ? guild.members.cache.get(t.ownerId)?.displayName || null : null, message_count: t.messageCount ?? null })) };
            }

            case 'thread_members': {
                const thread = resolveEntity(discordEntities, target) || (channel?.isThread?.() ? channel : null);
                if (!thread?.members?.fetch) return targetRequired('Không xác định được thread cần xem thành viên.');
                const members = await thread.members.fetch();
                const guildMembers = [];
                for (const tm of members.values()) {
                    const gm = guild.members.cache.get(tm.id) || await guild.members.fetch(tm.id).catch(() => null);
                    if (gm) guildMembers.push(gm);
                }
                const shown = guildMembers.slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'threadmember', shown, m => memberLabel(m));
                return { ok: true, count: members.size, members: shown.map((m, i) => ({ ref: refs[i]?.ref, name: memberLabel(m), is_bot: Boolean(m.user?.bot) })) };
            }

            case 'list_webhooks': {
                const ownerError = await requireOwner(message);
                if (ownerError) return ownerError;
                const webhooks = await guild.fetchWebhooks();
                const list = [...webhooks.values()].slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'webhook', list, w => w.name || 'webhook');
                return {
                    ok: true,
                    count: webhooks.size,
                    webhooks: list.map((w, i) => ({ ref: refs[i]?.ref, name: w.name, type: w.type, channel: guild.channels.cache.get(w.channelId)?.name || null, owner: w.owner?.username || null }))
                };
            }

            case 'list_automod_rules': {
                const ownerError = await requireOwner(message);
                if (ownerError) return ownerError;
                const rules = await guild.autoModerationRules.fetch();
                const list = [...rules.values()].slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'automod', list, r => r.name || 'automod');
                return { ok: true, count: rules.size, rules: list.map((r, i) => ({ ref: refs[i]?.ref, name: r.name, enabled: r.enabled, trigger_type: r.triggerType, event_type: r.eventType, actions: r.actions?.map(a => ({ type: a.type, metadata: a.metadata || null })) || [] })) };
            }

            case 'channel_overwrites': {
                const ch = resolveEntity(discordEntities, target) || channel;
                if (!ch?.permissionOverwrites?.cache) return targetRequired('Kênh này không có permission overwrites.');
                const items = [...ch.permissionOverwrites.cache.values()].slice(0, safeLimit).map(ow => {
                    const member = guild.members.cache.get(ow.id);
                    const role = guild.roles.cache.get(ow.id);
                    return {
                        subject: member ? `@${memberLabel(member)}` : (role ? `@${roleLabel(role)}` : 'Unknown'),
                        subject_type: member ? 'member' : (role ? 'role' : 'unknown'),
                        allow: ow.allow?.toArray?.() || [],
                        deny: ow.deny?.toArray?.() || []
                    };
                });
                return { ok: true, channel: ch.name || null, count: ch.permissionOverwrites.cache.size, overwrites: items };
            }

            case 'role_members': {
                const role = resolveEntity(discordEntities, target);
                if (!role?.members) return targetRequired('Hãy mention role hoặc lấy roleN từ list_roles.');
                const all = [...role.members.values()];
                const shown = all.slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'rolemember', shown, m => memberLabel(m));
                return { ok: true, role: role.name, count: all.length, members: shown.map((m, i) => ({ ref: refs[i]?.ref, name: memberLabel(m), is_bot: Boolean(m.user?.bot), status: statusOf(m) })) };
            }

            case 'reaction_users': {
                const msg = resolveEntity(discordEntities, target || 'replied_message') || resolveEntity(discordEntities, 'current_message');
                if (!msg?.reactions?.cache) return targetRequired('Không xác định được tin nhắn cần xem reaction.');
                const reaction = findReaction(msg, emoji);
                if (!reaction) return { ok: false, code: 'REACTION_NOT_FOUND', message: 'Không tìm thấy reaction phù hợp trên tin nhắn.' };
                const users = await reaction.users.fetch({ limit: safeLimit });
                const values = [];
                for (const user of users.values()) {
                    values.push(guild.members.cache.get(user.id) || user);
                }
                const refs = registerEntities(discordEntities, 'reactionuser', values, v => memberLabel(v));
                return { ok: true, emoji: reaction.emoji?.toString?.() || reaction.emoji?.name || null, count: reaction.count ?? users.size, users: values.map((v, i) => ({ ref: refs[i]?.ref, name: memberLabel(v), is_bot: Boolean(v?.user?.bot ?? v?.bot) })) };
            }

            case 'forum_tags': {
                const ch = resolveEntity(discordEntities, target) || channel;
                if (!Array.isArray(ch?.availableTags)) return targetRequired('Kênh này không phải Forum/Media channel có tag.');
                return { ok: true, channel: ch.name || null, tags: ch.availableTags.map(t => ({ name: t.name, moderated: Boolean(t.moderated), emoji: t.emoji?.name || t.emoji?.id || null })) };
            }

            case 'scheduled_event_subscribers': {
                const event = resolveEntity(discordEntities, target);
                if (!event?.fetchSubscribers) return targetRequired('Hãy lấy eventN từ list_scheduled_events.');
                const subscribers = await event.fetchSubscribers({ limit: safeLimit, withMember: true });
                const list = [...subscribers.values()];
                const entities = list.map(x => x?.member || guild.members.cache.get(x?.user?.id) || x?.user).filter(Boolean);
                const refs = registerEntities(discordEntities, 'eventuser', entities, x => memberLabel(x));
                return { ok: true, event: event.name, count: subscribers.size, subscribers: entities.map((x, i) => ({ ref: refs[i]?.ref, name: memberLabel(x), is_bot: Boolean(x?.user?.bot ?? x?.bot) })) };
            }

            case 'list_archived_threads': {
                const ch = resolveEntity(discordEntities, target) || channel;
                if (!ch?.threads?.fetchArchived) return targetRequired('Kênh này không hỗ trợ đọc archived threads.');
                const result = await ch.threads.fetchArchived({ limit: safeLimit });
                const collection = result?.threads;
                const list = collection?.values ? [...collection.values()].slice(0, safeLimit) : [];
                const refs = registerEntities(discordEntities, 'archivedthread', list, t => t.name || 'thread');
                return { ok: true, count: collection?.size ?? list.length, has_more: result?.hasMore ?? null, threads: list.map((t, i) => ({ ref: refs[i]?.ref, ...channelSnapshot(t), message_count: t.messageCount ?? null })) };
            }

            case 'list_integrations': {
                const ownerError = await requireOwner(message);
                if (ownerError) return ownerError;
                const integrations = await guild.fetchIntegrations();
                const list = [...integrations.values()].slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'integration', list, x => x.name || 'integration');
                return { ok: true, count: integrations.size, integrations: list.map((x, i) => ({ ref: refs[i]?.ref, name: x.name || null, type: x.type || null, enabled: x.enabled ?? null, syncing: x.syncing ?? null, subscriber_count: x.subscriberCount ?? null })) };
            }

            case 'list_commands': {
                const commands = await guild.commands.fetch();
                const list = [...commands.values()].slice(0, safeLimit);
                const refs = registerEntities(discordEntities, 'command', list, x => x.name || 'command');
                return { ok: true, count: commands.size, commands: list.map((x, i) => ({ ref: refs[i]?.ref, name: x.name, description: x.description || null, type: x.type, dm_permission: x.dmPermission ?? null })) };
            }

            case 'server_vanity': {
                const ownerError = await requireOwner(message);
                if (ownerError) return ownerError;
                const vanity = await guild.fetchVanityData();
                return { ok: true, code: vanity?.code || null, uses: vanity?.uses ?? null };
            }

            case 'welcome_screen': {
                const screen = await guild.fetchWelcomeScreen();
                return { ok: true, description: screen?.description || null, channels: screen?.welcomeChannels?.map?.(x => ({ description: x.description || null, emoji: x.emoji?.name || x.emoji?.id || null, channel: guild.channels.cache.get(x.channelId)?.name || null })) || [] };
            }

            case 'bot_profile': {
                const user = message.client?.user;
                if (!user) return { ok: false, code: 'BOT_UNAVAILABLE', message: 'Không đọc được bot user hiện tại.' };
                return { ok: true, username: user.username, global_name: user.globalName || null, avatar_url: user.displayAvatarURL?.({ size: 512 }) || null, banner_url: user.bannerURL?.({ size: 1024 }) || null, status: guild.members.me?.presence?.status || null, activities: activitySummary(guild.members.me) };
            }

            case 'audit_log_recent': {
                const ownerError = await requireOwner(message);
                if (ownerError) return ownerError;
                const logs = await guild.fetchAuditLogs({ limit: Math.min(safeLimit, 50) });
                const entries = [...logs.entries.values()].slice(0, safeLimit);
                return {
                    ok: true,
                    count: entries.length,
                    entries: entries.map(e => ({ action: e.action, action_type: e.actionType || null, executor: e.executor?.username || null, target_type: e.targetType || null, reason: e.reason || null, created_at: e.createdAt?.toISOString?.() || null }))
                };
            }

            case 'bot_permissions': {
                const bot = guild.members.me || await guild.members.fetchMe();
                const ch = resolveEntity(discordEntities, target) || channel;
                return {
                    ok: true,
                    guild_permissions: bot.permissions?.toArray?.() || [],
                    channel: ch?.name || null,
                    channel_permissions: ch?.permissionsFor ? ch.permissionsFor(bot)?.toArray?.() || [] : []
                };
            }

            default:
                return { ok: false, code: 'UNSUPPORTED_ACTION', message: `Discord query không hỗ trợ action: ${action}` };
        }
    } catch (error) {
        return { ok: false, code: String(error?.code || 'DISCORD_QUERY_ERROR'), message: error?.message || 'Không lấy được dữ liệu Discord.' };
    }
}

export async function discord_action(args) {
    const {
        action,
        target,
        secondary_target,
        name,
        nickname,
        content,
        description,
        topic,
        reason,
        emoji,
        color,
        count = 1,
        duration_minutes,
        delete_message_seconds,
        slowmode_seconds,
        bitrate,
        user_limit,
        position,
        max_age_seconds,
        max_uses,
        temporary,
        unique,
        enabled,
        hoist,
        mentionable,
        nsfw,
        attachment_target,
        tags,
        volume,
        start_time,
        end_time,
        location,
        poll_question,
        poll_answers,
        poll_duration_hours,
        keywords,
        permissions,
        allow_permissions,
        deny_permissions,
        clear_permissions,
        auto_archive_minutes,
        afk_timeout_seconds,
        status,
        activity,
        activity_type,
        forum_tags,
        custom_message,
        mention_total_limit,
        guild,
        channel,
        message,
        discordEntities
    } = args;

    if (!guild || !message) return { ok: false, code: 'GUILD_REQUIRED', message: 'Thao tác này chỉ dùng trong server Discord.', reply: 'Cái này chỉ làm được trong server Discord thôi nha.' };

    const ownerError = await requireOwner(message);
    if (ownerError) return ownerError;

    const actor = message.author?.username || 'owner';
    const auditReason = String(reason || `Requested by ${actor}`).slice(0, 512);
    const entity = ref => resolveEntity(discordEntities, ref);
    const current = entity('current_channel') || channel || message.channel;
    const replied = entity('replied_message');
    const safeCount = clampInt(count, 1, 100, 1);

    try {
        switch (action) {
            // ---- Message actions ----
            case 'send_message': {
                const ch = entity(target) || current;
                if (!ch?.send) return targetRequired('Kênh đích không gửi được tin nhắn.');
                const text = String(content || '').trim();
                if (!text) return { ok: false, code: 'CONTENT_REQUIRED', message: 'Thiếu nội dung tin nhắn.', reply: 'Bạn chưa đưa nội dung cần gửi.' };
                const sent = await ch.send({ content: text.slice(0, 2000), allowedMentions: { parse: [] } });
                discordEntities?.set?.('sent_message', sent);
                return success(action, `Mình đã gửi tin vào **${ch.name || 'kênh đó'}** rồi.`, { target_channel: ch.name || null });
            }

            case 'reply_replied_message': {
                if (!replied?.reply) return targetRequired('Bạn hãy reply đúng tin nhắn cần trả lời.');
                const text = String(content || '').trim();
                if (!text) return { ok: false, code: 'CONTENT_REQUIRED', message: 'Thiếu nội dung.', reply: 'Bạn chưa đưa nội dung cần trả lời.' };
                const sent = await replied.reply({ content: text.slice(0, 2000), allowedMentions: { parse: [] } });
                discordEntities?.set?.('sent_message', sent);
                return success(action, 'Mình đã trả lời tin nhắn đó rồi.');
            }

            case 'edit_replied_bot_message': {
                if (!replied?.edit || replied.author?.id !== message.client.user?.id) return targetRequired('Hãy reply một tin nhắn do Dolia gửi để sửa.');
                const text = String(content || '').trim();
                if (!text) return { ok: false, code: 'CONTENT_REQUIRED', message: 'Thiếu nội dung mới.', reply: 'Bạn chưa đưa nội dung mới.' };
                await replied.edit(text.slice(0, 2000));
                return success(action, 'Mình đã sửa tin nhắn đó rồi.');
            }

            case 'delete_replied_message': {
                if (!replied?.delete) return targetRequired('Bạn hãy reply đúng tin nhắn cần xóa.');
                const who = memberLabel(replied.member || replied.author);
                await replied.delete();
                return success(action, `Đã xóa tin nhắn của **${who}**.`, { deleted: 1 });
            }

            case 'delete_recent_from': {
                const member = entity(target);
                if (!member?.id) return targetRequired('Không xác định được người có tin cần xóa. Hãy @mention, reply hoặc dùng recentN.');
                const recent = await fetchRecentMessages(current, 100);
                const candidates = recent
                    .filter(msg => msg?.id !== message.id && msg?.author?.id === member.id && msg?.deletable !== false)
                    .sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0))
                    .slice(0, Math.min(safeCount, 20));
                let deleted = 0;
                for (const msg of candidates) {
                    try { await msg.delete(); deleted++; } catch (_) {}
                }
                if (!deleted) return { ok: false, code: 'NO_MESSAGES_FOUND', message: 'Không tìm thấy tin phù hợp để xóa.', reply: `Mình không tìm thấy tin gần đây của **${memberLabel(member)}** có thể xóa.` };
                return success(action, `Đã xóa **${deleted}** tin gần nhất của **${memberLabel(member)}**.`, { deleted, target: memberLabel(member) });
            }

            case 'bulk_delete_recent': {
                if (!current?.bulkDelete) return targetRequired('Kênh này không hỗ trợ xóa hàng loạt.');
                const amount = Math.min(safeCount, 100);
                const deleted = await current.bulkDelete(amount, true);
                return success(action, `Đã xóa **${deleted.size}** tin nhắn gần đây trong **${current.name || 'kênh này'}**.`, { deleted: deleted.size });
            }

            case 'react_replied_message': {
                if (!replied?.react) return targetRequired('Bạn hãy reply tin nhắn cần thả reaction.');
                if (!emoji) return { ok: false, code: 'EMOJI_REQUIRED', message: 'Thiếu emoji.', reply: 'Bạn chưa đưa emoji cần thả.' };
                await replied.react(String(emoji).trim());
                return success(action, `Đã thả ${String(emoji).trim()} vào tin đó.`);
            }

            case 'remove_bot_reaction_replied': {
                if (!replied?.reactions?.cache) return targetRequired('Bạn hãy reply tin nhắn có reaction cần gỡ.');
                const wanted = String(emoji || '').trim();
                const reaction = [...replied.reactions.cache.values()].find(r => r.emoji?.name === wanted || r.emoji?.id === wanted || r.emoji?.toString?.() === wanted);
                if (!reaction) return { ok: false, code: 'REACTION_NOT_FOUND', message: 'Không thấy reaction đó.', reply: 'Mình không thấy reaction đó trên tin nhắn.' };
                await reaction.users.remove(message.client.user.id);
                return success(action, `Đã gỡ reaction ${wanted} của mình khỏi tin đó.`);
            }

            case 'clear_reactions_replied': {
                if (!replied?.reactions?.removeAll) return targetRequired('Bạn hãy reply tin nhắn cần xóa reaction.');
                await replied.reactions.removeAll();
                return success(action, 'Đã xóa toàn bộ reaction trên tin nhắn đó.');
            }

            case 'pin_replied_message': {
                if (!replied?.pin) return targetRequired('Bạn hãy reply tin cần ghim.');
                await replied.pin(auditReason);
                return success(action, 'Đã ghim tin nhắn đó.');
            }

            case 'unpin_replied_message': {
                if (!replied?.unpin) return targetRequired('Bạn hãy reply tin cần bỏ ghim.');
                await replied.unpin(auditReason);
                return success(action, 'Đã bỏ ghim tin nhắn đó.');
            }

            case 'suppress_embeds_replied':
            case 'unsuppress_embeds_replied': {
                if (!replied?.suppressEmbeds) return targetRequired('Bạn hãy reply tin nhắn cần chỉnh embed.');
                const suppress = action === 'suppress_embeds_replied';
                await replied.suppressEmbeds(suppress);
                return success(action, suppress ? 'Đã ẩn embed của tin nhắn đó.' : 'Đã hiện lại embed của tin nhắn đó.');
            }

            case 'crosspost_replied_message': {
                if (!replied?.crosspost) return targetRequired('Tin nhắn này không hỗ trợ crosspost.');
                await replied.crosspost();
                return success(action, 'Đã publish/crosspost tin nhắn đó.');
            }

            case 'forward_replied_message': {
                const ch = entity(target);
                if (!replied?.forward || !ch) return targetRequired('Cần reply tin nguồn và mention/kết quả query một kênh đích.');
                await replied.forward(ch);
                return success(action, `Đã chuyển tiếp tin nhắn sang **${ch.name || 'kênh đích'}**.`);
            }

            case 'send_poll': {
                const ch = entity(target) || current;
                if (!ch?.send) return targetRequired('Kênh đích không gửi được poll.');
                const question = String(poll_question || '').trim();
                const answers = Array.isArray(poll_answers) ? poll_answers.map(x => String(x).trim()).filter(Boolean).slice(0, 10) : [];
                if (!question || answers.length < 2) return { ok: false, code: 'POLL_DATA_REQUIRED', message: 'Poll cần câu hỏi và ít nhất 2 đáp án.', reply: 'Poll cần câu hỏi và ít nhất 2 lựa chọn nha.' };
                await ch.send({
                    poll: {
                        question: { text: question.slice(0, 300) },
                        answers: answers.map(text => ({ text: text.slice(0, 55) })),
                        duration: clampInt(poll_duration_hours, 1, 768, 24),
                        allowMultiselect: Boolean(enabled)
                    }
                });
                return success(action, `Đã tạo poll **${question.slice(0, 80)}**.`);
            }

            // ---- Member / moderation / voice ----
            case 'set_nickname':
            case 'clear_nickname': {
                const member = entity(target || 'bot');
                if (!member?.setNickname) return targetRequired('Không xác định được thành viên cần đổi biệt danh.');
                const next = action === 'clear_nickname' ? null : String(nickname || name || '').trim().slice(0, 32);
                if (action === 'set_nickname' && !next) return { ok: false, code: 'NICKNAME_REQUIRED', message: 'Thiếu biệt danh mới.', reply: 'Bạn chưa đưa biệt danh mới.' };
                await member.setNickname(next, auditReason);
                return success(action, next ? `Đã đổi biệt danh của **${memberLabel(member)}** thành **${next}**.` : `Đã xóa biệt danh của **${memberLabel(member)}**.`);
            }

            case 'timeout':
            case 'clear_timeout': {
                const member = entity(target);
                if (!member?.timeout) return targetRequired('Không xác định được thành viên cần timeout.');
                const ms = action === 'clear_timeout' ? null : clampInt(duration_minutes, 1, 40320, 10) * 60_000;
                await member.timeout(ms, auditReason);
                return success(action, action === 'clear_timeout' ? `Đã gỡ timeout cho **${memberLabel(member)}**.` : `Đã timeout **${memberLabel(member)}** trong **${Math.round(ms / 60000)} phút**.`);
            }

            case 'disconnect_voice': {
                const member = entity(target || 'author');
                if (!member?.voice) return targetRequired('Không xác định được thành viên cần ngắt voice.');
                if (!member.voice.channel) return { ok: false, code: 'NOT_IN_VOICE', message: 'Thành viên không ở voice.', reply: `**${memberLabel(member)}** hiện không ở kênh thoại.` };
                await member.voice.disconnect(auditReason);
                return success(action, `Đã ngắt **${memberLabel(member)}** khỏi kênh thoại.`);
            }

            case 'move_voice': {
                const member = entity(target);
                const ch = entity(secondary_target);
                if (!member?.voice || !ch?.isVoiceBased?.()) return targetRequired('Cần một thành viên và một kênh thoại hợp lệ.');
                await member.voice.setChannel(ch, auditReason);
                return success(action, `Đã chuyển **${memberLabel(member)}** sang **${ch.name}**.`);
            }

            case 'voice_mute':
            case 'voice_unmute':
            case 'voice_deafen':
            case 'voice_undeafen': {
                const member = entity(target);
                if (!member?.voice) return targetRequired('Không xác định được thành viên trong voice.');
                if (action === 'voice_mute' || action === 'voice_unmute') await member.voice.setMute(action === 'voice_mute', auditReason);
                else await member.voice.setDeaf(action === 'voice_deafen', auditReason);
                const labels = {
                    voice_mute: 'server mute', voice_unmute: 'bỏ server mute', voice_deafen: 'server deafen', voice_undeafen: 'bỏ server deafen'
                };
                return success(action, `Đã ${labels[action]} **${memberLabel(member)}**.`);
            }

            case 'add_role':
            case 'remove_role': {
                const member = entity(target);
                const role = entity(secondary_target);
                if (!member?.roles || !role?.name) return targetRequired('Cần một thành viên và một role hợp lệ.');
                if (action === 'add_role') await member.roles.add(role, auditReason);
                else await member.roles.remove(role, auditReason);
                return success(action, `${action === 'add_role' ? 'Đã thêm' : 'Đã gỡ'} role **${role.name}** ${action === 'add_role' ? 'cho' : 'khỏi'} **${memberLabel(member)}**.`);
            }

            case 'kick': {
                const member = entity(target);
                if (!member?.kick) return targetRequired('Hãy @mention người cần kick trong cùng yêu cầu.');
                if (member.id === message.author.id) return { ok: false, code: 'SELF_KICK_BLOCKED', message: 'Không tự kick người gọi bằng action kick.', reply: 'Muốn tự rời server thì Discord có nút Leave Server, khỏi bắt mình đóng vai bảo vệ.' };
                await member.kick(auditReason);
                return success(action, `Đã kick **${memberLabel(member)}** khỏi server.`);
            }

            case 'ban': {
                const member = entity(target);
                if (!member?.ban) return targetRequired('Hãy @mention người cần ban trong cùng yêu cầu.');
                if (member.id === message.author.id) return { ok: false, code: 'SELF_BAN_BLOCKED', message: 'Không tự ban người gọi.', reply: 'Mình không tự ban chính người ra lệnh đâu.' };
                const secs = clampInt(delete_message_seconds, 0, 604800, 0);
                await member.ban({ reason: auditReason, deleteMessageSeconds: secs });
                return success(action, `Đã ban **${memberLabel(member)}** khỏi server.`);
            }

            case 'unban': {
                const user = entity(target);
                if (!user?.id) return targetRequired('Hãy dùng banN từ `list_bans` để chọn người cần unban.');
                await guild.bans.remove(user, auditReason);
                return success(action, `Đã gỡ ban cho **${memberLabel(user)}**.`);
            }

            case 'dm_member': {
                const member = entity(target);
                if (!member?.send) return targetRequired('Không xác định được thành viên cần nhắn riêng.');
                const text = String(content || '').trim();
                if (!text) return { ok: false, code: 'CONTENT_REQUIRED', message: 'Thiếu nội dung DM.', reply: 'Bạn chưa đưa nội dung cần nhắn riêng.' };
                await member.send({ content: text.slice(0, 2000), allowedMentions: { parse: [] } });
                return success(action, `Đã nhắn riêng cho **${memberLabel(member)}**.`);
            }

            // ---- Channel / thread ----
            case 'create_text_channel':
            case 'create_voice_channel':
            case 'create_category':
            case 'create_announcement_channel':
            case 'create_stage_channel':
            case 'create_forum_channel': {
                const typeMap = {
                    create_text_channel: ChannelType.GuildText,
                    create_voice_channel: ChannelType.GuildVoice,
                    create_category: ChannelType.GuildCategory,
                    create_announcement_channel: ChannelType.GuildAnnouncement,
                    create_stage_channel: ChannelType.GuildStageVoice,
                    create_forum_channel: ChannelType.GuildForum
                };
                const parent = entity(secondary_target);
                const channelName = String(name || '').trim();
                if (!channelName) return { ok: false, code: 'NAME_REQUIRED', message: 'Thiếu tên kênh.', reply: 'Bạn chưa đưa tên kênh mới.' };
                const created = await guild.channels.create({
                    name: channelName.slice(0, 100),
                    type: typeMap[action],
                    parent: parent?.id || undefined,
                    topic: topic ? String(topic).slice(0, 1024) : undefined,
                    nsfw: nsfw === undefined ? undefined : Boolean(nsfw),
                    reason: auditReason
                });
                discordEntities?.set?.('created_channel', created);
                return success(action, `Đã tạo kênh **${created.name}**.`);
            }

            case 'rename_channel': {
                const ch = entity(target) || current;
                if (!ch?.setName) return targetRequired('Không xác định được kênh cần đổi tên.');
                const next = String(name || '').trim().slice(0, 100);
                if (!next) return { ok: false, code: 'NAME_REQUIRED', message: 'Thiếu tên mới.', reply: 'Bạn chưa đưa tên mới cho kênh.' };
                await ch.setName(next, auditReason);
                return success(action, `Đã đổi tên kênh thành **${next}**.`);
            }

            case 'set_channel_topic': {
                const ch = entity(target) || current;
                if (!ch?.edit) return targetRequired('Kênh này không chỉnh topic được.');
                await ch.edit({ topic: String(topic ?? content ?? '').slice(0, 1024), reason: auditReason });
                return success(action, 'Đã cập nhật topic của kênh.');
            }

            case 'set_channel_slowmode': {
                const ch = entity(target) || current;
                if (!ch?.setRateLimitPerUser) return targetRequired('Kênh này không hỗ trợ slowmode.');
                const seconds = clampInt(slowmode_seconds, 0, 21600, 0);
                await ch.setRateLimitPerUser(seconds, auditReason);
                return success(action, seconds ? `Đã đặt slowmode **${seconds} giây**.` : 'Đã tắt slowmode.');
            }

            case 'set_channel_nsfw': {
                const ch = entity(target) || current;
                if (!ch?.setNSFW) return targetRequired('Kênh này không hỗ trợ NSFW flag.');
                await ch.setNSFW(Boolean(nsfw ?? enabled), auditReason);
                return success(action, `Đã ${Boolean(nsfw ?? enabled) ? 'bật' : 'tắt'} NSFW cho **${ch.name}**.`);
            }

            case 'set_channel_parent': {
                const ch = entity(target) || current;
                const parent = entity(secondary_target);
                if (!ch?.setParent || !parent) return targetRequired('Cần channel và category hợp lệ.');
                await ch.setParent(parent, { lockPermissions: false, reason: auditReason });
                return success(action, `Đã chuyển **${ch.name}** vào category **${parent.name}**.`);
            }

            case 'set_voice_bitrate': {
                const ch = entity(target) || current;
                if (!ch?.setBitrate) return targetRequired('Đây không phải kênh thoại có thể chỉnh bitrate.');
                await ch.setBitrate(clampInt(bitrate, 8000, 384000, 64000), auditReason);
                return success(action, `Đã chỉnh bitrate của **${ch.name}**.`);
            }

            case 'set_voice_user_limit': {
                const ch = entity(target) || current;
                if (!ch?.setUserLimit) return targetRequired('Đây không phải kênh thoại có user limit.');
                const n = clampInt(user_limit, 0, 99, 0);
                await ch.setUserLimit(n, auditReason);
                return success(action, n ? `Đã giới hạn **${n} người** trong **${ch.name}**.` : `Đã bỏ giới hạn người dùng trong **${ch.name}**.`);
            }

            case 'lock_channel':
            case 'unlock_channel':
            case 'hide_channel':
            case 'show_channel': {
                const ch = entity(target) || current;
                if (!ch?.permissionOverwrites?.edit) return targetRequired('Kênh này không chỉnh permission overwrite được.');
                const everyone = guild.roles.everyone;
                const permission = action.includes('hide') || action.includes('show') ? 'ViewChannel' : 'SendMessages';
                const value = (action === 'lock_channel' || action === 'hide_channel') ? false : null;
                await ch.permissionOverwrites.edit(everyone, { [permission]: value }, { reason: auditReason });
                const text = {
                    lock_channel: 'Đã khóa quyền gửi tin của @everyone trong kênh.',
                    unlock_channel: 'Đã trả quyền gửi tin của kênh về chế độ kế thừa.',
                    hide_channel: 'Đã ẩn kênh với @everyone.',
                    show_channel: 'Đã trả quyền xem kênh về chế độ kế thừa.'
                }[action];
                return success(action, text);
            }

            case 'clone_channel': {
                const ch = entity(target) || current;
                if (!ch?.clone) return targetRequired('Kênh này không clone được.');
                const cloned = await ch.clone({ name: name ? String(name).slice(0, 100) : undefined, reason: auditReason });
                discordEntities?.set?.('created_channel', cloned);
                return success(action, `Đã clone kênh thành **${cloned.name}**.`);
            }

            case 'delete_channel': {
                const ch = entity(target) || current;
                if (!ch?.delete) return targetRequired('Không xác định được kênh cần xóa.');
                const chName = ch.name || 'kênh';
                await ch.delete(auditReason);
                return success(action, `Đã xóa **${chName}**.`);
            }

            case 'create_invite': {
                const ch = entity(target) || current;
                if (!ch?.createInvite) return targetRequired('Kênh này không tạo invite được.');
                const invite = await ch.createInvite({
                    maxAge: clampInt(max_age_seconds, 0, 604800, 86400),
                    maxUses: clampInt(max_uses, 0, 100, 0),
                    temporary: Boolean(temporary),
                    unique: unique === undefined ? true : Boolean(unique),
                    reason: auditReason
                });
                discordEntities?.set?.('created_invite', invite);
                return success(action, `Đã tạo invite: ${invite.url}`, { invite_url: invite.url });
            }

            case 'delete_invite': {
                const invite = entity(target);
                if (!invite?.delete) return targetRequired('Hãy dùng inviteN từ list_invites để chọn invite cần xóa.');
                await invite.delete(auditReason);
                return success(action, 'Đã xóa invite đó.');
            }

            case 'create_thread': {
                const ch = entity(target) || current;
                if (!ch?.threads?.create) return targetRequired('Kênh này không tạo thread được.');
                const threadName = String(name || '').trim();
                if (!threadName) return { ok: false, code: 'NAME_REQUIRED', message: 'Thiếu tên thread.', reply: 'Bạn chưa đưa tên thread.' };
                const thread = await ch.threads.create({ name: threadName.slice(0, 100), reason: auditReason });
                discordEntities?.set?.('created_thread', thread);
                return success(action, `Đã tạo thread **${thread.name}**.`);
            }

            case 'create_thread_from_replied': {
                if (!replied?.startThread) return targetRequired('Hãy reply tin nhắn cần mở thread.');
                const threadName = String(name || '').trim();
                if (!threadName) return { ok: false, code: 'NAME_REQUIRED', message: 'Thiếu tên thread.', reply: 'Bạn chưa đưa tên thread.' };
                const thread = await replied.startThread({ name: threadName.slice(0, 100), reason: auditReason });
                discordEntities?.set?.('created_thread', thread);
                return success(action, `Đã mở thread **${thread.name}** từ tin nhắn đó.`);
            }

            case 'rename_thread':
            case 'archive_thread':
            case 'unarchive_thread':
            case 'lock_thread':
            case 'unlock_thread': {
                const thread = entity(target) || (current?.isThread?.() ? current : null);
                if (!thread?.isThread?.()) return targetRequired('Không xác định được thread cần thao tác.');
                if (action === 'rename_thread') await thread.setName(String(name || '').trim().slice(0, 100), auditReason);
                if (action === 'archive_thread') await thread.setArchived(true, auditReason);
                if (action === 'unarchive_thread') await thread.setArchived(false, auditReason);
                if (action === 'lock_thread') await thread.setLocked(true, auditReason);
                if (action === 'unlock_thread') await thread.setLocked(false, auditReason);
                return success(action, `Đã cập nhật thread **${thread.name}**.`);
            }

            case 'add_thread_member':
            case 'remove_thread_member': {
                const thread = entity(target) || (current?.isThread?.() ? current : null);
                const member = entity(secondary_target);
                if (!thread?.members || !member?.id) return targetRequired('Cần một thread và member hợp lệ.');
                if (action === 'add_thread_member') await thread.members.add(member.id);
                else await thread.members.remove(member.id);
                return success(action, `${action === 'add_thread_member' ? 'Đã thêm' : 'Đã gỡ'} **${memberLabel(member)}** ${action === 'add_thread_member' ? 'vào' : 'khỏi'} thread **${thread.name}**.`);
            }

            // ---- Roles ----
            case 'create_role': {
                const roleName = String(name || '').trim();
                if (!roleName) return { ok: false, code: 'NAME_REQUIRED', message: 'Thiếu tên role.', reply: 'Bạn chưa đưa tên role.' };
                const role = await guild.roles.create({
                    name: roleName.slice(0, 100),
                    color: color || undefined,
                    hoist: Boolean(hoist),
                    mentionable: Boolean(mentionable),
                    reason: auditReason
                });
                discordEntities?.set?.('created_role', role);
                return success(action, `Đã tạo role **${role.name}**.`);
            }

            case 'rename_role':
            case 'set_role_color':
            case 'set_role_hoist':
            case 'set_role_mentionable':
            case 'set_role_position': {
                const role = entity(target);
                if (!role?.edit) return targetRequired('Hãy mention role hoặc lấy roleN từ list_roles.');
                if (action === 'rename_role') await role.setName(String(name || '').trim().slice(0, 100), auditReason);
                if (action === 'set_role_color') await role.setColor(color || '#000000', auditReason);
                if (action === 'set_role_hoist') await role.setHoist(Boolean(hoist ?? enabled), auditReason);
                if (action === 'set_role_mentionable') await role.setMentionable(Boolean(mentionable ?? enabled), auditReason);
                if (action === 'set_role_position') await role.setPosition(clampInt(position, 1, 250, role.position || 1), { reason: auditReason });
                return success(action, `Đã cập nhật role **${role.name}**.`);
            }

            case 'delete_role': {
                const role = entity(target);
                if (!role?.delete) return targetRequired('Hãy mention role hoặc lấy roleN từ list_roles.');
                const roleName = role.name;
                await role.delete(auditReason);
                return success(action, `Đã xóa role **${roleName}**.`);
            }

            // ---- Guild/assets/events/automod ----
            case 'rename_server': {
                const next = String(name || '').trim().slice(0, 100);
                if (!next) return { ok: false, code: 'NAME_REQUIRED', message: 'Thiếu tên server mới.', reply: 'Bạn chưa đưa tên server mới.' };
                await guild.setName(next, auditReason);
                return success(action, `Đã đổi tên server thành **${next}**.`);
            }

            case 'set_server_description': {
                await guild.edit({ description: String(description ?? content ?? '').slice(0, 120), reason: auditReason });
                return success(action, 'Đã cập nhật phần mô tả server.');
            }

            case 'create_emoji': {
                const att = entity(attachment_target || 'a1');
                if (!att?.url) return targetRequired('Hãy gửi kèm ảnh và dùng attachment ref a1/ra1.');
                const emojiName = String(name || '').trim().slice(0, 32);
                if (!emojiName) return { ok: false, code: 'NAME_REQUIRED', message: 'Thiếu tên emoji.', reply: 'Bạn chưa đưa tên emoji.' };
                const data = await attachmentBuffer(att);
                const created = await guild.emojis.create({ attachment: data, name: emojiName, reason: auditReason });
                discordEntities?.set?.('created_emoji', created);
                return success(action, `Đã tạo emoji **:${created.name}:**.`);
            }

            case 'rename_emoji': {
                const em = entity(target);
                if (!em?.edit) return targetRequired('Hãy mention custom emoji hoặc lấy emojiN từ list_emojis.');
                const updated = await em.edit({ name: String(name || '').trim().slice(0, 32), reason: auditReason });
                return success(action, `Đã đổi tên emoji thành **:${updated.name}:**.`);
            }

            case 'delete_emoji': {
                const em = entity(target);
                if (!em?.delete) return targetRequired('Hãy mention custom emoji hoặc lấy emojiN từ list_emojis.');
                const oldName = em.name;
                await em.delete(auditReason);
                return success(action, `Đã xóa emoji **:${oldName}:**.`);
            }

            case 'create_sticker': {
                const att = entity(attachment_target || 'a1');
                if (!att?.url) return targetRequired('Hãy gửi kèm ảnh sticker và dùng attachment ref a1/ra1.');
                const stickerName = String(name || '').trim().slice(0, 30);
                const stickerTags = String(tags || emoji || '🙂').trim().slice(0, 200);
                if (!stickerName) return { ok: false, code: 'NAME_REQUIRED', message: 'Thiếu tên sticker.', reply: 'Bạn chưa đưa tên sticker.' };
                const data = await attachmentBuffer(att);
                const sticker = await guild.stickers.create({ file: data, name: stickerName, tags: stickerTags, description: description ? String(description).slice(0, 100) : null, reason: auditReason });
                discordEntities?.set?.('created_sticker', sticker);
                return success(action, `Đã tạo sticker **${sticker.name}**.`);
            }

            case 'edit_sticker': {
                const sticker = entity(target);
                if (!sticker?.edit) return targetRequired('Hãy lấy stickerN từ list_stickers.');
                const updated = await sticker.edit({
                    name: name ? String(name).slice(0, 30) : undefined,
                    description: description === undefined ? undefined : String(description).slice(0, 100),
                    tags: tags ? String(tags).slice(0, 200) : undefined,
                    reason: auditReason
                });
                return success(action, `Đã cập nhật sticker **${updated.name}**.`);
            }

            case 'delete_sticker': {
                const sticker = entity(target);
                if (!sticker?.delete) return targetRequired('Hãy lấy stickerN từ list_stickers.');
                const oldName = sticker.name;
                await sticker.delete(auditReason);
                return success(action, `Đã xóa sticker **${oldName}**.`);
            }

            case 'create_soundboard_sound': {
                const att = entity(attachment_target || 'a1');
                if (!att?.url || !guild.soundboardSounds?.create) return targetRequired('Cần file âm thanh đính kèm và guild hỗ trợ soundboard manager.');
                const data = await attachmentBuffer(att);
                const sound = await guild.soundboardSounds.create({ file: data, name: String(name || 'Dolia sound').slice(0, 32), volume: Math.min(Math.max(Number(volume ?? 1), 0), 1), reason: auditReason });
                discordEntities?.set?.('created_sound', sound);
                return success(action, `Đã tạo soundboard **${sound.name}**.`);
            }

            case 'edit_soundboard_sound': {
                const sound = entity(target);
                if (!sound?.edit) return targetRequired('Hãy lấy soundN từ list_soundboard_sounds.');
                const updated = await sound.edit({ name: name ? String(name).slice(0, 32) : undefined, volume: volume === undefined ? undefined : Math.min(Math.max(Number(volume), 0), 1), reason: auditReason });
                return success(action, `Đã cập nhật soundboard **${updated.name}**.`);
            }

            case 'delete_soundboard_sound': {
                const sound = entity(target);
                if (!sound?.delete) return targetRequired('Hãy lấy soundN từ list_soundboard_sounds.');
                const oldName = sound.name;
                await sound.delete();
                return success(action, `Đã xóa soundboard **${oldName}**.`);
            }

            case 'play_soundboard_sound': {
                let voiceChannel = entity(target);
                let sound = entity(secondary_target);
                if (voiceChannel && !voiceChannel?.sendSoundboardSound && sound?.sendSoundboardSound) [voiceChannel, sound] = [sound, voiceChannel];
                if (!voiceChannel?.sendSoundboardSound || !(sound?.soundId || sound?.id)) return targetRequired('Cần một voice channel và soundN hợp lệ.');
                await voiceChannel.sendSoundboardSound(sound);
                return success(action, `Đã phát soundboard **${sound.name || 'sound'}** trong **${voiceChannel.name}**.`);
            }

            case 'create_external_event': {
                const start = normalizeDate(start_time);
                const end = normalizeDate(end_time);
                if (!start || !end || !name || !location) return { ok: false, code: 'EVENT_DATA_REQUIRED', message: 'External event cần name, start_time, end_time và location.', reply: 'Sự kiện ngoài server cần tên, giờ bắt đầu, giờ kết thúc và địa điểm.' };
                const event = await guild.scheduledEvents.create({
                    name: String(name).slice(0, 100),
                    description: description ? String(description).slice(0, 1000) : undefined,
                    scheduledStartTime: start,
                    scheduledEndTime: end,
                    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
                    entityType: GuildScheduledEventEntityType.External,
                    entityMetadata: { location: String(location).slice(0, 100) },
                    reason: auditReason
                });
                discordEntities?.set?.('created_event', event);
                return success(action, `Đã tạo sự kiện **${event.name}**.`);
            }

            case 'create_voice_event': {
                const ch = entity(target);
                const start = normalizeDate(start_time);
                if (!ch?.isVoiceBased?.() || !start || !name) return targetRequired('Cần voice/stage channel, tên và start_time hợp lệ.');
                const entityType = ch.type === ChannelType.GuildStageVoice ? GuildScheduledEventEntityType.StageInstance : GuildScheduledEventEntityType.Voice;
                const event = await guild.scheduledEvents.create({
                    name: String(name).slice(0, 100),
                    description: description ? String(description).slice(0, 1000) : undefined,
                    scheduledStartTime: start,
                    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
                    entityType,
                    channel: ch,
                    reason: auditReason
                });
                discordEntities?.set?.('created_event', event);
                return success(action, `Đã tạo sự kiện **${event.name}** cho **${ch.name}**.`);
            }

            case 'cancel_scheduled_event': {
                const event = entity(target);
                if (!event?.edit) return targetRequired('Hãy lấy eventN từ list_scheduled_events.');
                await event.edit({ status: GuildScheduledEventStatus.Canceled, reason: auditReason });
                return success(action, `Đã hủy sự kiện **${event.name}**.`);
            }

            case 'delete_scheduled_event': {
                const event = entity(target);
                if (!event) return targetRequired('Hãy lấy eventN từ list_scheduled_events.');
                const eventName = event.name || 'sự kiện';
                if (event.delete) await event.delete();
                else await guild.scheduledEvents.delete(event);
                return success(action, `Đã xóa sự kiện **${eventName}**.`);
            }

            case 'create_stage_instance': {
                const ch = entity(target) || current;
                if (ch?.type !== ChannelType.GuildStageVoice) return targetRequired('Cần một Stage channel hợp lệ.');
                await guild.stageInstances.create(ch, { topic: String(topic || name || 'Dolia Stage').slice(0, 120), privacyLevel: StageInstancePrivacyLevel.GuildOnly });
                return success(action, `Đã mở Stage trong **${ch.name}**.`);
            }

            case 'edit_stage_topic': {
                const ch = entity(target) || current;
                if (ch?.type !== ChannelType.GuildStageVoice) return targetRequired('Cần một Stage channel hợp lệ.');
                await guild.stageInstances.edit(ch, { topic: String(topic || name || '').slice(0, 120) });
                return success(action, `Đã đổi chủ đề Stage trong **${ch.name}**.`);
            }

            case 'delete_stage_instance': {
                const ch = entity(target) || current;
                if (ch?.type !== ChannelType.GuildStageVoice) return targetRequired('Cần một Stage channel hợp lệ.');
                await guild.stageInstances.delete(ch);
                return success(action, `Đã kết thúc Stage trong **${ch.name}**.`);
            }

            case 'create_keyword_automod': {
                const words = Array.isArray(keywords) ? keywords.map(x => String(x).trim()).filter(Boolean).slice(0, 1000) : [];
                if (!name || words.length === 0) return { ok: false, code: 'AUTOMOD_DATA_REQUIRED', message: 'Cần name và keywords.', reply: 'Rule AutoMod cần tên và ít nhất một từ khóa.' };
                const actions = [{ type: AutoModerationActionType.BlockMessage, metadata: custom_message ? { customMessage: String(custom_message).slice(0, 150) } : undefined }];
                if (duration_minutes) actions.push({ type: AutoModerationActionType.Timeout, metadata: { durationSeconds: clampInt(duration_minutes, 1, 40320, 10) * 60 } });
                const alertChannel = entity(secondary_target);
                if (alertChannel?.id) actions.push({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alertChannel } });
                const rule = await guild.autoModerationRules.create({
                    name: String(name).slice(0, 100),
                    eventType: AutoModerationRuleEventType.MessageSend,
                    triggerType: AutoModerationRuleTriggerType.Keyword,
                    triggerMetadata: { keywordFilter: words },
                    actions,
                    enabled: enabled === undefined ? true : Boolean(enabled),
                    reason: auditReason
                });
                discordEntities?.set?.('created_automod', rule);
                return success(action, `Đã tạo AutoMod rule **${rule.name}**.`);
            }

            case 'create_mention_spam_automod': {
                if (!name) return { ok: false, code: 'NAME_REQUIRED', message: 'Thiếu tên rule.', reply: 'Bạn chưa đưa tên rule AutoMod.' };
                const actions = [{ type: AutoModerationActionType.BlockMessage, metadata: custom_message ? { customMessage: String(custom_message).slice(0, 150) } : undefined }];
                const alertChannel = entity(secondary_target);
                if (alertChannel?.id) actions.push({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alertChannel } });
                const rule = await guild.autoModerationRules.create({
                    name: String(name).slice(0, 100),
                    eventType: AutoModerationRuleEventType.MessageSend,
                    triggerType: AutoModerationRuleTriggerType.MentionSpam,
                    triggerMetadata: { mentionTotalLimit: clampInt(mention_total_limit, 1, 50, 5), mentionRaidProtectionEnabled: true },
                    actions,
                    enabled: enabled === undefined ? true : Boolean(enabled),
                    reason: auditReason
                });
                discordEntities?.set?.('created_automod', rule);
                return success(action, `Đã tạo AutoMod chống mention spam **${rule.name}**.`);
            }

            case 'enable_automod_rule':
            case 'disable_automod_rule': {
                const rule = entity(target);
                if (!rule?.edit) return targetRequired('Hãy lấy automodN từ list_automod_rules.');
                await rule.edit({ enabled: action === 'enable_automod_rule', reason: auditReason });
                return success(action, `Đã ${action === 'enable_automod_rule' ? 'bật' : 'tắt'} AutoMod **${rule.name}**.`);
            }

            case 'delete_automod_rule': {
                const rule = entity(target);
                if (!rule?.delete) return targetRequired('Hãy lấy automodN từ list_automod_rules.');
                const ruleName = rule.name;
                await rule.delete(auditReason);
                return success(action, `Đã xóa AutoMod **${ruleName}**.`);
            }

            // ---- Extended message actions ----
            case 'remove_user_reaction_replied': {
                if (!replied?.reactions?.cache) return targetRequired('Bạn hãy reply tin nhắn có reaction cần gỡ.');
                const member = entity(target) || entity('author');
                if (!member?.id) return targetRequired('Không xác định được người cần gỡ reaction.');
                const reaction = findReaction(replied, emoji);
                if (!reaction) return { ok: false, code: 'REACTION_NOT_FOUND', message: 'Không thấy reaction đó.', reply: 'Mình không thấy reaction đó trên tin nhắn.' };
                await reaction.users.remove(member.id);
                return success(action, `Đã gỡ reaction ${reaction.emoji?.toString?.() || emoji || ''} của **${memberLabel(member)}**.`);
            }

            case 'end_replied_poll': {
                if (!replied?.poll) return targetRequired('Bạn hãy reply một tin nhắn poll còn hoạt động.');
                if (replied.poll.end) await replied.poll.end();
                else if (replied.channel?.messages?.endPoll) await replied.channel.messages.endPoll(replied.id);
                else return targetRequired('Runtime này không hỗ trợ kết thúc poll trực tiếp.');
                return success(action, 'Đã kết thúc poll đó.');
            }

            case 'send_typing': {
                const ch = entity(target) || current;
                if (!ch?.sendTyping) return targetRequired('Kênh này không hỗ trợ typing indicator.');
                await ch.sendTyping();
                return success(action, `Đã gửi typing indicator trong **${ch.name || 'kênh này'}**.`);
            }

            // ---- Stage voice ----
            case 'stage_invite_to_speak':
            case 'stage_move_to_audience': {
                const member = entity(target);
                if (!member?.voice?.setSuppressed) return targetRequired('Cần một thành viên đang ở Stage channel.');
                await member.voice.setSuppressed(action === 'stage_move_to_audience');
                return success(action, action === 'stage_move_to_audience' ? `Đã chuyển **${memberLabel(member)}** về audience.` : `Đã mời **${memberLabel(member)}** lên nói.`);
            }

            case 'stage_request_to_speak':
            case 'stage_cancel_request': {
                const bot = entity(target || 'bot') || entity('bot');
                if (!bot?.voice?.setRequestToSpeak || bot.id !== message.client.user?.id) return targetRequired('Request-to-speak chỉ áp dụng trực tiếp cho chính Dolia trong Stage.');
                await bot.voice.setRequestToSpeak(action === 'stage_request_to_speak');
                return success(action, action === 'stage_request_to_speak' ? 'Mình đã giơ tay xin nói trong Stage.' : 'Mình đã hủy yêu cầu xin nói trong Stage.');
            }

            // ---- Extended channel / permission / webhook actions ----
            case 'set_channel_position': {
                const ch = entity(target) || current;
                if (!ch?.setPosition) return targetRequired('Không xác định được guild channel cần đổi vị trí.');
                await ch.setPosition(clampInt(position, 0, 500, ch.position || 0), { reason: auditReason });
                return success(action, `Đã đổi vị trí **${ch.name}**.`);
            }

            case 'sync_channel_permissions': {
                const ch = entity(target) || current;
                if (!ch?.lockPermissions) return targetRequired('Kênh này không đồng bộ permission với category được.');
                await ch.lockPermissions();
                return success(action, `Đã đồng bộ permission của **${ch.name}** với category.`);
            }

            case 'edit_channel_permissions': {
                const ch = entity(target) || current;
                const subject = entity(secondary_target);
                if (!ch?.permissionOverwrites?.edit || !subject?.id) return targetRequired('Cần một channel và member/role entity hợp lệ.');
                const payload = permissionOverwritePayload(allow_permissions, deny_permissions, clear_permissions);
                if (!Object.keys(payload).length) return { ok: false, code: 'PERMISSIONS_REQUIRED', message: 'Không có permission hợp lệ để chỉnh.', reply: 'Bạn chưa đưa permission hợp lệ để chỉnh.' };
                await ch.permissionOverwrites.edit(subject, payload, { reason: auditReason });
                return success(action, `Đã cập nhật permission override của **${subject?.user ? memberLabel(subject) : roleLabel(subject)}** trong **${ch.name}**.`);
            }

            case 'delete_channel_permissions': {
                const ch = entity(target) || current;
                const subject = entity(secondary_target);
                if (!ch?.permissionOverwrites?.delete || !subject?.id) return targetRequired('Cần một channel và member/role entity hợp lệ.');
                await ch.permissionOverwrites.delete(subject, auditReason);
                return success(action, `Đã xóa permission override của **${subject?.user ? memberLabel(subject) : roleLabel(subject)}** trong **${ch.name}**.`);
            }

            case 'follow_announcement': {
                const source = entity(target) || current;
                const destination = entity(secondary_target);
                if (!source?.id || !destination?.id) return targetRequired('Cần announcement channel nguồn và text channel đích.');
                await guild.channels.addFollower(source, destination, auditReason);
                return success(action, `Đã follow **${source.name}** vào **${destination.name}**.`);
            }

            case 'create_webhook': {
                const ch = entity(target) || current;
                if (!ch?.id) return targetRequired('Không xác định được channel để tạo webhook.');
                const hookName = String(name || 'Dolia Webhook').trim().slice(0, 80);
                const webhook = await guild.channels.createWebhook({ channel: ch, name: hookName, reason: auditReason });
                discordEntities?.set?.('created_webhook', webhook);
                return success(action, `Đã tạo webhook **${webhook.name}** trong **${ch.name}**.`, { webhook_created: true });
            }

            case 'edit_webhook': {
                const webhook = entity(target);
                if (!webhook?.edit) return targetRequired('Hãy lấy webhookN từ list_webhooks.');
                const dest = entity(secondary_target);
                const updated = await webhook.edit({
                    name: name ? String(name).trim().slice(0, 80) : undefined,
                    channel: dest?.id ? dest : undefined,
                    reason: auditReason
                });
                return success(action, `Đã cập nhật webhook **${updated.name || 'webhook'}**.`);
            }

            case 'delete_webhook': {
                const webhook = entity(target);
                if (!webhook?.delete) return targetRequired('Hãy lấy webhookN từ list_webhooks.');
                const oldName = webhook.name || 'webhook';
                await webhook.delete(auditReason);
                return success(action, `Đã xóa webhook **${oldName}**.`);
            }

            case 'send_webhook': {
                const webhook = entity(target);
                if (!webhook?.send || (webhook.isIncoming && !webhook.isIncoming())) return targetRequired('Webhook này không phải incoming webhook có thể gửi tin.');
                const text = String(content || '').trim();
                if (!text) return { ok: false, code: 'CONTENT_REQUIRED', message: 'Thiếu nội dung webhook.', reply: 'Bạn chưa đưa nội dung cần gửi.' };
                await webhook.send({ content: text.slice(0, 2000), username: name ? String(name).slice(0, 80) : undefined, allowedMentions: { parse: [] } });
                return success(action, `Đã gửi tin bằng webhook **${webhook.name || 'webhook'}**.`);
            }

            // ---- Forum / extended thread actions ----
            case 'create_forum_post': {
                const ch = entity(target) || current;
                if (!ch?.threads?.create || !Array.isArray(ch?.availableTags)) return targetRequired('Cần một Forum/Media channel hợp lệ.');
                const postName = String(name || '').trim();
                const text = String(content || '').trim();
                if (!postName || !text) return { ok: false, code: 'FORUM_DATA_REQUIRED', message: 'Forum post cần name và content.', reply: 'Bài forum cần tiêu đề và nội dung.' };
                const thread = await ch.threads.create({
                    name: postName.slice(0, 100),
                    message: { content: text.slice(0, 2000), allowedMentions: { parse: [] } },
                    appliedTags: forumTagIds(ch, forum_tags),
                    reason: auditReason
                });
                discordEntities?.set?.('created_thread', thread);
                return success(action, `Đã tạo bài **${thread.name}** trong **${ch.name}**.`);
            }

            case 'set_thread_auto_archive': {
                const thread = entity(target) || (current?.isThread?.() ? current : null);
                if (!thread?.setAutoArchiveDuration) return targetRequired('Cần một thread hợp lệ.');
                await thread.setAutoArchiveDuration(normalizeAutoArchiveMinutes(auto_archive_minutes), auditReason);
                return success(action, `Đã đổi thời gian tự archive của **${thread.name}**.`);
            }

            case 'set_thread_slowmode': {
                const thread = entity(target) || (current?.isThread?.() ? current : null);
                if (!thread?.setRateLimitPerUser) return targetRequired('Cần một thread hợp lệ.');
                await thread.setRateLimitPerUser(clampInt(slowmode_seconds, 0, 21600, 0), auditReason);
                return success(action, `Đã cập nhật slowmode của **${thread.name}**.`);
            }

            case 'set_thread_invitable': {
                const thread = entity(target) || (current?.isThread?.() ? current : null);
                if (!thread?.setInvitable) return targetRequired('Thread này không hỗ trợ chỉnh invitable.');
                await thread.setInvitable(enabled === undefined ? true : Boolean(enabled), auditReason);
                return success(action, `Đã cập nhật quyền mời thành viên của **${thread.name}**.`);
            }

            case 'pin_forum_thread':
            case 'unpin_forum_thread': {
                const thread = entity(target) || (current?.isThread?.() ? current : null);
                const method = action === 'pin_forum_thread' ? 'pin' : 'unpin';
                if (!thread?.[method]) return targetRequired('Thread này không hỗ trợ pin/unpin forum post.');
                await thread[method](auditReason);
                return success(action, `${action === 'pin_forum_thread' ? 'Đã ghim' : 'Đã bỏ ghim'} **${thread.name}**.`);
            }

            case 'set_forum_tags': {
                const ch = entity(target) || current;
                if (!ch?.setAvailableTags || !Array.isArray(ch?.availableTags)) return targetRequired('Cần một Forum/Media channel hợp lệ.');
                const payload = forumTagPayload(ch, forum_tags);
                await ch.setAvailableTags(payload, auditReason);
                return success(action, `Đã cập nhật ${payload.length} tag cho **${ch.name}**.`);
            }

            case 'set_forum_default_reaction': {
                const ch = entity(target) || current;
                if (!ch?.setDefaultReactionEmoji) return targetRequired('Cần một Forum/Media channel hợp lệ.');
                await ch.setDefaultReactionEmoji(resolveDefaultReaction(discordEntities, emoji), auditReason);
                return success(action, `Đã cập nhật reaction mặc định của **${ch.name}**.`);
            }

            case 'set_forum_default_slowmode': {
                const ch = entity(target) || current;
                if (!ch?.setDefaultThreadRateLimitPerUser) return targetRequired('Cần một Forum/Media channel hợp lệ.');
                await ch.setDefaultThreadRateLimitPerUser(clampInt(slowmode_seconds, 0, 21600, 0), auditReason);
                return success(action, `Đã cập nhật slowmode mặc định cho thread mới trong **${ch.name}**.`);
            }

            // ---- Extended role actions ----
            case 'set_role_permissions': {
                const role = entity(target);
                if (!role?.setPermissions) return targetRequired('Hãy mention role hoặc lấy roleN từ list_roles.');
                const perms = sanitizePermissionNames(permissions);
                await role.setPermissions(perms, auditReason);
                return success(action, `Đã đặt ${perms.length} permission cho role **${role.name}**.`);
            }

            case 'set_role_icon': {
                const role = entity(target);
                const att = entity(attachment_target || 'a1');
                if (!role?.setIcon || !att?.url) return targetRequired('Cần role và attachment ảnh hợp lệ.');
                await role.setIcon(await attachmentBuffer(att), auditReason);
                return success(action, `Đã đổi icon role **${role.name}**.`);
            }

            case 'set_role_unicode_emoji': {
                const role = entity(target);
                if (!role?.setUnicodeEmoji) return targetRequired('Role này không hỗ trợ unicode emoji.');
                await role.setUnicodeEmoji(String(emoji || '').trim() || null, auditReason);
                return success(action, `Đã cập nhật emoji role **${role.name}**.`);
            }

            // ---- Bot identity / presence ----
            case 'set_bot_username': {
                const next = String(name || '').trim();
                if (!next) return { ok: false, code: 'NAME_REQUIRED', message: 'Thiếu username mới.', reply: 'Bạn chưa đưa username mới.' };
                await message.client.user.setUsername(next.slice(0, 32));
                return success(action, `Đã đổi username bot thành **${message.client.user.username}**.`);
            }

            case 'set_bot_avatar':
            case 'set_bot_banner': {
                const att = entity(attachment_target || 'a1');
                if (!att?.url) return targetRequired('Hãy gửi kèm ảnh và dùng attachment ref a1/ra1.');
                const data = await attachmentBuffer(att);
                if (action === 'set_bot_avatar') await message.client.user.setAvatar(data);
                else await message.client.user.setBanner(data);
                return success(action, action === 'set_bot_avatar' ? 'Đã cập nhật avatar của Dolia.' : 'Đã cập nhật banner của Dolia.');
            }

            case 'set_bot_status': {
                const next = ['online', 'idle', 'dnd', 'invisible'].includes(String(status || '').toLowerCase()) ? String(status).toLowerCase() : 'online';
                message.client.user.setStatus(next);
                return success(action, `Đã đổi trạng thái Dolia thành **${next}**.`);
            }

            case 'set_bot_activity': {
                const text = String(activity || content || '').trim();
                if (!text) return { ok: false, code: 'ACTIVITY_REQUIRED', message: 'Thiếu nội dung activity.', reply: 'Bạn chưa đưa activity mới.' };
                message.client.user.setActivity(text.slice(0, 128), { type: normalizeActivityType(activity_type) });
                return success(action, `Đã cập nhật activity của Dolia.`);
            }

            case 'clear_bot_activity': {
                message.client.user.setActivity();
                return success(action, 'Đã xóa activity của Dolia.');
            }

            // ---- Extended guild settings/assets ----
            case 'set_server_icon':
            case 'set_server_banner':
            case 'set_server_splash': {
                const att = entity(attachment_target || 'a1');
                if (!att?.url) return targetRequired('Hãy gửi kèm ảnh và dùng attachment ref a1/ra1.');
                const data = await attachmentBuffer(att);
                if (action === 'set_server_icon') await guild.setIcon(data, auditReason);
                if (action === 'set_server_banner') await guild.setBanner(data, auditReason);
                if (action === 'set_server_splash') await guild.setSplash(data, auditReason);
                return success(action, 'Đã cập nhật hình ảnh của server.');
            }

            case 'set_afk_channel': {
                const ch = target ? entity(target) : null;
                if (ch && !ch?.isVoiceBased?.()) return targetRequired('AFK channel phải là voice channel.');
                await guild.setAFKChannel(ch || null, auditReason);
                return success(action, ch ? `Đã đặt AFK channel là **${ch.name}**.` : 'Đã bỏ AFK channel.');
            }

            case 'set_afk_timeout': {
                const seconds = normalizeAfkTimeoutSeconds(afk_timeout_seconds);
                await guild.setAFKTimeout(seconds, auditReason);
                return success(action, `Đã đặt AFK timeout thành **${seconds} giây**.`);
            }

            case 'set_system_channel':
            case 'set_rules_channel':
            case 'set_public_updates_channel':
            case 'set_safety_alerts_channel': {
                const ch = target ? entity(target) : null;
                if (ch && !ch?.isTextBased?.()) return targetRequired('Channel đích phải là text-based guild channel.');
                if (action === 'set_system_channel') await guild.setSystemChannel(ch || null, auditReason);
                if (action === 'set_rules_channel') await guild.setRulesChannel(ch || null, auditReason);
                if (action === 'set_public_updates_channel') await guild.setPublicUpdatesChannel(ch || null, auditReason);
                if (action === 'set_safety_alerts_channel') await guild.setSafetyAlertsChannel(ch || null, auditReason);
                return success(action, ch ? `Đã cập nhật channel hệ thống thành **${ch.name}**.` : 'Đã bỏ channel cấu hình đó.');
            }

            // ---- Scheduled event lifecycle ----
            case 'rename_scheduled_event':
            case 'set_event_description':
            case 'set_event_start_time':
            case 'set_event_end_time':
            case 'set_event_location':
            case 'start_scheduled_event':
            case 'complete_scheduled_event': {
                const event = entity(target);
                if (!event) return targetRequired('Hãy lấy eventN từ list_scheduled_events.');
                if (action === 'rename_scheduled_event') {
                    const next = String(name || '').trim();
                    if (!next) return { ok: false, code: 'NAME_REQUIRED', message: 'Thiếu tên event.', reply: 'Bạn chưa đưa tên event mới.' };
                    await event.setName(next.slice(0, 100), auditReason);
                }
                if (action === 'set_event_description') await event.setDescription(String(description ?? content ?? '').slice(0, 1000), auditReason);
                if (action === 'set_event_start_time') {
                    const d = normalizeDate(start_time);
                    if (!d) return { ok: false, code: 'TIME_REQUIRED', message: 'start_time không hợp lệ.', reply: 'Giờ bắt đầu không hợp lệ.' };
                    await event.setScheduledStartTime(d, auditReason);
                }
                if (action === 'set_event_end_time') {
                    const d = normalizeDate(end_time);
                    if (!d) return { ok: false, code: 'TIME_REQUIRED', message: 'end_time không hợp lệ.', reply: 'Giờ kết thúc không hợp lệ.' };
                    await event.setScheduledEndTime(d, auditReason);
                }
                if (action === 'set_event_location') await event.setLocation(String(location || '').trim().slice(0, 100), auditReason);
                if (action === 'start_scheduled_event') await event.setStatus(GuildScheduledEventStatus.Active, auditReason);
                if (action === 'complete_scheduled_event') await event.setStatus(GuildScheduledEventStatus.Completed, auditReason);
                return success(action, `Đã cập nhật sự kiện **${event.name}**.`);
            }

            case 'rename_automod_rule': {
                const rule = entity(target);
                if (!rule?.setName && !rule?.edit) return targetRequired('Hãy lấy automodN từ list_automod_rules.');
                const next = String(name || '').trim();
                if (!next) return { ok: false, code: 'NAME_REQUIRED', message: 'Thiếu tên AutoMod rule.', reply: 'Bạn chưa đưa tên rule mới.' };
                if (rule.setName) await rule.setName(next.slice(0, 100), auditReason);
                else await rule.edit({ name: next.slice(0, 100), reason: auditReason });
                return success(action, `Đã đổi tên AutoMod rule thành **${next.slice(0, 100)}**.`);
            }

            default:
                return { ok: false, code: 'UNSUPPORTED_ACTION', message: `Discord action không hỗ trợ action: ${action}`, reply: 'Thao tác Discord này chưa được map trực tiếp.' };
        }
    } catch (error) {
        return mutationError(error);
    }
}
