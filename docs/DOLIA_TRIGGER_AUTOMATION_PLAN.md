# DOLIA — HYBRID TRIGGER & AUTOMATION ENGINE

> **Trạng thái:** Đã triển khai Phase 1 và nền tảng Phase 2 trong source hiện tại; generated module Phase 3 vẫn bị vô hiệu hóa cho tới khi có runtime cô lập thật.  
> **Nguồn kiểm tra:** `dangminhtai/dolia`, branch `main`, commit `e5953e5a5d64e1443301d5b452981716b6f7e389` (commit ngày 2026-09-23 22:39:22 UTC).  
> **Mục tiêu:** Cho Dolia tiếp nhận chỉ dẫn bằng ngôn ngữ tự nhiên, cài đặt trigger lâu dài, kết hợp công cụ sẵn có hoặc tự sinh script cho trường hợp chưa diễn đạt được, chạy khi không có ai đang chat với Dolia.  
> **Ranh giới:** Automation tách khỏi Memory; LLM chỉ tạo spec khai báo và không được tự thực thi code đặc quyền. Generated JavaScript được lưu như hướng mở rộng nhưng không thể enable/run trong V1.

## 0. Kết luận thiết kế

Dolia cần **Hybrid Automation Engine**, gồm ba mức triển khai theo mức phức tạp *của hành vi*, không phải độ dài câu lệnh:

1. **Configured rule:** event/time + điều kiện + action đã được code sẵn, không cần gọi Gemini lúc event xảy ra.
2. **Composed workflow:** kết hợp action có sẵn thành chuỗi có trạng thái, nhánh điều kiện và chờ; gọi Gemini/Web Search đúng bước cần AI.
3. **Generated automation module:** Agent sinh module/script khi workflow schema hiện tại không đủ. Module phải qua validate, test, approval, versioning và **runtime cô lập**, chỉ được gọi các capability host cấp.

Cả ba đều đăng ký vào **một Automation Registry, một hệ thống quyền, một engine thực thi và một bảng quản lý**. Không tạo file JS mới cho quy tắc tầm thường và cũng không bó buộc Dolia vào 10 câu lệnh được lập trình trước.

## 1. Hiện trạng đã đối chiếu trong repository

| File / thành phần | Sự thật từ code `e5953e5` | Hệ quả khi triển khai trigger |
|---|---|---|
| `index.js` | Đã bật nhiều Gateway intents: `GuildMembers`, `GuildMessages`, `MessageContent`, `GuildMessageReactions`, `AutoModerationExecution`, v.v.; đăng ký `messageCreate`, `interactionCreate`, `onReady` | Có nền tảng event; **chưa thấy listener `GuildMemberAdd` hay runner automation** trong cây source. Intents trong code không thay cho cấu hình privileged intents trong Developer Portal. |
| `events/client/messageCreate.js` | Bỏ qua bot/DM, và `if (message.channel.name !== 'dolia') return` trước khi gọi `GeminiManager.chat()` | Tách event dispatch cho automation **trước** bộ lọc AI chat, nhưng giữ filter để Dolia không chat lung tung toàn server. |
| `events/client/onReady.js` | Chỉ log và gọi `initLavalink(client)` | Thêm `automationService.start(client)` đúng một lần, khôi phục job khi ready; dừng scheduler khi shutdown. |
| `class/GeminiManager.js` | Tool registration cho music, Discord, memory, dev; inject `context` request; tool fast path | Thêm `automation_query`/`automation_action` ở tầng **tạo/quản lý rule**; không đưa toàn bộ GeminiManager vào event runner. |
| `utils/devFunctions.js` | `agent_code` hỗ trợ tự phát triển, `web_search` đã gọi Google Search grounding và trả `summary/sources` | Tái sử dụng giao diện chức năng nghiên cứu web cho scheduled brief; code generation chỉ dành cho custom module. |
| `services/selfDevService.js` | `runDynamicScript()` sinh code, ghi vào `sandbox/scripts`, `import()` module và gọi `runFn({client,guild,channel,user,message})` | **Không tái sử dụng đường thực thi này cho automation lâu dài:** code đang chạy trong host process, cầm Discord objects thật. |
| `core/sandbox/sandbox-manager.js` | `resolveSafePath()` bảo vệ file path; comment nêu rõ không cô lập code tự gọi `fs` | Filesystem sandbox **không phải** sandbox thực thi JS. |
| `core/sandbox/mapping-registry.js` | Host mapping cho `slash/`, `i18n/`, `scripts/`, `utils/`, `config/`; chặn `core/`, `events/`, `models/`, `schema/`... | Không sửa mapping/blacklist để “cho automation chạy”. Automation runtime phải có luồng registry/deploy riêng được review. |
| `core/sandbox/apply-engine.js` | Có approval, manifest re-validation, backup/apply/rollback file | Có thể tái sử dụng *mẫu transaction/approval*, không mặc định lấy chức năng apply code vào production để cài rule. |
| `models/Memory.js`, `services/memoryService.js`, `/memory` | Bộ nhớ dài hạn và UI đang có | Memory ghi sở thích; **automation là lời hứa thực hiện**, cần bảng và collection riêng. |
| `utils/discordFunctions.js` | `discord_action()` owner-only và lấy target từ entity registry theo **lượt chat hiện tại** | Event runner không thể giả lập message owner hay lưu `u1/channel1` để dùng ngày mai. Tạo host capability có input là stable Discord IDs đã xác minh. |
| `services/authorizationService.js` | Có `isOwner()` | Tái sử dụng owner check lúc create/manage; phải kiểm tra quyền bot, chủ rule và scope **lại ở lúc chạy**. |
| `models/Chat.js` | `agentSession.lastScript` và lịch sử chat | Không dùng lịch sử chat làm nguồn cấu hình scheduled jobs hoặc nơi duy nhất lưu script. |
| `scripts/termux-run.sh`, `scripts/install-termux-boot.sh` | Restart tiến trình, wake-lock/Termux:Boot | MongoDB giúp phục hồi lịch; Android offline thì không thể đảm bảo “đúng 07:00”. Cần chính sách missed-run rõ. |
| `package.json` | Node.js ESM, MongoDB Mongoose, `discord.js`, `@google/genai`; chưa có automation package chuyên biệt | Ưu tiên Node timers + MongoDB, chỉ thêm package khi kiểm tra được lợi ích và Termux compatibility. |

