/**
 * Thay thế các placeholder trong chuỗi bằng dữ liệu thực tế từ Discord.
 * @param {string} template - Chuỗi gốc chứa placeholder (ví dụ: "Chào {{user}}").
 * @param {object} context - Object chứa context (message hoặc interaction).
 * @returns {string} Chuỗi đã được format.
 */
export function formatString(template, context) {
    if (!template) return "";

    // Đảm bảo context hợp lệ
    const msg = context;
    const user = msg.author || msg.user;
    const member = msg.member;
    const guild = msg.guild;
    const channel = msg.channel;
    const client = msg.client || (guild ? guild.client : null) || (user ? user.client : null);

    // Helper formatting time
    const formatDate = (date) => {
        if (!date) return "N/A";
        return new Date(date).toLocaleString("vi-VN", {
            timeZone: "Asia/Ho_Chi_Minh",
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        });
    };

    const formatTimeShort = (date) => {
        if (!date) return "N/A";
        return new Date(date).toLocaleTimeString("vi-VN", {
            timeZone: "Asia/Ho_Chi_Minh",
            hour12: false
        });
    }

    const formatDateShort = (date) => {
        if (!date) return "N/A";
        return new Date(date).toLocaleDateString("vi-VN", {
            timeZone: "Asia/Ho_Chi_Minh"
        });
    }

    // Helper tính tuổi
    const getAge = (date) => {
        if (!date) return "N/A";
        const now = new Date();
        const created = new Date(date);
        const diffTime = Math.abs(now - created);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 30) return `${diffDays} ngày`;
        if (diffDays < 365) return `${Math.floor(diffDays / 30)} tháng`;
        return `${Math.floor(diffDays / 365)} năm`;
    };

    // Chuẩn bị dữ liệu
    const now = new Date();

    const replacements = {
        // --- User Context ---
        "{{user}}": user ? `<@${user.id}>` : "",
        "{{user_id}}": user ? user.id : "",
        "{{user_name}}": user ? user.username : "",
        "{{user_global_name}}": user ? (user.globalName || user.username) : "",
        "{{nickname}}": member ? member.displayName : (user ? (user.globalName || user.username) : ""),
        "{{user_tag}}": user ? user.tag : "", // Tag legacy
        "{{user_avatar}}": user ? (user.displayAvatarURL({ dynamic: true }) || "") : "",
        "{{user_created_at}}": user ? formatDate(user.createdAt) : "",
        "{{user_joined_at}}": member ? formatDate(member.joinedAt) : "",
        "{{user_age}}": user ? getAge(user.createdAt) : "",

        // --- Server / Guild Context ---
        "{{server_name}}": guild ? guild.name : "DM",
        "{{server_id}}": guild ? guild.id : "",
        "{{member_count}}": guild ? guild.memberCount.toString() : "0",
        "{{server_icon}}": guild ? (guild.iconURL({ dynamic: true }) || "") : "",
        "{{server_owner_id}}": guild ? guild.ownerId : "",

        // --- Bot Context ---
        "{{bot_name}}": client && client.user ? client.user.username : "Bot",
        "{{bot_id}}": client && client.user ? client.user.id : "",
        "{{bot_avatar}}": client && client.user ? (client.user.displayAvatarURL({ dynamic: true }) || "") : "",
        "{{bot_ping}}": client && client.ws ? `${client.ws.ping}ms` : "",

        // --- Channel Context ---
        "{{channel_name}}": channel ? channel.name : "DM",
        "{{channel_id}}": channel ? channel.id : "",
        "{{channel_mention}}": channel ? `<#${channel.id}>` : "",
        "{{channel_topic}}": channel ? (channel.topic || "") : "",

        // --- Time & Utilities ---
        "{{vn_time}}": formatTimeShort(now),
        "{{timestamp}}": Math.floor(now.getTime() / 1000).toString(),
        "{{date}}": formatDateShort(now),
        "{{time}}": formatTimeShort(now),
    };

    // Regex tìm tất cả các pattern {{key}} hoặc {{ key }}
    // Cờ 'i' để không phân biệt hoa thường
    return template.replace(/{{\s*(.*?)\s*}}/gi, (match, key) => {
        // key đã được trim khoảng trắng nhờ regex \s*
        const normalizedKey = "{{" + key.toLowerCase() + "}}";

        // Kiểm tra xem key có trong danh sách replacement không
        // Vì key trong replacements là lowercase (nếu mình viết thường hết ở trên)
        // Nhưng ở trên mình viết {{user_name}}, nên mình cần đảm bảo key cũng lowercase.
        // Tuy nhiên, key trong replacements map đang viết thường.

        if (Object.prototype.hasOwnProperty.call(replacements, normalizedKey)) {
            return replacements[normalizedKey];
        }

        // Nếu không tìm thấy, trả về nguyên mẫu (hoặc có thể trả về "N/A" tùy yêu cầu)
        return match;
    });
}

