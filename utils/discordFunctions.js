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
        || 'Unknown';
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

function isOwner(userId) {
    return Boolean(process.env.OWNER_ID && userId && String(userId) === String(process.env.OWNER_ID));
}

function excerpt(text, max = 56) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '(không có nội dung text)';
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Tạo registry entity cho đúng 1 request.
 * Registry này được truyền thẳng vào executor, vì vậy model không phải cầm Snowflake ID
 * và alias recent không bị đổi nghĩa giữa lúc suy luận và lúc thực thi.
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
        lines.push(`- current_channel = #${message.channel?.name || 'unknown'}`);
    }

    if (message) {
        entities.set('current_message', message);
    }

    // Mentions ở chính lượt hiện tại luôn có độ ưu tiên cao nhất.
    const mentioned = message?.mentions?.members;
    if (mentioned?.values) {
        let index = 1;
        for (const member of mentioned.values()) {
            const ref = `u${index++}`;
            entities.set(ref, member);
            lines.push(`- ${ref} = @${memberLabel(member)} (được nhắc trong tin hiện tại)`);
        }
    }

    // Message được reply là target rất đáng tin cậy cho action kiểu "xóa tin này", "react tin này".
    if (message?.reference?.messageId && message?.channel?.messages?.fetch) {
        try {
            const replied = await message.channel.messages.fetch(message.reference.messageId);
            if (replied) {
                entities.set('replied_message', replied);
                if (replied.member) entities.set('replied_author', replied.member);
                lines.push(`- replied_message = tin của @${memberLabel(replied.member)}: "${excerpt(replied.content)}"`);
                if (replied.member) lines.push(`- replied_author = @${memberLabel(replied.member)}`);
            }
        } catch (_) {
            // Không có reply hợp lệ thì bỏ qua, không đoán.
        }
    }

    // Recent aliases giúp hội thoại tự nhiên kiểu "cô ấy vừa nhắn" mà vẫn không fuzzy-match tên.
    // Chỉ lấy các tác giả gần đây và giữ alias cố định trong chính request này.
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
                if (!member && guild?.members?.fetch) {
                    member = await guild.members.fetch(msg.author.id).catch(() => null);
                }
                if (!member) continue;

                const ref = `recent${recentIndex++}`;
                entities.set(ref, member);
                lines.push(`- ${ref} = @${memberLabel(member)} (tác giả gần đây; tin gần nhất: "${excerpt(msg.content)}")`);
                seen.add(msg.author.id);
                if (recentIndex > 5) break;
            }
        } catch (_) {
            // Cache/fetch fail không làm chat fail.
        }
    }

    return {
        text: lines.join('\n') || '- Không có Discord entity nào khả dụng.',
        entities
    };
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

function resolveEntity(discordEntities, ref) {
    if (!discordEntities?.get || !ref) return null;
    return discordEntities.get(ref) || null;
}

async function requireOwner(message) {
    if (!isOwner(message?.author?.id)) {
        return {
            ok: false,
            code: 'OWNER_ONLY',
            message: 'Thao tác này chỉ chủ bot mới được phép yêu cầu.'
        };
    }
    return null;
}

async function fetchRecentMessages(channel, limit = 50) {
    if (!channel?.messages?.fetch) return [];
    try {
        const collection = await channel.messages.fetch({ limit: Math.min(Math.max(limit, 1), 100) });
        return [...collection.values()];
    } catch (_) {
        return [];
    }
}