**Các file GitHub được đọc:**

- https://github.com/dangminhtai/dolia/blob/e5953e5/class/GeminiManager.js
- https://github.com/dangminhtai/dolia/blob/e5953e5/events/client/messageCreate.js
- https://github.com/dangminhtai/dolia/blob/e5953e5/events/client/onReady.js
- https://github.com/dangminhtai/dolia/blob/e5953e5/index.js
- https://github.com/dangminhtai/dolia/blob/e5953e5/utils/devFunctions.js
- https://github.com/dangminhtai/dolia/blob/e5953e5/services/selfDevService.js
- https://github.com/dangminhtai/dolia/blob/e5953e5/core/sandbox/sandbox-manager.js
- https://github.com/dangminhtai/dolia/blob/e5953e5/core/sandbox/mapping-registry.js
- https://github.com/dangminhtai/dolia/blob/e5953e5/services/memoryService.js

## 2. Hợp đồng ngôn ngữ tự nhiên

Các kiểu lệnh cần hiểu:

| Người dùng nói | Engine cần lập |
|---|---|
| “Mỗi khi tao nhắn trong #dolia thì thả cảm xúc” | `messageCreate` theo author/channel + reaction action; contextual sentiment chỉ khi cần. |
| “Đứa nào spam trong server thì kick” | Policy chống spam có **ngưỡng và hậu quả cụ thể**, admin phê duyệt trước khi enable kick. |
| “21h30–23h30 hằng tối chúc ngủ ngon #general” | Window scheduler, một lần/ngày, chọn slot và persist `nextRunAt`. |
| “7h sáng mỗi ngày cập nhật tin công nghệ mới nhất” | Daily scheduler → web research fresh → de-duplicate → tóm tắt có nguồn → gửi tới kênh/DM xác định. |
| “Ai join thì DM chào mừng” | `guildMemberAdd` → DM một lần cho member; handling DM blocked. |
| “Nếu A, rồi chờ 15 phút, còn B thì làm C” | Stateful workflow hoặc generated module nếu DSL không đáp ứng. |
| “Dừng trigger chúc ngủ ngon”, “sửa từ 7h thành 8h”, “xem trigger nào lỗi” | Query/edit/disable/history/panel, tham chiếu rule **stable ID**, không đoán từ ngữ cảnh xa. |

### Phân giải yêu cầu cần minh bạch

