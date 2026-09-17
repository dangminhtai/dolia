import { t as tr } from '../services/i18nService.js';
import { EmbedBuilder } from 'discord.js';

/**
 * Xây dựng Embed chuẩn cho bot Dolia
 * @param {object} options
 * @param {string} [options.title]
 * @param {string} [options.description]
 * @param {string|number} [options.color]
 * @param {Array<{name: string, value: string, inline?: boolean}>} [options.fields]
 * @param {string|{text: string, iconURL?: string}} [options.footer]
 * @param {string} [options.thumbnail]
 * @param {string} [options.image]
 * @param {boolean} [options.timestamp]
 * @returns {EmbedBuilder}
 */
export function buildEmbed(options = {}) {
    const embed = new EmbedBuilder();

    if (options.title) embed.setTitle(options.title);
    if (options.description) embed.setDescription(options.description);
    if (options.color) embed.setColor(options.color);
    if (options.fields && Array.isArray(options.fields)) embed.addFields(options.fields);
    if (options.thumbnail) embed.setThumbnail(options.thumbnail);
    if (options.image) embed.setImage(options.image);
    if (options.footer) {
        if (typeof options.footer === 'string') {
            embed.setFooter({ text: options.footer });
        } else {
            embed.setFooter(options.footer);
        }
    }
    if (options.timestamp !== false) embed.setTimestamp();

    return embed;
}

/**
 * Tạo nhanh Embed thông báo lỗi
 * @param {string} message - Nội dung lỗi
 * @returns {EmbedBuilder}
 */
export function buildErrorEmbed(message) {
    return buildEmbed({
        title: tr('messages.messagebuilder.title_loi'),
        description: message,
        color: '#FF0000'
    });
}

/**
 * Tạo nhanh Embed thông báo thành công
 * @param {string} message - Nội dung thành công
 * @returns {EmbedBuilder}
 */
export function buildSuccessEmbed(message) {
    return buildEmbed({
        title: tr('messages.messagebuilder.title_thanh_cong'),
        description: message,
        color: '#00FF00'
    });
}

export default {
    buildEmbed,
    buildErrorEmbed,
    buildSuccessEmbed
};