export async function discord_query({ action, target, guild, channel, message, discordEntities }) {
    if (!guild) {
        return {
            ok: false,
            code: 'GUILD_REQUIRED',
            message: 'Dữ liệu này chỉ có trong server Discord.'
        };
    }

    switch (action) {
        case 'server_overview': {
            const { members, complete } = await fetchMembers(guild, false);
            const list = members ? [...members.values()] : [];
            const bots = list.filter(member => member?.user?.bot).length;
            const humans = list.filter(member => member?.user && !member.user.bot).length;

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
                    boosts: guild.premiumSubscriptionCount ?? 0,
                    boost_tier: guild.premiumTier ?? 0,
                    created_at: guild.createdAt?.toISOString?.() || null,
                    preferred_locale: guild.preferredLocale || null
                }
            };
        }

        case 'list_members': {
            const { members, complete } = await fetchMembers(guild, true);
            const list = members ? [...members.values()] : [];
            return {
                ok: true,
                complete,
                count: list.length,
                members: list.map(member => ({
                    name: memberLabel(member),
                    is_bot: Boolean(member?.user?.bot),
                    status: statusOf(member)
                }))
            };
        }

        case 'online_members': {
            const { members, complete } = await fetchMembers(guild, true);
            const list = members ? [...members.values()] : [];
            const online = list.filter(member => statusOf(member) !== 'offline');
            const presenceObserved = list.some(member => Boolean(member?.presence));

            return {
                ok: true,
                complete,
                presence_observed: presenceObserved,
                note: presenceObserved
                    ? null
                    : 'Không thấy presence runtime. Hãy kiểm tra Guild Presences Intent trong Discord Developer Portal nếu cần trạng thái online chính xác.',
                count: online.length,
                members: online.map(member => ({
                    name: memberLabel(member),
                    is_bot: Boolean(member?.user?.bot),
                    status: statusOf(member),
                    activities: activitySummary(member)
                }))
            };
        }

        case 'voice_members': {
            const { members, complete } = await fetchMembers(guild, false);
            const list = members ? [...members.values()] : [];
            const inVoice = list.filter(member => Boolean(member?.voice?.channel));

            return {
                ok: true,
                complete,
                count: inVoice.length,
                members: inVoice.map(member => ({
                    name: memberLabel(member),
                    is_bot: Boolean(member?.user?.bot),
                    channel: member.voice.channel?.name || null,
                    self_mute: Boolean(member.voice.selfMute),
                    self_deaf: Boolean(member.voice.selfDeaf),
                    server_mute: Boolean(member.voice.serverMute),
                    server_deaf: Boolean(member.voice.serverDeaf)
                }))
            };
        }

        case 'member_profile': {
            const ref = target || 'author';
            const member = resolveEntity(discordEntities, ref);

            if (!member) {
                return {
                    ok: false,
                    code: 'TARGET_REQUIRED',
                    message: 'Không xác định được thành viên từ lượt hiện tại. Hãy @mention, reply, hoặc nói rõ người vừa tham gia hội thoại.',
                    allowed_targets: discordEntities?.keys ? [...discordEntities.keys()].filter(k => !k.includes('message') && k !== 'current_channel') : []
                };
            }

            return {
                ok: true,
                target: ref,
                profile: memberSnapshot(member),
                about_me: null,
                about_me_note: 'Discord Bot API/discord.js không cung cấp trường About Me/bio của thành viên khác như một dữ liệu guild tiêu chuẩn.'
            };
        }

        case 'channel_overview': {
            const current = channel || message?.channel;
            return {
                ok: true,
                channel: {
                    name: current?.name || null,
                    type: current?.type ?? null,
                    topic: current?.topic || null,
                    nsfw: Boolean(current?.nsfw),
                    created_at: current?.createdAt?.toISOString?.() || null,
                    rate_limit_per_user: current?.rateLimitPerUser ?? null,
                    members_with_access_cached: current?.members?.size ?? null
                }
            };
        }

        default:
            return {
                ok: false,
                code: 'UNSUPPORTED_ACTION',
                message: `Discord query không hỗ trợ action: ${action}`
            };
    }
}