- Ai ra lệnh? `createdBy`, `guildId`, quyền hiện tại.
- Trigger nào? Event, lịch, polling có hạn mức, webhook đã xác minh, hoặc state transition.
- Đối tượng nào? `author`, channel, role, event member, DM target, không dùng entity ref request-scoped làm ID lưu lâu.
- Khi nào? IANA timezone (mặc định `Asia/Ho_Chi_Minh` khi user không chỉ rõ), instant, window, cron, missed-run policy.
- Hành động nào? Capability, dữ liệu đầu vào, quyền, giới hạn tần suất, rủi ro.
- Chạy một lần hay liên tục? Thời gian kết thúc, TTL, số lần tối đa.
- Điều gì cần hỏi lại? Người nhận bản tin chưa rõ, kênh đích chưa rõ, cách xác định spam/mức phạt chưa rõ, script cần quyền nhạy cảm.

## 3. Đăng ký tool vào Gemini

Chỉ expose hai tool quản trị với schema chặt chẽ:

```js
// Interface dự kiến, chưa tồn tại trong repo.
automation_query({ action: 'list' | 'get' | 'history' | 'preview', rule_id, scope, limit })
automation_action({ action: 'draft' | 'create' | 'update' | 'enable' | 'disable' | 'delete' | 'run_once', spec, rule_id })
```

Các thao tác `draft/create/update/delete/enable` cần current-turn intent, đối tượng và quyền thật. `delete` và `run_once` với action nguy hiểm cần gate riêng. Gemini không được tự điền `approvedBy`, `ownerId`, `guildId`, `capabilities` vượt phép; executor lấy từ context xác thực.

**Không dùng `agent_code` để nhảy qua bước phê duyệt:** nếu planner thấy cần code, tạo một `AutomationDraft` rồi đưa Agent sinh module, quay lại cùng pipeline review/deploy. Đừng để `agent_code` sửa thẳng `events/` hoặc `index.js` vì rule mới.

## 4. Trigger sources và cấu trúc chung

```text
Discord Gateway → Adapter → Canonical Event → Matching Rules
Clock / Due Jobs → Scheduler ────────────────┤
External Poll / Webhook (phase sau) ─────────┤
Internal Event / State Change ──────────────┘
                                          ↓
                                     Rule Evaluator
                                          ↓
                                  Capability / Runner
                                          ↓
                              Execution Log + Next Run
```

Đề xuất các adapter đầu tiên:

- `messageCreate`: reaction theo author/channel, moderation evidence, keyword; xử lý ở mọi guild channel được phép, độc lập kênh #dolia.
- `guildMemberAdd`: chào mừng và quy trình onboarding.
- `autoModerationActionExecution`: tận dụng khi rule yêu cầu evidence từ Discord AutoMod; không mặc định mọi spam đều được AutoMod bắt.
- `daily/once/window`: chúc ngủ ngon, bản tin lúc 07:00, nhắc việc.

Phase sau: `messageUpdate`, `guildMemberRemove`, `voiceStateUpdate`, `messageReactionAdd`, external polling/webhook, custom internal events. Không bật hàng loạt chỉ vì Discord đã khai báo nhiều intents.

Canonical event tối thiểu: `eventId`, `type`, `guildId`, `channelId`, `actorId`, `subjectId`, `occurredAt`, `source`, `data` đã giảm thiểu; không serialize Discord Client/Member hoặc token vào DB.

**Event dedupe:** Gateway event có id ổn định khi có thể; nếu thiếu, dùng deterministic event fingerprint + TTL. Rule + event tạo execution key duy nhất, không cùng một sự kiện chạy trùng khi nhiều listener hoặc restart.

## 5. Ba mức thực thi

### Level 1: Rule DSL, không script

Một schema có `trigger`, `conditions`, `actions`, `limits`, `permissions`, `schedule`, `status`. Cho phép cấu hình reaction, send message, DM member mới, chống spam đơn giản và task theo lịch.

```json
{
  "type": "event_rule",
  "trigger": { "type": "guildMemberAdd" },
  "conditions": [{ "kind": "member_not_welcomed" }],
  "actions": [{ "kind": "send_dm", "recipient": "event.member", "template": "welcome_v1" }],
  "limits": { "once_per_member": true }
}
```

### Level 2: Workflow, được ghép từ capability có sẵn

Workflow op đề xuất: `filter`, `branch`, `delay_until`, `fetch_discord`, `research_web`, `summarize`, `send_message`, `send_dm`, `react`, `update_state`. Mỗi bước khai báo input/output typed và deadline; không cho expression tùy ý eval thành JS.

```text
Daily 07:00
→ search technology news (lookback 24h)
→ compare previous story URLs/IDs
→ summarize with published date + sources
→ send to chosen destination
→ save last successful digest
```

