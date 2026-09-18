# Dolia Stable Termux Complete

Bản này hợp nhất:

- Direct Discord tool suite: 37 query + 144 mutation actions.
- Request-scoped Discord entity refs (`author`, `bot`, `u1`, `recent1`, `replied_message`, ...).
- Gemini Vision trực tiếp cho ảnh Discord hiện tại và ảnh trong tin nhắn được reply.
- Ảnh không được lưu base64 vào MongoDB chat history.
- Direct Discord mutations có thể trả kết quả ngay để giảm một lượt Gemini khi executor đã có phản hồi xác định.
- Termux scripts và Android-compatible dependencies từ stable build.

## Vision

Hỗ trợ trực tiếp: PNG, JPEG, WEBP, HEIC, HEIF.

Giới hạn mặc định mỗi lượt:

- tối đa 6 ảnh;
- tổng tối đa 8 MiB ảnh;
- text attachment tối đa 256 KiB/file và 512 KiB/lượt.

Các giới hạn này giữ request nhỏ, phù hợp bot cá nhân 2–5 người và tránh tốn RAM trên Android.

## Test quan trọng

```bash
npm run check:resources
node --test test/test_discord_tool_suite_static.mjs
node --test test/test_vision_attachments.mjs
```
