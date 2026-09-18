import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { isOwner } from '../services/authorizationService.js';
import { t as tr } from '../services/i18nService.js';
import Logger from '../class/Logger.js';

export async function resolveAvatarUser({ user_id, user, guild, message }) {
    const id = user_id || user?.id;
    if (!id || !/^\d{17,20}$/.test(id)) throw new Error('INVALID_USER_ID');
    if (id === user?.id) return user;
    if (guild) {
        try {
            const member = await guild.members.fetch(id);
            if (member?.user) return member.user;
        } catch (_) {}
    }
    const mentioned = message?.mentions?.users?.get(id);
    if (mentioned) return mentioned;
    try {
        const fetchedUser = await message?.client?.users?.fetch(id);
        if (fetchedUser) return fetchedUser;
    } catch (_) {}
    throw new Error('USER_NOT_FOUND');
}

export async function get_avatar(args) {
    const { user } = args || {};
    try {
        Logger.info(tr('logs.discordfunctions.info_tool_invoked', { tool: 'get_avatar', action: 'get_avatar', userId: user?.id || 'unknown' }));
        const target = await resolveAvatarUser(args);
        const url = target.displayAvatarURL({ extension: 'png', size: 512, forceStatic: true });
        const text = `Ảnh đại diện của ${target.username}: ${url}`;
        return { success: true, userId: target.id, url, message: text, reply: text };
    } catch (err) {
        Logger.error(tr('logs.discordfunctions.error_tool_failed', { tool: 'get_avatar', error: err.message }));
        const text = 'Không tìm thấy người dùng hoặc ID không hợp lệ.';
        return { success: false, message: text, reply: text };
    }
}

export async function moderate_discord({ action, user_id, count, message_id, reason, duration_minutes, user, guild, channel, message }) {
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
            if (message_id) {
                if (!/^\d{17,20}$/.test(message_id)) {
                    const msg = 'ID tin nhắn không hợp lệ.';
                    return { success: false, message: msg, reply: msg };
                }
                const target = await channel.messages.fetch(message_id);
                await target.delete();
                const msg = 'Mình đã xóa tin nhắn bạn chỉ định.';
                return { success: true, deleted: 1, message: msg, reply: msg };
            }
            if (!Number.isInteger(count) || count < 1 || count > 100) {
                const msg = 'Bạn muốn xóa bao nhiêu tin nhắn? Mỗi lượt từ 1 đến 100 tin trong kênh này.';
                return { success: false, message: msg, reply: msg };
            }
            const selected = await channel.messages.fetch({ limit: count, before: message?.id });
            const deleted = await channel.bulkDelete(selected, true);
            const msg = `Mình đã xóa ${deleted.size} tin nhắn trong kênh này. Những tin quá 14 ngày không được xóa theo lượt.`;
            return { success: true, deleted: deleted.size, message: msg, reply: msg };
        }

        if (!user_id || !/^\d{17,20}$/.test(user_id)) {
            const msg = 'Bạn hãy nhắc tên bằng @ hoặc gửi ID người cần xử lý.';
            return { success: false, message: msg, reply: msg };
        }

        // Require target in current request
        const hasMention = message?.mentions?.users?.has(user_id);
        const hasIdInContent = String(message?.content || '').match(/\d{17,20}/g)?.includes(user_id);
        if (!hasMention && !hasIdInContent) {
            const msg = tr('messages.discordfunctions.text_user_mention_required');
            return { success: false, message: msg, reply: msg };
        }

        if ([user?.id, guild.ownerId, me.id].includes(user_id)) {
            const msg = tr('messages.discordfunctions.text_protected_user');
            return { success: false, message: msg, reply: msg };
        }

        const target = await guild.members.fetch({ user: user_id, force: true });
        const auditReason = (reason || `Theo yêu cầu của ${user?.id}`).slice(0, 512);

        if (action === 'kick') {
            if (!target.kickable) {
                const msg = 'Vai trò hoặc quyền hiện tại không cho phép mình xử lý người này.';
                return { success: false, message: msg, reply: msg };
            }
            await target.kick(auditReason);
            const msg = `Mình đã đưa ${target.user.username} ra khỏi máy chủ.`;
            return { success: true, userId: user_id, message: msg, reply: msg };
        }

        if (action === 'ban') {
            if (!target.bannable) {
                const msg = 'Vai trò hoặc quyền hiện tại không cho phép mình xử lý người này.';
                return { success: false, message: msg, reply: msg };
            }
            await target.ban({ reason: auditReason, deleteMessageSeconds: 0 });
            const msg = `Mình đã cấm ${target.user.username} tham gia máy chủ.`;
            return { success: true, userId: user_id, message: msg, reply: msg };
        }

        if (action === 'timeout') {
            if (!target.moderatable) {
                const msg = 'Vai trò hoặc quyền hiện tại không cho phép mình xử lý người này.';
                return { success: false, message: msg, reply: msg };
            }
            const mins = Math.max(1, Math.min(40320, parseInt(duration_minutes, 10) || 5));
            await target.timeout(mins * 60 * 1000, auditReason);
            const msg = `Đã tạm khóa (timeout) ${target.user.username} trong ${mins} phút.`;
            return { success: true, userId: user_id, duration_minutes: mins, message: msg, reply: msg };
        }

        if (action === 'untimeout') {
            if (!target.moderatable) {
                const msg = 'Vai trò hoặc quyền hiện tại không cho phép mình xử lý người này.';
                return { success: false, message: msg, reply: msg };
            }
            await target.timeout(null, auditReason);
            const msg = `Đã gỡ tạm khóa (timeout) cho ${target.user.username}.`;
            return { success: true, userId: user_id, message: msg, reply: msg };
        }
    } catch (err) {
        Logger.error(tr('logs.discordfunctions.error_tool_failed', { tool: 'moderate_discord', error: err.message }));
        const msg = `Thao tác thất bại: ${err.message}`;
        return { success: false, message: msg, reply: msg };
    }
}