Khởi đầu **ưu tiên Level 2 cho bản tin công nghệ**, vì `web_search` đã có; tách research service có thể được gọi từ scheduled runner, không giả mạo Discord `Message` để gọi GeminiManager. Chỉ nói “mới nhất” khi nguồn/cửa sổ truy vấn thực sự chứng minh, và nếu tra cứu lỗi thì báo lỗi thay vì đăng bản tin cũ giả làm tin mới.

### Level 3: Generated module

Chỉ khi Level 1/2 không đủ, Agent sinh code theo interface cố định:

```js
// API ĐỀ XUẤT, không phải API Dolia đã triển khai.
export const manifest = {
  apiVersion: '1',
  triggers: ['guildMemberAdd'],
  capabilities: ['discord.dm'],
  maxRuntimeMs: 5000
};

export async function execute(ctx) {
  await ctx.capabilities.discord.dm({
    userId: ctx.event.subjectId,
    content: 'Chào mừng bạn đến server!'
  });
}
```

- `ctx.event` chỉ chứa dữ liệu đã lọc, bất biến, không có raw Discord `client`.
- `ctx.capabilities` là API do host enforce, có allowlist target guild/channel/user, rate limit, scope và action-specific policy.
- `ctx.state` chỉ là namespace riêng của rule, quota dữ liệu và TTL; không được query MongoDB toàn cục.
- `ctx.log` đã redact; không được đọc `.env` hoặc OS process environment.
- Generated code/version được ký hash và gắn với manifest được duyệt; không chạy code được chỉnh sau approval.

## 6. Ranh giới bảo mật đặc biệt quan trọng

**Không chuyển `runDynamicScript()` hiện có sang automation chạy nền bằng một `setInterval()`.** Code hiện tại `import()` module vào process của bot, truyền `client/guild/channel` thật và dùng `Promise.race` 120s không hủy công việc gốc. `sandboxManager.resolveSafePath()` chỉ bảo vệ lối vào file manager, không chặn code được import gọi `fs`, `process`, `child_process`, network hoặc đọc credential.

Thiết kế an toàn:

1. **V1:** rules/workflows khai báo + capability host, **chưa cho generated JS tự chạy**.
2. **V2 generated modules:** child process/container sandbox đã kiểm thử trên Windows và Android Termux, tách environment không có Discord/Gemini tokens, OS isolation có thật. IPC schema allowlisted; process kill được khi timeout; memory/CPU/file/network hạn mức và egress có kiểm soát. Worker thread hoặc `node:vm` đơn lẻ **không phải security boundary đáng tin**.
3. Nếu Termux không có giải pháp runtime isolation đáng tin phù hợp, **tắt Level 3 tại Termux** hoặc chạy worker trên môi trường cô lập khác; không hạ chuẩn bằng cách `import()` trực tiếp cho tiện.
4. Approval dựa trên bản manifest **và code hash**. Thay code hoặc tăng capability → cần review và xác nhận lại.
5. Không cấp quyền `agent_code`, `fs`, shell, package install, fetch URL tùy ý hoặc MongoDB cho generated rule trừ khi có cơ chế riêng được duyệt cụ thể. Không diễn giải “đã approve automation” thành “đã approve sửa toàn bộ bot”.

**Existing Self-Dev Sandbox ≠ Automation Execution Sandbox.** Có thể tái sử dụng code generator/validator/transaction concepts nhưng phải thêm cổng runtime riêng.

## 7. Quyền và chính sách rủi ro

| Nhóm | Ví dụ | Tạo/bật | Kiểm tra lúc chạy |
|---|---|---|---|
| Cá nhân, tác động thấp | Reaction tin của người yêu cầu trong channel chọn trước | User tạo cho chính mình nếu bot có quyền | scope author/channel, opt-out, cooldown, bot permission |
| Guild non-destructive | Gửi chúc ngủ ngon vào kênh, welcome DM | Owner hoặc người có quyền quản lý guild theo policy được định nghĩa | channel tồn tại, guild còn hoạt động, bot send/DM allowed |
| Dùng AI/web | Bản tin mỗi sáng, phân loại cảm xúc | Người có quyền, có budget | quotas Gemini, search freshness, content source, retry bounded |
| Moderation/destructive | Timeout/kick/ban/delete messages/role | **Owner phê duyệt explicit**, policy/target rõ, ban/kick có thể yêu cầu xác nhận riêng | chống false positive, roles/hierarchy, exemptions, audit, at-most-once attempt |
| Generated JS | Script chưa có trong DSL | Owner + code/capability review | isolated runner, manifest hash, quota, full audit |

