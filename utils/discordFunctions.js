import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { isOwner } from '../services/authorizationService.js';
import { t as tr } from '../services/i18nService.js';
import Logger from '../class/Logger.js';

/**
 * Xây dựng Request-Scoped Entity Registry từ tin nhắn Discord hiện tại.
 * Tạo các handle ngắn gọn (u1, u2, author, bot, current_channel, replied_message)
 * để LLM không bao giờ phải xử lý hoặc đoán mò Snowflake ID.
 */
export function buildDiscordEntities(message) {
    const entityMap = new Map();
    const me = message.guild?.members?.me;

    // Fixed entities
    entityMap.set('author', message.member || message.author);
    if (me) entityMap.set('bot', me);
    if (message.channel) entityMap.set('current_channel', message.channel);
    entityMap.set('current_message', message);

    const lines = [
        `author = ${message.member?.displayName || message.author?.username || 'User'}`,
        `bot = ${me?.displayName || message.client?.user?.username || 'Dolia'}`,
        `current_channel = #${message.channel?.name || 'chat'}`,
        `current_message = tin nhắn hiện tại`
    ];

    if (message.reference?.messageId) {
        entityMap.set('replied_message', message.reference.messageId);
        lines.push(`replied_message = tin nhắn được trả lời`);
    }

    // Mentioned users / members: u1, u2, ...
    let uIdx = 1;
    const userLines = [];
    if (message.mentions?.members?.size > 0) {
        for (const member of message.mentions.members.values()) {
            if (member.id === message.client?.user?.id) continue;
            const handle = `u${uIdx++}`;
            entityMap.set(handle, member);
            userLines.push(`- ${handle} = @${member.displayName || member.user?.username}`);
        }
    } else if (message.mentions?.users?.size > 0) {
        for (const user of message.mentions.users.values()) {
            if (user.id === message.client?.user?.id) continue;
            const handle = `u${uIdx++}`;
            entityMap.set(handle, user);
            userLines.push(`- ${handle} = @${user.username}`);
        }
    }
    if (userLines.length > 0) {
        lines.push('mentioned_users:\n' + userLines.join('\n'));
    }

    // Mentioned roles: r1, r2, ...
    let rIdx = 1;
    const roleLines = [];
    if (message.mentions?.roles?.size > 0) {
        for (const role of message.mentions.roles.values()) {
            const handle = `r${rIdx++}`;
            entityMap.set(handle, role);
            roleLines.push(`- ${handle} = @${role.name}`);
        }
    }
    if (roleLines.length > 0) {
        lines.push('mentioned_roles:\n' + roleLines.join('\n'));
    }

    // Mentioned channels: c1, c2, ...
    let cIdx = 1;
    const channelLines = [];
    if (message.mentions?.channels?.size > 0) {
        for (const ch of message.mentions.channels.values()) {
            const handle = `c${cIdx++}`;
            entityMap.set(handle, ch);
            channelLines.push(`- ${handle} = #${ch.name}`);
        }
    }
    if (channelLines.length > 0) {
        lines.push('mentioned_channels:\n' + channelLines.join('\n'));
    }

    const entityContextText = `[DISCORD_ENTITIES]\n${lines.join('\n')}`;
    return { entityMap, entityContextText };
}

export async function get_avatar(args) {
    const { target, user, entityMap } = args || {};
    try {
        Logger.info(tr('logs.discordfunctions.info_tool_invoked', { tool: 'get_avatar', action: 'get_avatar', userId: user?.id || 'unknown' }));
        const handle = target || 'author';
        const entity = entityMap?.get(handle) || user;
        const targetUser = entity?.user || entity;
        if (!targetUser?.displayAvatarURL) {
            const text = 'Không tìm thấy người dùng tương ứng trong danh sách thực thể.';
            return { success: false, message: text, reply: text };
        }
        const url = targetUser.displayAvatarURL({ extension: 'png', size: 512, forceStatic: true });
        const text = `Ảnh đại diện của ${targetUser.username}: ${url}`;
        return { success: true, userId: targetUser.id, url, message: text, reply: text };
    } catch (err) {
        Logger.error(tr('logs.discordfunctions.error_tool_failed', { tool: 'get_avatar', error: err.message }));
        const text = 'Không thể lấy ảnh đại diện lúc này.';
        return { success: false, message: text, reply: text };
    }
}

