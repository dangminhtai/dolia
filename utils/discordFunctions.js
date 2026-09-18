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

function buildEntityMap(message, guild) {
    const entities = new Map();

    if (message?.member) entities.set('author', message.member);
    if (guild?.members?.me) entities.set('bot', guild.members.me);

    const mentioned = message?.mentions?.members;
    if (mentioned?.values) {
        let index = 1;
        for (const member of mentioned.values()) {
            // Không tạo alias trùng với author/bot; uN vẫn trỏ đúng mention.
            entities.set(`u${index++}`, member);
        }
    }

    return entities;
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

export async function discord_query({ action, target, guild, channel, message }) {
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
            const online = list.filter(member => {
                const status = statusOf(member);
                return status !== 'offline';
            });
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
            const entityMap = buildEntityMap(message, guild);
            const ref = target || 'author';
            let member = entityMap.get(ref);

            if (!member && ref === 'bot') {
                member = guild.members.me || await guild.members.fetchMe().catch(() => null);
            }

            if (!member) {
                return {
                    ok: false,
                    code: 'TARGET_REQUIRED',
                    message: 'Không xác định được thành viên từ lượt hiện tại. Với người khác, hãy @mention họ trong cùng tin nhắn.',
                    allowed_targets: [...entityMap.keys()]
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
