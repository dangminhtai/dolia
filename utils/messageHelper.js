import { t as tr } from '../services/i18nService.js';
import { AttachmentBuilder } from "discord.js";
import fs from "fs";
import path from "path";

/**
 * Sends a message safely, handling long content by attaching it as a file if it exceeds Discord's limit.
 * @param {import("discord.js").CommandInteraction | import("discord.js").Message} message 
 * @param {string} content 
 * @param {object} options 
 */
export async function sendSafeMessage(message, content, options = {}) {
    if (!content) return;

    if (typeof content !== "string") {
        content = String(content);
    }

    if (content.length <= 2000 && !options.forceFile) {
        if (message.deferred || message.replied) {
            await message.editReply({ content, ...options });
        } else {
            await message.reply({ content, ...options });
        }
        return;
    }

    const fileName = options.fileName || "long_message.md";
    const filePath = path.join(process.cwd(), fileName);
    fs.writeFileSync(filePath, content, "utf-8");

    const file = new AttachmentBuilder(filePath);

    const replyData = {
        content: options.fileContent || tr('messages.messagehelper.text_tin_nhan_qua_dai_xem_file'),
        files: [file],
    };

    if (message.deferred || message.replied) {
        await message.editReply(replyData);
    } else {
        await message.reply(replyData);
    }

    // Clean up
    try {
        fs.unlinkSync(filePath);
    } catch (err) {
        console.error(tr('logs.messagehelper.error_failed_to_delete_temp_file'), err);
    }
}