export async function moderate_discord({ action, target, count, reason, duration_minutes, user, guild, channel, message, entityMap }) {
    if (!isOwner(user?.id)) {
        Logger.warn(tr('logs.discordfunctions.warn_forbidden', { tool: 'moderate_discord' }));
        const msg = tr('messages.discordfunctions.text_forbidden');
        return { success: false, message: msg, reply: msg };
    }
    if (!guild || !channel?.permissionsFor) {
        const msg = tr('messages.discordfunctions.text_guild_required');
        return { success: false, message: msg, reply: msg };
    }

    try {
        Logger.info(tr('logs.discordfunctions.info_tool_invoked', { tool: 'moderate_discord', action: action || 'unknown', userId: user?.id || 'unknown' }));
        const me = await guild.members.fetchMe();
        const required = {
            delete_messages: PermissionFlagsBits.ManageMessages,
            kick: PermissionFlagsBits.KickMembers,
            ban: PermissionFlagsBits.BanMembers,
            timeout: PermissionFlagsBits.ModerateMembers,
            untimeout: PermissionFlagsBits.ModerateMembers
        }[action];

        if (!required) {
            const msg = tr('messages.discordfunctions.text_invalid_action');
            return { success: false, message: msg, reply: msg };
        }

        const permissions = action === 'delete_messages' ? channel.permissionsFor(me) : me.permissions;
        if (!permissions?.has(required)) {
            const msg = tr('messages.discordfunctions.text_no_permission');
            return { success: false, message: msg, reply: msg };
        }

        if (action === 'delete_messages') {
            if (target === 'replied_message' || target === 'current_message') {
                const messageId = target === 'replied_message' ? message.reference?.messageId : message.id;
                if (!messageId) {
                    const msg = 'Không tìm thấy tin nhắn được chỉ định.';
                    return { success: false, message: msg, reply: msg };
                }
                const targetMsg = await channel.messages.fetch(messageId);
                await targetMsg.delete();
                const msg = 'Mình đã xóa tin nhắn bạn chỉ định.';
                return { success: true, deleted: 1, message: msg, reply: msg };
            }

            const deleteCount = parseInt(count, 10);
            if (!Number.isInteger(deleteCount) || deleteCount < 1 || deleteCount > 100) {
                const msg = 'Bạn muốn xóa bao nhiêu tin nhắn? Mỗi lượt từ 1 đến 100 tin trong kênh này.';
                return { success: false, message: msg, reply: msg };
            }
            const selected = await channel.messages.fetch({ limit: deleteCount, before: message?.id });
            const deleted = await channel.bulkDelete(selected, true);
            const msg = `Mình đã xóa ${deleted.size} tin nhắn trong kênh này. Những tin quá 14 ngày không được xóa theo lượt.`;
            return { success: true, deleted: deleted.size, message: msg, reply: msg };
        }

        // kick, ban, timeout, untimeout
        // Must reference a mentioned user handle: u1, u2...
        if (!target || !target.startsWith('u') || !entityMap?.has(target)) {
            const msg = tr('messages.discordfunctions.text_user_mention_required');
            return { success: false, message: msg, reply: msg };
        }

        let targetMember = entityMap.get(target);
        if (!targetMember.roles) {
            targetMember = await guild.members.fetch({ user: targetMember.id, force: true });
        }

        if ([user?.id, guild.ownerId, me.id].includes(targetMember.id)) {
            const msg = tr('messages.discordfunctions.text_protected_user');
            return { success: false, message: msg, reply: msg };
        }

        const auditReason = (reason || `Theo yêu cầu của ${user?.id}`).slice(0, 512);

        if (action === 'kick') {
            if (!targetMember.kickable) {
                const msg = 'Vai trò hoặc quyền hiện tại không cho phép mình xử lý người này.';
                return { success: false, message: msg, reply: msg };
            }
            await targetMember.kick(auditReason);
            const msg = `Mình đã đưa ${targetMember.user.username} ra khỏi máy chủ.`;
            return { success: true, userId: targetMember.id, message: msg, reply: msg };
        }

        if (action === 'ban') {
            if (!targetMember.bannable) {
                const msg = 'Vai trò hoặc quyền hiện tại không cho phép mình xử lý người này.';
                return { success: false, message: msg, reply: msg };
            }
            await targetMember.ban({ reason: auditReason, deleteMessageSeconds: 0 });
            const msg = `Mình đã cấm ${targetMember.user.username} tham gia máy chủ.`;
            return { success: true, userId: targetMember.id, message: msg, reply: msg };
        }

        if (action === 'timeout') {
            if (!targetMember.moderatable) {
                const msg = 'Vai trò hoặc quyền hiện tại không cho phép mình xử lý người này.';
                return { success: false, message: msg, reply: msg };
            }
            const mins = Math.max(1, Math.min(40320, parseInt(duration_minutes, 10) || 5));
            await targetMember.timeout(mins * 60 * 1000, auditReason);
            const msg = `Đã tạm khóa (timeout) ${targetMember.user.username} trong ${mins} phút.`;
            return { success: true, userId: targetMember.id, duration_minutes: mins, message: msg, reply: msg };
        }

        if (action === 'untimeout') {
            if (!targetMember.moderatable) {
                const msg = 'Vai trò hoặc quyền hiện tại không cho phép mình xử lý người này.';
                return { success: false, message: msg, reply: msg };
            }
            await targetMember.timeout(null, auditReason);
            const msg = `Đã gỡ tạm khóa (timeout) cho ${targetMember.user.username}.`;
            return { success: true, userId: targetMember.id, message: msg, reply: msg };
        }
    } catch (err) {
        Logger.error(tr('logs.discordfunctions.error_tool_failed', { tool: 'moderate_discord', error: err.message }));
        const msg = `Thao tác thất bại: ${err.message}`;
        return { success: false, message: msg, reply: msg };
    }
}