Ở `createdBy`, `approvedBy`, permission và `scope`: không bao giờ tin trường do Gemini điền. Lấy từ Discord message/interaction đã xác thực. Quyền tại thời điểm tạo **không đủ** cho lệnh chạy nhiều ngày sau; verify lại bot rights, target/hierarchy và rule approved revision trước mỗi action có hậu quả.

AutoMod/spam policy:
- Định nghĩa số tin/window, repeated-text threshold, loại trừ owner/admin/mod/bot và các trường hợp đặc biệt theo rule.
- Mặc định bắt đầu `observe → warn → timeout`/dry-run, không auto-kick theo câu “spam” chưa có ngưỡng rõ.
- Kick chỉ khi owner chọn mức phạt, xem preview ngưỡng/ngoại lệ và xác nhận enable.
- Evidence lưu gọn: message IDs/timestamp/metrics, không giữ toàn bộ chat nếu không cần.
- Không để LLM phân tích từng tin nhắn rồi tự quyết kick. Engine deterministic quyết định theo policy và evidence; LLM chỉ góp ý lập rule hoặc soạn thông báo.
- Chống race: cache sliding window trong RAM, TTL; với automation nhiều replica cần shared state hoặc single active execution lease, không tự nhận in-memory đảm bảo cross-process.

## 8. Data model / MongoDB

Tách khỏi Memory. Dự kiến:

```text
models/AutomationRule.js
models/AutomationExecution.js
models/AutomationDraft.js        # Có thể gom trong Rule nếu MVP đơn giản
models/AutomationState.js        # Cho workflow dài và script rule-scoped
```

`AutomationRule`:

```js
{
  guildId, createdBy, approvedBy,
  name, description,
  type: 'configured' | 'workflow' | 'generated',
  trigger: { type, config },
  conditions: [], steps: [],
  capabilityGrants: [],
  timezone: 'Asia/Ho_Chi_Minh',
  schedule: { nextRunAt, missedRunPolicy },
  enabled, status: 'draft' | 'pending_approval' | 'active' | 'paused' | 'error' | 'deleted',
  revision, moduleHash, moduleVersion,
  lastRunAt, lastSuccessAt, lastFailureAt, lastErrorCode,
  createdAt, updatedAt
}
```

`AutomationExecution`:

```js
{
  ruleId, ruleRevision, occurrenceKey,
  scheduledFor, eventId,
  status: 'claimed' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'needs_review',
  attempts, claimedBy, leaseExpiresAt,
  actionReceipts: [{ stepId, status, discordMessageId, targetId }],
  errorCode, startedAt, finishedAt
}
```

Indexes:
- `{ ruleId, occurrenceKey }` unique.
- `{ enabled, 'schedule.nextRunAt' }` hoặc trạng thái due tương đương.
- `{ guildId, createdBy, status }` cho panel.
- `{ leaseExpiresAt }` cho recovery.
- Dedupe welcome `{ ruleId, memberId }` riêng trong state/execution.

Không lưu raw API keys, Discord tokens, toàn bộ model prompt hoặc nguyên Discord objects. Có retention cho execution logs và redaction nội dung nhạy cảm. Update rule phải tăng revision; execution đang chạy dùng snapshot revision đã được duyệt.

## 9. Scheduler: giờ, window, restart và exactly-once

- Dùng **UTC** để lưu `nextRunAt`, IANA timezone để tính lịch địa phương; không tính giờ Việt Nam bằng cộng `7 * 3600` cứng.
- `daily_at 07:00`: chạy đúng một lượt theo ngày lịch địa phương.
- `daily_window 21:30–23:30`: chọn slot một lần và **persist** trước khi chạy; không random lại sau mỗi restart.
- Quét job due mỗi ~15–60 giây, lập tức claim bằng Mongo atomic `findOneAndUpdate` + lease TTL; không lập một `setTimeout` nhiều ngày làm nguồn sự thật duy nhất.
- Khi bot restart: recover job pending/in-progress đã quá lease theo chính sách; không bắn tất cả job đã lỡ vào một lúc.
- Missed-run policy: `skip`, `run_if_within_grace`, hoặc `run_once_on_recovery`; mặc định chúc ngủ ngon là `skip` khi đã qua 23:30, tin 07:00 dùng grace do owner cấu hình.
- Với message/DM send: crash sau khi Discord nhận tin nhưng trước khi DB ghi receipt tạo **exactly-once gap**. Không tuyên bố bảo đảm exactly-once; chọn at-most-once / đối chiếu delivery receipt khi khả thi, không retry mù gửi hai lời chúc/kick hai lần.
- App shutdown/restart: ngừng lấy job mới, cho job đang chạy có bounded drain; hết grace thì stop và recover lần sau.
- Rate limits: queue Discord/API trong budget; job lỗi network/503 retry phân loại, backoff+jitter; 400/403 không retry vô ích.

