const TEXT_EXTENSIONS = /\.(js|bak|txt|json|py|md|ts|html|css|csv|xml|yml|yaml)$/i;

const IMAGE_MIME_BY_EXT = new Map([
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.webp', 'image/webp'],
    ['.heic', 'image/heic'],
    ['.heif', 'image/heif']
]);

export const SUPPORTED_GEMINI_IMAGE_MIMES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/heic',
    'image/heif'
]);

function extensionOf(name = '') {
    const value = String(name || '').toLowerCase();
    const index = value.lastIndexOf('.');
    return index >= 0 ? value.slice(index) : '';
}

export function imageMimeOf(attachment) {
    const declared = String(attachment?.contentType || '').split(';')[0].trim().toLowerCase();
    if (SUPPORTED_GEMINI_IMAGE_MIMES.has(declared)) return declared;
    return IMAGE_MIME_BY_EXT.get(extensionOf(attachment?.name)) || null;
}

function uniqueAttachments(entries) {
    const seen = new Set();
    const result = [];
    for (const entry of entries) {
        const att = entry?.attachment;
        if (!att) continue;
        const key = String(att.id || att.url || `${att.name}:${att.size}`);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(entry);
    }
    return result;
}

async function getRepliedMessage(message) {
    if (!message?.reference?.messageId || !message?.channel?.messages?.fetch) return null;
    try {
        return await message.channel.messages.fetch(message.reference.messageId);
    } catch (_) {
        return null;
    }
}

/**
 * Prepares Discord attachments for a Gemini generateContent request.
 * - Text attachments are inserted as text only, with conservative size limits.
 * - Images are passed as inlineData and never returned for persistence.
 * - Attachments on the replied message are included too, which enables natural
 *   flows such as replying "giải bài này" to an earlier image.
 */
export async function prepareDiscordAttachments(message, options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const maxVisionBytes = options.maxVisionBytes ?? (8 * 1024 * 1024);
    const maxVisionFiles = options.maxVisionFiles ?? 6;
    const maxTextFileBytes = options.maxTextFileBytes ?? (256 * 1024);
    const maxTextTotalBytes = options.maxTextTotalBytes ?? (512 * 1024);

    const entries = [];
    for (const att of message?.attachments?.values?.() || []) {
        entries.push({ attachment: att, source: 'current' });
    }

    const replied = await getRepliedMessage(message);
    for (const att of replied?.attachments?.values?.() || []) {
        entries.push({ attachment: att, source: 'reply' });
    }

    const attachments = uniqueAttachments(entries);
    const textBlocks = [];
    const imageParts = [];
    const imageNotes = [];
    const warnings = [];

    let visionBytes = 0;
    let textBytes = 0;

    for (const { attachment: att, source } of attachments) {
        const name = att?.name || 'attachment';
        const mime = imageMimeOf(att);

        if (mime) {
            if (imageParts.length >= maxVisionFiles) {
                warnings.push(`Bỏ qua ảnh ${name}: vượt giới hạn ${maxVisionFiles} ảnh mỗi lượt.`);
                imageNotes.push(`[Ảnh ${source === 'reply' ? 'từ tin nhắn được reply' : 'đính kèm'}: ${name}; chưa được nạp vì vượt giới hạn số ảnh]`);
                continue;
            }

            const declaredSize = Number(att?.size || 0);
            if (declaredSize > 0 && visionBytes + declaredSize > maxVisionBytes) {
                warnings.push(`Bỏ qua ảnh ${name}: tổng dung lượng ảnh vượt ${Math.round(maxVisionBytes / 1024 / 1024)} MB.`);
                imageNotes.push(`[Ảnh ${source === 'reply' ? 'từ tin nhắn được reply' : 'đính kèm'}: ${name}; chưa được nạp vì quá lớn]`);
                continue;
            }

            try {
                const res = await fetchImpl(att.url);
                if (!res?.ok) {
                    warnings.push(`Không tải được ảnh ${name}: HTTP ${res?.status || 'unknown'}.`);
                    imageNotes.push(`[Ảnh ${name}; không tải được từ Discord]`);
                    continue;
                }
                const arrayBuffer = await res.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                if (visionBytes + buffer.length > maxVisionBytes) {
                    warnings.push(`Bỏ qua ảnh ${name}: tổng dung lượng ảnh vượt ${Math.round(maxVisionBytes / 1024 / 1024)} MB.`);
                    imageNotes.push(`[Ảnh ${name}; chưa được nạp vì quá lớn]`);
                    continue;
                }

                visionBytes += buffer.length;
                imageParts.push({ inlineData: { mimeType: mime, data: buffer.toString('base64') } });
                imageNotes.push(`[Ảnh ${source === 'reply' ? 'từ tin nhắn được reply' : 'đính kèm'}: ${name}; loại: ${mime}]`);
            } catch (error) {
                warnings.push(`Không thể tải ảnh ${name}: ${error?.message || String(error)}`);
                imageNotes.push(`[Ảnh ${name}; không thể tải từ Discord]`);
            }
            continue;
        }

        if (!TEXT_EXTENSIONS.test(name)) continue;

        const declaredSize = Number(att?.size || 0);
        if ((declaredSize > 0 && declaredSize > maxTextFileBytes) || textBytes >= maxTextTotalBytes) {
            warnings.push(`Bỏ qua file text ${name}: vượt giới hạn đọc file.`);
            textBlocks.push(`[Tệp đính kèm: ${name}; chưa đọc vì file quá lớn]`);
            continue;
        }

        try {
            const res = await fetchImpl(att.url);
            if (!res?.ok) {
                warnings.push(`Không đọc được file ${name}: HTTP ${res?.status || 'unknown'}.`);
                continue;
            }
            const content = await res.text();
            const bytes = Buffer.byteLength(content, 'utf8');
            if (bytes > maxTextFileBytes || textBytes + bytes > maxTextTotalBytes) {
                warnings.push(`Bỏ qua file text ${name}: vượt giới hạn đọc file.`);
                textBlocks.push(`[Tệp đính kèm: ${name}; chưa đọc vì file quá lớn]`);
                continue;
            }
            textBytes += bytes;
            textBlocks.push(`[Tệp ${source === 'reply' ? 'từ tin nhắn được reply' : 'đính kèm'}: ${name}]\n\`\`\`\n${content}\n\`\`\``);
        } catch (error) {
            warnings.push(`Không thể đọc file ${name}: ${error?.message || String(error)}`);
        }
    }

    return {
        textBlocks,
        imageParts,
        imageNotes,
        warnings,
        visionBytes,
        imageCount: imageParts.length
    };
}