export async function discord_action({
    action,
    target,
    count = 1,
    nickname,
    reason,
    emoji,
    guild,
    channel,
    message,
    discordEntities
}) {
    if (!guild || !message) {
        return { ok: false, code: 'GUILD_REQUIRED', message: 'Thao tác này chỉ dùng trong server Discord.' };
    }

    const ownerError = await requireOwner(message);
    if (ownerError) return ownerError;

    const safeCount = Math.min(Math.max(Number(count) || 1, 1), 20);

    try {
        switch (action) {
            case 'delete_replied_message': {
                const targetMessage = resolveEntity(discordEntities, 'replied_message');
                if (!targetMessage?.delete) {
                    return { ok: false, code: 'MESSAGE_REQUIRED', message: 'Bạn hãy reply đúng tin nhắn cần xóa.' };
                }
                await targetMessage.delete();
                return { ok: true, action, deleted: 1, author: targetMessage.author?.username || null };
            }

            case 'delete_recent_from': {
                const member = resolveEntity(discordEntities, target);
                if (!member?.id) {
                    return {
                        ok: false,
                        code: 'TARGET_REQUIRED',
                        message: 'Không xác định được người có tin cần xóa. Hãy @mention, reply, hoặc dùng người vừa xuất hiện trong hội thoại.',
                        allowed_targets: discordEntities?.keys ? [...discordEntities.keys()].filter(k => /^(author|bot|u\d+|recent\d+|replied_author)$/.test(k)) : []
                    };
                }

                const recent = await fetchRecentMessages(channel || message.channel, 100);
                // Không xóa chính câu lệnh hiện tại, tránh "xóa tin của tôi" tự nuốt luôn lời yêu cầu.
                const candidates = recent
                    .filter(msg => msg?.id !== message.id && msg?.author?.id === member.id && msg?.deletable !== false)
                    .sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0))
                    .slice(0, safeCount);

                if (candidates.length === 0) {
                    return { ok: false, code: 'NO_MESSAGES_FOUND', message: `Không tìm thấy tin nhắn gần đây có thể xóa của ${memberLabel(member)} trong kênh này.` };
                }

                let deleted = 0;
                for (const msg of candidates) {
                    try {
                        await msg.delete();
                        deleted++;
                    } catch (_) {
                        // Tiếp tục với các tin còn lại; kết quả cuối phản ánh số xóa thật.
                    }
                }

                if (deleted === 0) {
                    return { ok: false, code: 'DELETE_FAILED', message: 'Mình không xóa được tin nhắn đó. Hãy kiểm tra quyền Manage Messages và thứ tự role của bot.' };
                }

                return { ok: true, action, deleted, target: memberLabel(member) };
            }

            case 'set_nickname': {
                const member = resolveEntity(discordEntities, target || 'bot');
                if (!member?.setNickname) {
                    return { ok: false, code: 'TARGET_REQUIRED', message: 'Không xác định được thành viên cần đổi biệt danh.' };
                }
                if (!nickname || !String(nickname).trim()) {
                    return { ok: false, code: 'NICKNAME_REQUIRED', message: 'Bạn chưa đưa biệt danh mới.' };
                }
                await member.setNickname(String(nickname).trim().slice(0, 32), reason || `Requested by ${message.author.username}`);
                return { ok: true, action, target: memberLabel(member), nickname: String(nickname).trim().slice(0, 32) };
            }

            case 'disconnect_voice': {
                const member = resolveEntity(discordEntities, target || 'author');
                if (!member?.voice) {
                    return { ok: false, code: 'TARGET_REQUIRED', message: 'Không xác định được thành viên cần ngắt khỏi kênh thoại.' };
                }
                if (!member.voice.channel) {
                    return { ok: false, code: 'NOT_IN_VOICE', message: `${memberLabel(member)} hiện không ở kênh thoại.` };
                }
                await member.voice.disconnect(reason || `Requested by ${message.author.username}`);
                return { ok: true, action, target: memberLabel(member) };
            }

            case 'kick': {
                const member = resolveEntity(discordEntities, target);
                if (!member?.kick) {
                    return { ok: false, code: 'TARGET_REQUIRED', message: 'Hãy @mention người cần kick trong cùng yêu cầu.' };
                }
                if (member.id === message.author.id) {
                    return { ok: false, code: 'SELF_KICK_BLOCKED', message: 'Không dùng lệnh kick thành viên để tự kick chính người gọi.' };
                }
                await member.kick(reason || `Requested by ${message.author.username}`);
                return { ok: true, action, target: memberLabel(member) };
            }

            case 'ban': {
                const member = resolveEntity(discordEntities, target);
                if (!member?.ban) {
                    return { ok: false, code: 'TARGET_REQUIRED', message: 'Hãy @mention người cần ban trong cùng yêu cầu.' };
                }
                if (member.id === message.author.id) {
                    return { ok: false, code: 'SELF_BAN_BLOCKED', message: 'Không dùng lệnh ban thành viên để tự ban chính người gọi.' };
                }
                await member.ban({ reason: reason || `Requested by ${message.author.username}`, deleteMessageSeconds: 0 });
                return { ok: true, action, target: memberLabel(member) };
            }

            case 'react_replied_message': {
                const targetMessage = resolveEntity(discordEntities, 'replied_message');
                if (!targetMessage?.react) {
                    return { ok: false, code: 'MESSAGE_REQUIRED', message: 'Bạn hãy reply tin nhắn cần thả reaction.' };
                }
                if (!emoji || !String(emoji).trim()) {
                    return { ok: false, code: 'EMOJI_REQUIRED', message: 'Bạn chưa đưa emoji cần thả.' };
                }
                await targetMessage.react(String(emoji).trim());
                return { ok: true, action, emoji: String(emoji).trim() };
            }

            default:
                return { ok: false, code: 'UNSUPPORTED_ACTION', message: `Discord action không hỗ trợ action: ${action}` };
        }
    } catch (error) {
        const code = error?.code || error?.rawError?.code || 'DISCORD_API_ERROR';
        return {
            ok: false,
            code: String(code),
            message: `Discord từ chối thao tác: ${error?.message || 'Unknown error'}`
        };
    }
}