## 10. Cách chạy ba yêu cầu gốc

### 10.1. “Mỗi khi tôi nhắn, hãy reaction theo cảm xúc”

```
messageCreate → match author/guild/channel → classify mood (nếu cần)
→ pick emoji allowlist → react → record event receipt
```

Cho phép chế độ `fixed_emoji`, `heuristic`, `contextual_ai`. Contextual AI chỉ gửi excerpt tối thiểu, budget thấp, bỏ qua nếu quá thời gian; không kéo full `GeminiManager.chat()` cùng lịch sử và tools. Không reaction spam lặp, không react bot messages hoặc message ngoài scope. Tin nhạy cảm có thể chọn reaction trung tính hoặc bỏ qua, không suy đoán tâm trạng người thật từ một dòng text với độ chắc chắn giả.

### 10.2. “Đứa nào spam thì kick”

```
messageCreate / AutoMod event → deterministic threshold → exemption + hierarchy
→ collect evidence → preapproved escalation → warn / timeout / kick
→ audit receipt + per-member cooldown
```

Không có keyword “spam” phổ quát; planner hỏi/chọn ngưỡng rõ, UI preview mô tả hậu quả. Không kick vì Gemini kết luận “người này có vẻ spam”. Khi owner gỡ permission của bot hoặc member đã rời guild thì skip an toàn.

### 10.3. “21:30–23:30 chúc ngủ ngon”

```
window slot persisted → claim → revalidate channel/permission
→ choose template / optional AI → send once → receipt
```

Chọn channel; `allowedMentions` tắt `everyone` mặc định dù user nói “mọi người”, trừ khi owner thật sự phê duyệt ping. Offline hết window → skip + history reason.

## 11. Các yêu cầu mở rộng

### 11.1. Tin công nghệ mới nhất lúc 07:00

```
scheduler → research_web(news, lookback, time) → normalize sources
→ dedupe URLs/story IDs against previous digest → summarize with citations
→ send to configured destination → record report + delivery receipt
```

Tái dùng logic `web_search` đang có từ `utils/devFunctions.js` bằng cách tách service thuần. Không chạy `GeminiManager.chat(fakeMessage)` hoặc hardcode “tin mới” nếu search failure. Dùng budget từ `ApiKeyManager`, ưu tiên nguồn phát hành có ngày rõ, và nói “không tìm được tin mới” khi phù hợp. Giới hạn số tin và độ dài phù hợp Discord.

### 11.2. Member join → DM chào mừng

```
guildMemberAdd → guild match → member dedupe
→ render template → member.send() → status receipt
```

Bot cần GuildMembers intent được bật tại Developer Portal. DM có thể bị chặn; ghi nhận `DM_CLOSED`/permission error, không cố retry vô hạn, không giả báo đã gửi. Không auto-DM cho bot nếu rule không yêu cầu.

### 11.3. Workflow phức tạp có `delay`

```text
Join → wait 24h → re-fetch member → check conditions → role add → DM
```

Không dùng `setTimeout(24h)` đơn lẻ. Lưu checkpoint và due job trong MongoDB; trước action re-fetch state và check quyền. Không trao cho model khả năng quyết định cấp role tùy tiện khi trigger xảy ra.

## 12. Giao diện `/automation` và thao tác bằng lời

Mượn patterns từ `services/memoryPanelService.js`: button, modal, pagination, ephemeral reply, owner-bound customId. Nên tách panel riêng, không dồn vào `events/client/interactionCreate.js` hiện đã lớn.

Tab/chế độ:

- **Rules:** tên, trigger, scope, action, enabled, revision, next run.
- **Details:** điều kiện, ai tạo/approve, capability grants, cooldown, missed-run policy.
- **History:** started/finished, outcome, executionId, skip reason, error (đã redact), Discord message link khi có.
- **Draft & Review:** xem diff/spec/code hash và quyền script yêu cầu; approve/reject.
- **Controls:** create/edit/duplicate/pause/resume/delete, run-once dry-run, rollback version.

Lúc chỉnh sửa bằng ngôn ngữ: “sửa trigger ngủ ngon thành 22h” → resolve rule theo list thật hoặc hỏi lại khi trùng tên; preview trước khi thay. Không dùng entity ref tạm sau khi chat turn kết thúc.

## 13. Source layout dự kiến