export async function manage_member({ action, user_id, nickname, role_id, target_channel_id, reason, user, guild, channel, message }) {
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

        if (action === 'set_nickname') {
            if (!me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            const targetId = user_id || me.id;
            const target = await guild.members.fetch({ user: targetId, force: true });
            if (target.id !== me.id && target.roles.highest.position >= me.roles.highest.position) {
                const msg = 'Không thể đổi biệt danh do vai trò của thành viên này cao hơn hoặc bằng bot.';
                return { success: false, message: msg, reply: msg };
            }
            const newNick = nickname ? String(nickname).slice(0, 32) : null;
            await target.setNickname(newNick, auditReason);
            const msg = newNick ? `Đã đổi biệt danh của ${target.user.username} thành "${newNick}".` : `Đã xóa biệt danh của ${target.user.username}.`;
            return { success: true, userId: target.id, message: msg, reply: msg };
        }

        if (action === 'add_role' || action === 'remove_role') {
            if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            if (!user_id || !role_id) {
                const msg = 'Cần cung cấp user_id và role_id.';
                return { success: false, message: msg, reply: msg };
            }
            const target = await guild.members.fetch({ user: user_id, force: true });
            const role = await guild.roles.fetch(role_id);
            if (!role) {
                const msg = 'Không tìm thấy vai trò (role) được chỉ định.';
                return { success: false, message: msg, reply: msg };
            }
            if (me.roles.highest.position <= role.position) {
                const msg = 'Vai trò này cao hơn hoặc bằng vai trò cao nhất của bot, không thể thao tác.';
                return { success: false, message: msg, reply: msg };
            }

            if (action === 'add_role') {
                await target.roles.add(role, auditReason);
                const msg = `Đã thêm vai trò "${role.name}" cho ${target.user.username}.`;
                return { success: true, userId: target.id, roleId: role.id, message: msg, reply: msg };
            } else {
                await target.roles.remove(role, auditReason);
                const msg = `Đã xóa vai trò "${role.name}" khỏi ${target.user.username}.`;
                return { success: true, userId: target.id, roleId: role.id, message: msg, reply: msg };
            }
        }

        if (action === 'move_voice') {
            if (!me.permissions.has(PermissionFlagsBits.MoveMembers)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            if (!user_id || !target_channel_id) {
                const msg = 'Cần cung cấp user_id và target_channel_id.';
                return { success: false, message: msg, reply: msg };
            }
            const target = await guild.members.fetch({ user: user_id, force: true });
            if (!target.voice?.channel) {
                const msg = `${target.user.username} hiện không ở trong kênh thoại nào.`;
                return { success: false, message: msg, reply: msg };
            }
            const targetChan = await guild.channels.fetch(target_channel_id);
            if (!targetChan?.isVoiceBased()) {
                const msg = 'Kênh đích không phải là kênh thoại.';
                return { success: false, message: msg, reply: msg };
            }
            await target.voice.setChannel(targetChan, auditReason);
            const msg = `Đã chuyển ${target.user.username} sang kênh thoại "${targetChan.name}".`;
            return { success: true, userId: target.id, channelId: targetChan.id, message: msg, reply: msg };
        }

        if (action === 'disconnect_voice') {
            if (!me.permissions.has(PermissionFlagsBits.MoveMembers)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            if (!user_id) {
                const msg = 'Cần cung cấp user_id.';
                return { success: false, message: msg, reply: msg };
            }
            const target = await guild.members.fetch({ user: user_id, force: true });
            if (!target.voice?.channel) {
                const msg = `${target.user.username} hiện không ở trong kênh thoại nào.`;
                return { success: false, message: msg, reply: msg };
            }
            await target.voice.disconnect(auditReason);
            const msg = `Đã ngắt kết nối kênh thoại của ${target.user.username}.`;
            return { success: true, userId: target.id, message: msg, reply: msg };
        }

        const msg = tr('messages.discordfunctions.text_invalid_action');
        return { success: false, message: msg, reply: msg };
    } catch (err) {
        Logger.error(tr('logs.discordfunctions.error_tool_failed', { tool: 'manage_member', error: err.message }));
        const msg = `Thao tác thất bại: ${err.message}`;
        return { success: false, message: msg, reply: msg };
    }
}

export async function manage_message({ action, message_id, emoji, thread_name, user, guild, channel, message }) {
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

        if (action === 'react') {
            if (!emoji) {
                const msg = 'Cần cung cấp emoji.';
                return { success: false, message: msg, reply: msg };
            }
            const targetMsg = message_id ? await channel.messages.fetch(message_id) : message;
            await targetMsg.react(emoji);
            const msg = `Đã thả cảm xúc ${emoji} vào tin nhắn.`;
            return { success: true, message: msg, reply: msg };
        }

        if (action === 'unreact') {
            if (!emoji) {
                const msg = 'Cần cung cấp emoji.';
                return { success: false, message: msg, reply: msg };
            }
            const targetMsg = message_id ? await channel.messages.fetch(message_id) : message;
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
            const targetMsg = message_id ? await channel.messages.fetch(message_id) : message;
            await targetMsg.pin();
            const msg = 'Đã ghim tin nhắn.';
            return { success: true, message: msg, reply: msg };
        }

        if (action === 'unpin') {
            if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            const targetMsg = message_id ? await channel.messages.fetch(message_id) : message;
            await targetMsg.unpin();
            const msg = 'Đã bỏ ghim tin nhắn.';
            return { success: true, message: msg, reply: msg };
        }

        if (action === 'create_thread') {
            if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.CreatePublicThreads)) {
                const msg = tr('messages.discordfunctions.text_no_permission');
                return { success: false, message: msg, reply: msg };
            }
            const targetMsg = message_id ? await channel.messages.fetch(message_id) : message;
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

export async function manage_channel({ action, channel_id, name, topic, slowmode_seconds, channel_type, reason, user, guild, channel, message }) {
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

        const targetChan = channel_id ? await guild.channels.fetch(channel_id) : channel;
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
