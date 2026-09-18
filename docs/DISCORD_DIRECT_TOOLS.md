# Dolia Discord Direct Tool Suite

Bản này map các khả năng Discord runtime sang function calling trực tiếp. Mục tiêu: thao tác nhanh, deterministic, ít token, không dựng `agent_code` cho công việc mà `discord.js` đã làm được.

## Kiến trúc

```text
Natural language
  -> Gemini tool selection
  -> discord_query / discord_action
  -> request-scoped entity registry
  -> discord.js
  -> Discord API
```

LLM chỉ dùng ref tạm (`author`, `bot`, `u1`, `role1`, `channel1`, `replied_message`...), còn Snowflake ID nằm ở executor.

## Query actions (37)

`server_overview`, `list_members`, `online_members`, `voice_members`, `member_profile`, `member_permissions`, `channel_overview`, `channel_permissions`, `channel_overwrites`, `list_channels`, `list_roles`, `role_overview`, `role_members`, `recent_messages`, `pinned_messages`, `message_overview`, `reaction_users`, `list_emojis`, `list_stickers`, `list_soundboard_sounds`, `forum_tags`, `list_bans`, `list_invites`, `list_scheduled_events`, `scheduled_event_subscribers`, `list_active_threads`, `list_archived_threads`, `thread_members`, `list_webhooks`, `list_automod_rules`, `list_integrations`, `list_commands`, `audit_log_recent`, `server_vanity`, `welcome_screen`, `bot_permissions`, `bot_profile`.

## Mutation actions (144)

Các action được nhóm trong `schema/discordTools.js` và thực thi tại `utils/discordFunctions.js`, gồm message, member/moderation, voice/stage, channel/permission, invite/webhook, thread/forum, role, bot identity/presence, guild/assets, scheduled event và AutoMod.

## Guardrails

- Mọi mutation là `OWNER_ID` only.
- Executor dùng Discord object thật, không fuzzy-match tên và không tin Snowflake ID do model tự bịa.
- `allowedMentions: { parse: [] }` được dùng khi gửi text tự do để tránh ping ngoài ý muốn.
- Không expose webhook token.
- Không hỗ trợ bot tự leave guild, delete guild/transfer ownership hoặc prune hàng loạt.
- Discord permission, hierarchy, feature availability và rate limit vẫn do Discord quyết định; lỗi API được trả nguyên nhân thực tế.
- Presence cần `GuildPresences` intent được bật cả trong code và Developer Portal.

## Version target

Project lockfile hiện khóa `discord.js` 14.23.2. Direct tool suite được đối chiếu với API surface của dòng v14 tương ứng và không nâng dependency để giữ khả năng drop-in/Termux.