```text
models/
  AutomationRule.js              [new]
  AutomationExecution.js         [new]
  AutomationState.js             [new, khi workflow cần]

schema/
  automationTools.js             [new]

services/
  automationService.js           [new: auth, CRUD, planner handoff]
  automationEventRouter.js       [new]
  automationScheduler.js         [new]
  automationRunner.js            [new]
  automationCapabilities.js      [new: host-side enforcement]
  automationPanelService.js      [new]
  automationResearchService.js   [new, refactor phần web research dùng lại]

core/automation/
  ruleValidator.js               [new]
  workflowInterpreter.js         [new]
  scriptRegistry.js              [phase 3]
  isolatedScriptRunner.js        [phase 3, chỉ sau isolation assessment]

commands/slash/
  automation.js                  [new]

events/client/
  messageCreate.js               [modify: route event trước gate #dolia]
  onReady.js                     [modify: start engine]
  interactionCreate.js           [modify: delegate automation panel]
  guildMemberAdd.js              [new]
  autoModerationActionExecution.js [new nếu phase 2 cần]

class/GeminiManager.js          [modify: register query/action]
scripts/check-resources.js      [review if i18n changes]
resources/vi/                   [update existing resource conventions]
test/test_automation_*.mjs      [new]
docs/                            [update automation documentation]
```

`index.js` chỉ đăng ký adapters đã triển khai. Không auto-discover script từ thư mục và `import()` hàng loạt tại startup.

## 14. Kế hoạch triển khai theo phase

### Phase 0 — Contract & safety audit

- Chốt schema rule/action/event, permission matrix, event idempotency, execution state machine, versioning.
- Soát API Discord.js lockfile thực tế và privileged intents; soát `agent_code` sandbox threat model.
- Test `getCandidateModels`/`ApiKeyManager` không bị automation vượt quota chat.

**Gate:** spec và regression cases chốt, chưa bật automation destructives.

### Phase 1 — MVP chỉ dùng configured rules

- MongoDB Rule + Execution, validator và executor.
- `messageCreate`, `guildMemberAdd`, daily_at/daily_window.
- Fixed reaction, template DM, daily text; scheduler UTC/timezone/missed-run.
- `automation_query/action`, `/automation` MVP, owner checks, logs.

**Gate:** restart không gửi trùng; không gọi Gemini cho event đơn giản; bot chỉ chat AI ở #dolia.

### Phase 2 — Workflows & research

- `workflowInterpreter`, checkpoints, `delay_until`, branch/filter.
- Web research news digest có nguồn, freshness/dedupe/budget.
- Contextual emoji classification optional; anti-spam observe/warn/timeout, kick chỉ qua approved policy.
- Run history, UI review/preview, scoped permissions.

**Gate:** bản tin thất bại không tự bịa, anti-spam không false kick trên test mô phỏng; chặn vô hạn fan-out.

### Phase 3 — Custom generated automation

- Agent chỉ **generate candidate**; validator/manifest/runtime review.
- Đánh giá một isolation strategy hoạt động trên Windows và Termux. Không có isolation đạt yêu cầu → không bật Level 3 trên nền tảng đó.
- Registry code hash/version + approval + worker IPC + capability host.
- Rollback, pause-on-error, resource budgets, audit.

**Gate:** malicious JS không truy cập token/fs/network/child_process/Discord client raw; timeout thực sự kill worker; capability vượt quyền bị từ chối.

### Phase 4 — Resilience

- Multi-instance leases nếu triển khai nhiều replicas; metrics, alert và resource cleanup.
- Export/import rule an toàn; migrate version, disabled by default khi schema không tương thích.

## 15. Test matrix bắt buộc