export async function manage_member({ action, target, nickname, role, target_channel, reason, user, guild, channel, message, entityMap }) {
    if (!isOwner(user?.id)) {
        Logger.warn(tr('logs.discordfunctions.warn_forbidden', { tool: 'manage_member' }));
        const msg = tr('messages.discordfunctions.text_forbidden');
        return { success: false, message: msg, reply: msg };
    }
    if (!guild) {
        const msg = tr('messages.discordfunctions.text_guild_required');
        return { success: false, message: msg, reply: msg };
    }

    try {
        Logger.info(tr('logs.discordfunctions.info_tool_invoked', { tool: 'manage_member', action: action || 'unknown', userId: user?.id || 'unknown' }));
        const me = await guild.members.fetchMe();
        const auditReason = (reason || `Theo yêu cầu của ${user?.id}`).slice(0, 512);

        // Resolve target member handle: 'author', 'bot', 'u1', 'u2', etc.
        const handle = target || 'bot';
        let member = entityMap?.get(handle);
        if (!member) {
            const msg = 'Không tìm thấy thành viên tương ứng trong danh sách [DISCORD_ENTITIES]. Hãy @ người cần thao tác.';
            return { success: false, message: msg, reply: msg };
        }
        if (!member.roles) {
            member = await guild.members.fetch({ user: member.id, force: true });
        }

        if (action === 'set_nickname') {
            if (member.id === me.id) {
                if (!me.permissions.has(PermissionFlagsBits.ChangeNickname) && !me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
                    const msg = tr('messages.discordfunctions.text_no_permission');
                    return { success: false, message: msg, reply: msg };
                }
            } else {
                if (!me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
                    const msg = tr('messages.discordfunctions.text_no_permission');
                    return { success: false, message: msg, reply: msg };
                }
                if (member.id === guild.ownerId) {
                    const msg = 'Không thể đổi biệt danh của chủ sở hữu máy chủ (Server Owner).';
                    return { success: false, message: msg, reply: msg };
                }
                if (member.roles.highest.position >= me.roles.highest.position) {
                    const msg = 'Không thể đổi biệt danh do vai trò của thành viên này cao hơn hoặc bằng bot.';
                    return { success: false, message: msg, reply: msg };
                }
            }

            const newNick = nickname ? String(nickname).slice(0, 32) : null;
            await member.setNickname(newNick, auditReason);
            const msg = newNick ? `Đã đổi biệt danh của ${member.user.username} thành "${newNick}".` : `Đã xóa biệt danh của ${member.user.username}.`;
            return { success: true, userId: member.id, message: msg, reply: msg };
        }

        if (action === 'add_role' || action === 'remove_role') {
            if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            const roleObj = entityMap?.get(role);
            if (!roleObj || !roleObj.name) {
                const msg = 'Không tìm thấy vai trò (role) được chỉ định trong danh sách [DISCORD_ENTITIES]. Hãy @ vai trò trong tin nhắn.';
                return { success: false, message: msg, reply: msg };
            }
            if (me.roles.highest.position <= roleObj.position) {
                const msg = 'Vai trò này cao hơn hoặc bằng vai trò cao nhất của bot, không thể thao tác.';
                return { success: false, message: msg, reply: msg };
            }

            if (action === 'add_role') {
                await member.roles.add(roleObj, auditReason);
                const msg = `Đã thêm vai trò "${roleObj.name}" cho ${member.user.username}.`;
                return { success: true, userId: member.id, roleId: roleObj.id, message: msg, reply: msg };
            } else {
                await member.roles.remove(roleObj, auditReason);
                const msg = `Đã xóa vai trò "${roleObj.name}" khỏi ${member.user.username}.`;
                return { success: true, userId: member.id, roleId: roleObj.id, message: msg, reply: msg };
            }
        }

        if (action === 'move_voice') {
            if (!me.permissions.has(PermissionFlagsBits.MoveMembers)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            if (!member.voice?.channel) {
                const msg = `${member.user.username} hiện không ở trong kênh thoại nào.`;
                return { success: false, message: msg, reply: msg };
            }
            const chanObj = entityMap?.get(target_channel);
            if (!chanObj?.isVoiceBased?.()) {
                const msg = 'Kênh đích không phải là kênh thoại hợp lệ.';
                return { success: false, message: msg, reply: msg };
            }
            await member.voice.setChannel(chanObj, auditReason);
            const msg = `Đã chuyển ${member.user.username} sang kênh thoại "${chanObj.name}".`;
            return { success: true, userId: member.id, channelId: chanObj.id, message: msg, reply: msg };
        }

        if (action === 'disconnect_voice') {
            if (!me.permissions.has(PermissionFlagsBits.MoveMembers)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            if (!member.voice?.channel) {
                const msg = `${member.user.username} hiện không ở trong kênh thoại nào.`;
                return { success: false, message: msg, reply: msg };
            }
            await member.voice.disconnect(auditReason);
            const msg = `Đã ngắt kết nối kênh thoại của ${member.user.username}.`;
            return { success: true, userId: member.id, message: msg, reply: msg };
        }

        const msg = tr('messages.discordfunctions.text_invalid_action');
        return { success: false, message: msg, reply: msg };
    } catch (err) {
        Logger.error(tr('logs.discordfunctions.error_tool_failed', { tool: 'manage_member', error: err.message }));
        const msg = `Thao tác thất bại: ${err.message}`;
        return { success: false, message: msg, reply: msg };
    }
}

export async function manage_message({ action, target, emoji, thread_name, user, guild, channel, message, entityMap }) {
    if (!isOwner(user?.id)) {
        Logger.warn(tr('logs.discordfunctions.warn_forbidden', { tool: 'manage_message' }));
        const msg = tr('messages.discordfunctions.text_forbidden');
        return { success: false, message: msg, reply: msg };
    }
    if (!guild || !channel) {
        const msg = tr('messages.discordfunctions.text_guild_required');
        return { success: false, message: msg, reply: msg };
    }

    try {
        Logger.info(tr('logs.discordfunctions.info_tool_invoked', { tool: 'manage_message', action: action || 'unknown', userId: user?.id || 'unknown' }));
        const me = await guild.members.fetchMe();

        let targetMsg = message;
        if (target === 'replied_message' && message.reference?.messageId) {
            targetMsg = await channel.messages.fetch(message.reference.messageId);
        }

        if (action === 'react') {
            if (!emoji) {
                const msg = 'Cần cung cấp emoji.';
                return { success: false, message: msg, reply: msg };
            }
            await targetMsg.react(emoji);
            const msg = `Đã thả cảm xúc ${emoji} vào tin nhắn.`;
            return { success: true, message: msg, reply: msg };
        }

        if (action === 'unreact') {
            if (!emoji) {
                const msg = 'Cần cung cấp emoji.';
                return { success: false, message: msg, reply: msg };
            }
            const reaction = targetMsg.reactions?.cache?.get(emoji) || targetMsg.reactions?.resolve?.(emoji);
            if (reaction) {
                await reaction.users.remove(me.id);
                const msg = `Đã gỡ cảm xúc ${emoji} khỏi tin nhắn.`;
                return { success: true, message: msg, reply: msg };
            }
            const msg = `Không tìm thấy cảm xúc ${emoji} của bot trên tin nhắn.`;
            return { success: false, message: msg, reply: msg };
        }

        if (action === 'pin') {
            if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            await targetMsg.pin();
            const msg = 'Đã ghim tin nhắn.';
            return { success: true, message: msg, reply: msg };
        }

        if (action === 'unpin') {
            if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            await targetMsg.unpin();
            const msg = 'Đã bỏ ghim tin nhắn.';
            return { success: true, message: msg, reply: msg };
        }

        if (action === 'create_thread') {
            if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.CreatePublicThreads)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            const name = (thread_name || 'Cuộc trò chuyện').slice(0, 100);
            const thread = await targetMsg.startThread({ name, autoArchiveDuration: 1440 });
            const msg = `Đã tạo luồng thảo luận "${thread.name}".`;
            return { success: true, threadId: thread.id, message: msg, reply: msg };
        }

        const msg = tr('messages.discordfunctions.text_invalid_action');
        return { success: false, message: msg, reply: msg };
    } catch (err) {
        Logger.error(tr('logs.discordfunctions.error_tool_failed', { tool: 'manage_message', error: err.message }));
        const msg = `Thao tác thất bại: ${err.message}`;
        return { success: false, message: msg, reply: msg };
    }
}

export async function manage_channel({ action, target, name, topic, slowmode_seconds, channel_type, reason, user, guild, channel, message, entityMap }) {
    if (!isOwner(user?.id)) {
        Logger.warn(tr('logs.discordfunctions.warn_forbidden', { tool: 'manage_channel' }));
        const msg = tr('messages.discordfunctions.text_forbidden');
        return { success: false, message: msg, reply: msg };
    }
    if (!guild) {
        const msg = tr('messages.discordfunctions.text_guild_required');
        return { success: false, message: msg, reply: msg };
    }

    try {
        Logger.info(tr('logs.discordfunctions.info_tool_invoked', { tool: 'manage_channel', action: action || 'unknown', userId: user?.id || 'unknown' }));
        const me = await guild.members.fetchMe();
        const auditReason = (reason || `Theo yêu cầu của ${user?.id}`).slice(0, 512);

        if (action === 'create_channel') {
            if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            const cName = (name || 'kênh-mới').slice(0, 100);
            const cType = channel_type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
            const created = await guild.channels.create({ name: cName, type: cType, reason: auditReason });
            const msg = `Đã tạo kênh mới "${created.name}".`;
            return { success: true, channelId: created.id, message: msg, reply: msg };
        }

        const targetChan = entityMap?.get(target) || channel;
        if (!targetChan) {
            const msg = 'Không tìm thấy kênh được chỉ định.';
            return { success: false, message: msg, reply: msg };
        }

        if (action === 'rename') {
            if (!targetChan.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            if (!name) {
                const msg = 'Cần cung cấp tên mới cho kênh.';
                return { success: false, message: msg, reply: msg };
            }
            const newName = name.slice(0, 100);
            await targetChan.setName(newName, auditReason);
            const msg = `Đã đổi tên kênh thành "${newName}".`;
            return { success: true, channelId: targetChan.id, message: msg, reply: msg };
        }

        if (action === 'set_topic') {
            if (!targetChan.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            if (targetChan.isVoiceBased()) {
                const msg = 'Kênh thoại không có chủ đề (topic).';
                return { success: false, message: msg, reply: msg };
            }
            const newTopic = (topic || '').slice(0, 1024);
            await targetChan.setTopic(newTopic, auditReason);
            const msg = 'Đã cập nhật chủ đề kênh.';
            return { success: true, channelId: targetChan.id, message: msg, reply: msg };
        }

        if (action === 'slowmode') {
            if (!targetChan.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            if (targetChan.isVoiceBased()) {
                const msg = 'Kênh thoại không hỗ trợ chế độ chậm (slowmode).';
                return { success: false, message: msg, reply: msg };
            }
            const secs = Math.max(0, Math.min(21600, parseInt(slowmode_seconds, 10) || 0));
            await targetChan.setRateLimitPerUser(secs, auditReason);
            const msg = secs > 0 ? `Đã đặt chế độ chậm ${secs} giây cho kênh "${targetChan.name}".` : `Đã tắt chế độ chậm cho kênh "${targetChan.name}".`;
            return { success: true, channelId: targetChan.id, slowmode_seconds: secs, message: msg, reply: msg };
        }

        if (action === 'lock') {
            if (!targetChan.permissionsFor(me)?.has(PermissionFlagsBits.ManageRoles)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            await targetChan.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }, { reason: auditReason });
            const msg = `Đã khóa kênh "${targetChan.name}".`;
            return { success: true, channelId: targetChan.id, message: msg, reply: msg };
        }

        if (action === 'unlock') {
            if (!targetChan.permissionsFor(me)?.has(PermissionFlagsBits.ManageRoles)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            await targetChan.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }, { reason: auditReason });
            const msg = `Đã mở khóa kênh "${targetChan.name}".`;
            return { success: true, channelId: targetChan.id, message: msg, reply: msg };
        }

        if (action === 'delete_channel') {
            if (!targetChan.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            const deletedName = targetChan.name;
            await targetChan.delete(auditReason);
            const msg = `Đã xóa kênh "${deletedName}".`;
            return { success: true, message: msg, reply: msg };
        }

        const msg = tr('messages.discordfunctions.text_invalid_action');
        return { success: false, message: msg, reply: msg };
    } catch (err) {
        Logger.error(tr('logs.discordfunctions.error_tool_failed', { tool: 'manage_channel', error: err.message }));
        const msg = `Thao tác thất bại: ${err.message}`;
        return { success: false, message: msg, reply: msg };
    }
}