| Kịch bản | Kỳ vọng |
|---|---|
| Tin ở #general đến, rule reaction scope #dolia | Không react, không chat Gemini. |
| Tin đúng author/channel, rule enabled | React đúng một lần. |
| Tin bot/webhook | Không trigger mặc định, chống loop automation. |
| Câu “hãy nhớ tôi thích ngủ ngon” | Memory, không tự tạo automation. |
| “Mỗi tối 22h nhắc tôi ngủ” | Automation draft/approve; có timezone/destination. |
| “Đừng tạo trigger”, “nếu có trigger thì sao?” | Không tạo rule. |
| Non-owner yêu cầu kick người spam | Không thể tạo/bật kick policy trái quyền. |
| Owner bảo “ai spam kick” nhưng chưa chốt threshold | Draft, không tự active kick. |
| Message storm thỏa spam policy | Chỉ một escalation theo evidence/cooldown. |
| Owner/admin/bot/role cao | Exemption/hierarchy chặn moderation trái policy. |
| Member join, DM closed | Failed/skipped có lý do, không retry vô hạn. |
| Restart sau khi chúc ngủ ngon đã gửi | Không gửi lần hai. |
| Offline toàn bộ 21h30–23h30 | Bỏ qua lượt hôm đó. |
| Restart trong window trước khi gửi | Dùng slot persisted, không random lại. |
| 07h research 503/429 | Bounded retry/backoff; không trộn với fallback nội dung cũ. |
| 07h không tìm được nguồn mới | Không tự bịa bản tin; báo “chưa có tin mới” khi phù hợp. |
| Rule bị xóa channel/role/target | Disable hoặc skip rõ reason, không đoán target thay thế. |
| Duplicate gateway delivery / two workers claim | Unique occurrence, một executor claim. |
| Worker crash sau Discord send trước DB receipt | Không hứa exactly-once; theo policy kiểm tra/at-most-once. |
| Người quản lý bị tước quyền | Rule có privilege cao tạm ngừng, không duy trì đặc quyền vô hạn. |
| Generated code import `fs`, `process`, `child_process` | Rejected/contained; không import host process. |
| Generated code infinite loop | Worker bị kill, rule pause/circuit open. |
| Generated code sửa manifest sau approval | Hash mismatch, không chạy. |
| Prompt injection trong tin nhắn của member | Không thể tạo rule, tăng capability hoặc bypass moderation. |
| Manual “run once” action destructive | Cần fresh explicit approval/intent và idempotency. |

Quality gates đề xuất (lệnh tồn tại trong `package.json` hiện tại):

```bash
npm run check:resources
npm run test:resources
npm run test:memory
npm run test:gemini-reliability
node --test test/test_automation_*.mjs
node --check class/GeminiManager.js
node --check events/client/messageCreate.js
```

Thêm integration smoke thủ công trên server test thật với bot token test, role hierarchy, privileged intents, DM settings, restart Windows/Termux. Test mock không chứng minh Discord thật gửi đúng một lần.

## 16. Acceptance criteria

1. Tạo, xem, sửa, tắt/bật và xóa trigger bằng chat và `/automation`, không cần sửa source thủ công cho Level 1/2.
2. Schedule và event trigger vẫn chạy khi không ai nhắn ở #dolia; AI chat vẫn chỉ chạy nơi được phép.
3. Rule persisted MongoDB, có owner, scope, revision, approval, execution history và retry/missed-run policy.
4. Bản tin 07h có nguồn; welcome DM báo đúng success/failure; chúc ngủ ngon một lần mỗi ngày trong window khi online.
5. Không tạo/đổi/kích hoạt rule quyền cao chỉ bởi model output hoặc text từ nội dung bên ngoài.
6. Có đường mở rộng cho script sinh mới, **nhưng chỉ bật sau khi cách ly runtime đạt tiêu chí**; không đánh đổi token/server để lấy demo chạy nhanh.
7. Không làm mất Vision, Memory, Music, Discord direct tools, API reliability hoặc Termux startup hiện tại.

## 17. Việc KHÔNG làm trong lượt lập kế hoạch này

- Không tự commit/push hoặc mở PR.
- Không clone/ghi đè repository đang chạy của người dùng.
- Không gắn listener, schedule job hoặc tạo rule thật trong Discord.
- Không hứa rằng generated JS hiện tại đã được cô lập. Cần làm và test phần này riêng.

## 18. Trạng thái triển khai trong source hiện tại

- Đã có collection riêng cho rule, execution và workflow state; có revision, approval, execution receipt, TTL và occurrence key duy nhất.
- Đã nối `messageCreate`, `guildMemberAdd`, `autoModerationActionExecution`, scheduler `daily_at`/`daily_window`/`once`, missed-run policy và phục hồi execution đã claim nhưng chưa chạy.
- Đã có capability allowlist cho reaction, gửi kênh/DM, cảnh báo, timeout, kick và web research; quyền, guild scope, bot hierarchy và approval được kiểm tra lại khi thực thi.
- Đã có `automation_query`, `automation_action`, `/automation`, panel owner-bound, lịch sử, create/update/enable/disable/delete/run-once.
- Đã tách web research thành service dùng chung, yêu cầu nguồn trước khi phát bản tin và lưu URL để loại tin trùng ở lượt sau.
- Workflow V1 hỗ trợ filter/branch theo trường canonical allowlist, checkpoint `delay_until`, research và state typed; không có `eval` hoặc biểu thức JavaScript tùy ý.
- Generated automation chỉ có metadata/đường mở rộng. Engine từ chối enable/run và không gọi `runDynamicScript()` cho tới khi có isolation đáp ứng Phase 3.
