# DOLIA — Gemini API Reliability & Project-Aware Key Management Plan

> **Trạng thái triển khai:** Đã triển khai đầy đủ lớp reliability trong source ngày 23/09/2026. Việc xác minh 12 key thuộc 12 Google Cloud project và điền `GEMINI_n_PROJECT` vẫn phải được chủ bot thực hiện bằng AI Studio hoặc `gcloud`; Dolia không tự suy đoán project từ raw key.

## Kết quả triển khai

- `geminiErrorClassifier`: phân loại lỗi và scope thống nhất, đọc `RetryInfo`.
- `apiRequestScheduler`: giới hạn concurrency, health score, backoff+jitter, circuit breaker và metrics RAM.
- `ApiKeyManager`: routing theo project/model, budget tối đa 3 attempt, tối đa một lần đổi model, timeout thật bằng `AbortSignal` và `httpOptions.timeout`.
- `APIKeys`/`APIStatus`: bổ sung project metadata, health snapshot và trạng thái circuit; không ghi raw key vào log/status mới.
- Fast path được mở rộng cho direct tool có deterministic `reply`.
- Migration metadata: `npm run migrate:gemini-keys` sau khi điền project alias trong `.env`.
- Regression suite: `npm run test:gemini-reliability`.

Nếu key chưa có project metadata, tất cả được xếp vào nhóm `unverified`; hệ thống cố ý không giả định mỗi key là một quota project riêng.

## Mục tiêu

Thiết kế lại lớp gọi Gemini API của Dolia để:

1. Tăng xác suất request thành công ngay từ lần đầu.
2. Không xoay API key mù khi gặp `429`, `503`, `5xx`, timeout.
3. Phân biệt rõ lỗi thuộc:
   - API key
   - Google Cloud project
   - model
   - request/prompt
   - mạng/timeout
   - code của Dolia
4. Theo dõi health của từng `project × model`, thay vì chỉ `key × model`.
5. Tận dụng 12 API key thuộc 12 Google Cloud project khác nhau một cách có căn cứ.
6. Giảm số request Gemini không cần thiết để giảm xác suất dính quota / overload.
7. Giữ kiến trúc nhẹ, phù hợp bot Discord chỉ 2–5 người dùng.
8. Không thay đổi source trên `main` trước khi plan này được duyệt.

---

# 1. Xác minh 12 key có thật sự thuộc 12 project khác nhau

## 1.1. Cách kiểm tra không cần viết code

### Cách A — Google AI Studio

Google xác nhận mỗi Gemini API key gắn với một Google Cloud project.

Kiểm tra trong:

`Google AI Studio -> Dashboard -> Projects / API Keys`

Mục tiêu là đối chiếu key với project mà nó được tạo trong.

Không cần đưa API key vào source Dolia để làm việc này.

### Cách B — `gcloud` chính thức của Google

Đây là cách xác minh chắc nhất từ chính `key string` mà không cần viết chương trình:

```bash
gcloud services api-keys lookup "YOUR_API_KEY"
```

Google trả về project chứa key đó.

Ví dụ ý nghĩa kết quả:

```text
projectId: dolia-project-01
projectNumber: 123456789012
```

Chạy lần lượt cho 12 key và lập bảng:

| Key alias | Project ID | Project number | Trùng project? |
|---|---|---:|---|
| GEMINI_1_KEY | project-a | ... | No |
| GEMINI_2_KEY | project-b | ... | No |
| ... | ... | ... | ... |

Không ghi raw key vào bảng.

### Cách C — API Keys REST / Cloud Shell

Google có endpoint `LookupKey`:

```text
GET https://apikeys.googleapis.com/v2/keys:lookupKey?keyString=KEY
```

Nó trả:

```json
{
  "parent": "projects/PROJECT_NUMBER/locations/global",
  "name": "projects/PROJECT_NUMBER/locations/global/keys/KEY_ID"
}
```

Cách này phù hợp khi muốn audit hàng loạt bằng Cloud Shell sau này, nhưng chưa cần đưa vào runtime Dolia.

---

# 2. Hiện trạng Dolia cần sửa

Các file hiện tại liên quan trực tiếp:

```text
class/apiKeyManager.js
class/GeminiManager.js
services/geminiModelService.js
models/APIKeys.js
models/APIStatus.js
resources/vi/logs.json
```

Hiện `ApiKeyManager`:

- load key từ `.env` và MongoDB;
- Round-Robin key;
- cooldown theo `key × model`;
- retry tối đa theo số key;
- gặp 429 thì suspend key rồi đổi key gần như ngay;
- gặp 503 thì block khá mạnh;
- timeout dùng `Promise.race()`;
- 403 có thể bị coi là key leaked;
- chưa biết key thuộc project nào;
- chưa có health score;
- chưa có request scheduler;
- chưa có global retry budget.

Điểm yếu lớn nhất:

```text
request fail
   ↓
đoán loại lỗi
   ↓
suspend key
   ↓
đổi key/model
```

Mục tiêu mới:

```text
request
   ↓
classify
   ↓
xác định phạm vi lỗi
   ↓
key / project / model / request / network
   ↓
chọn hành động có căn cứ
```

---

# 3. Kiến trúc mới

```text
Discord request
      │
      ▼
GeminiManager
      │
      ▼
ApiRequestScheduler
      │
      ├── request budget
      ├── in-flight limit
      ├── project health
      ├── model health
      └── retry policy
      │
      ▼
ApiKeyManager
      │
      ├── Project A -> Key A
      ├── Project B -> Key B
      ├── Project C -> Key C
      └── ...
      │
      ▼
Google Gemini API
      │
      ├── success
      ├── 429
      ├── 5xx
      ├── timeout
      └── permanent error
```

---

# 4. Project-aware key metadata

## 4.1. Không tự gọi Google LookupKey trong mỗi request

Việc lookup project của API key là metadata tĩnh.

Không cần mỗi request Gemini lại hỏi Google:

```text
key này thuộc project nào?
```

Thay vào đó xác minh một lần bằng Google AI Studio / `gcloud`, rồi lưu alias metadata.

Ví dụ `.env`:

```env
GEMINI_1_KEY=...
GEMINI_1_PROJECT=dolia-p01

GEMINI_2_KEY=...
GEMINI_2_PROJECT=dolia-p02
```

Hoặc MongoDB:

```js
{
  name: "GEMINI_1",
  key: "...",
  projectId: "dolia-p01",
  projectNumber: "123...",
  isActive: true
}
```

Raw key vẫn không bao giờ được log.

## 4.2. Sửa `models/APIKeys.js`

Bổ sung:

```js
projectId
projectNumber
keyType
priority
lastSuccessAt
lastFailureAt
successCount
errorCount
```

`keyType` có thể dùng để phân biệt loại key trong quá trình migration của Google.

---

# 5. Error classifier duy nhất

Không để mỗi service tự parse `e.message` theo một kiểu.

Tạo:

```text
services/geminiErrorClassifier.js
```

Output chuẩn:

```js
{
  category: "RATE_LIMIT",
  scope: "PROJECT_MODEL",
  retryable: true,
  statusCode: 429,
  retryAfterMs: 4200,
  reason: "RESOURCE_EXHAUSTED",
  rawCode: "...",
}
```

## Các category

```text
RATE_LIMIT
SERVICE_OVERLOADED
INTERNAL_SERVER_ERROR
TIMEOUT
NETWORK_ERROR

INVALID_REQUEST
AUTH_INVALID
PERMISSION_DENIED
MODEL_NOT_FOUND

APPLICATION_ERROR
UNKNOWN
```

---

# 6. Xác định phạm vi lỗi

Đây là phần quan trọng nhất.

## 6.1. Key-scoped

Ví dụ:

```text
invalid/revoked credential
key disabled
key restriction mismatch
```

Hành động:

```text
disable/chill riêng key đó
```

## 6.2. Project-scoped

Ví dụ:

```text
quota project
RPM / TPM / daily quota
```

Hành động:

```text
cooldown project + model
```

Sau đó có căn cứ để dùng key thuộc project khác.

## 6.3. Model-scoped

Ví dụ:

```text
503 high demand / overloaded
```

Không kết luận từ một sample duy nhất.

Dùng circuit breaker:

```text
1 lỗi 503:
retry backoff

nhiều lỗi 503 liên tiếp:
temporary model degradation

503 từ nhiều project:
model-level circuit open
```

## 6.4. Request-scoped

Ví dụ:

```text
400 INVALID_ARGUMENT
payload quá lớn
tool schema lỗi
```

Không đổi key.

Không đổi project.

Không phạt model.

Dừng và sửa request.

## 6.5. Network / host-scoped

Ví dụ:

```text
DNS
ECONNRESET
ETIMEDOUT
socket
```

Không phạt key.

Không kết luận quota.

---

# 7. Retry policy mới

## Nguyên tắc

Không dùng:

```text
retry = số API key
```

Retry là budget của **một user request**, độc lập với số key.

Ví dụ chat thường:

```text
MAX_TOTAL_API_ATTEMPTS = 3
MAX_MODEL_SWITCHES = 1
MAX_PROJECT_SWITCHES = 2
```

## Flow đề xuất

```text
Attempt 1
→ project/model tốt nhất

429 project quota
→ đọc RetryInfo nếu có
→ cooldown project/model
→ project khác

503
→ backoff + jitter
→ retry 1 lần
→ nếu tiếp tục lỗi, model fallback

timeout/network
→ retry hạn chế
→ không phạt key ngay

400
→ stop
```

---

# 8. Backoff + jitter

Không đổi key sau cố định `100 ms`.

Đề xuất:

```js
delay = min(base * 2^attempt, cap) * random(0.5, 1.5)
```

Ví dụ:

```text
~0.5–1.5 s
~1–3 s
~2–6 s
```

Nếu Google cung cấp `RetryInfo` / retry delay thì ưu tiên dữ liệu đó.

---

# 9. Timeout đúng nghĩa

Hiện:

```js
Promise.race([
  task(key),
  timeoutPromise
])
```

chỉ làm Dolia ngừng chờ.

Nó không đảm bảo request HTTP gốc đã bị hủy.

Cần kiểm tra `@google/genai` version hiện tại và chuyển sang timeout/cancellation được SDK hỗ trợ.

Mục tiêu:

```text
timeout
→ abort request thật
→ giải phóng in-flight
→ mới xem xét retry
```

Không để zombie request tiếp tục ăn quota.

---

# 10. Request scheduler nhẹ

Tạo:

```text
services/apiRequestScheduler.js
```

Không Redis.

Không queue server ngoài.

Chỉ in-memory + MongoDB persistence tối thiểu.

Theo dõi:

```js
projectModelState = {
  inFlight,
  consecutive429,
  consecutive5xx,
  consecutiveTimeout,
  ewmaLatencyMs,
  cooldownUntil,
  circuitState,
  lastSuccessAt
}
```

---

# 11. Health score

Không Round-Robin cứng.

Chọn project/model dựa trên health.

Ví dụ:

```text
healthy + latency tốt        -> ưu tiên
vừa có success               -> tăng điểm
429 gần đây                  -> giảm điểm
timeout                      -> giảm nhẹ
503 lặp lại                  -> giảm mạnh
circuit open                 -> loại tạm thời
```

Không biến health score thành AI dự đoán huyền học.

Nó phải chỉ dựa trên metric đo được.

---

# 12. Circuit breaker

State:

```text
CLOSED
OPEN
HALF_OPEN
```

Ví dụ model 503:

```text
CLOSED
  ↓ nhiều 503 liên tiếp
OPEN 30–60s
  ↓
HALF_OPEN
  ↓ 1 probe request
SUCCESS → CLOSED
FAIL → OPEN
```

Không block 5 phút chỉ vì đúng một request 503.

---

# 13. Concurrency control

Dolia chỉ 2–5 user nên đơn giản.

Ví dụ:

```text
global Gemini in-flight: 2–3
per project-model: 1
```

Khi hai người cùng spam:

```text
request 1 đang chạy
request 2 đợi vài trăm ms
```

có thể tốt hơn gửi đồng thời rồi cả hai ăn 429.

---

# 14. GeminiManager không được tự block model vì mọi exception

Hiện `GeminiManager` có thể gọi `reportModelFailure()` ở catch ngoài.

Phải thay bằng structured error:

```js
if (error.scope === "MODEL" && error.retryable) {
   reportModelFailure(...)
}
```

Không block model vì:

```text
MongoDB error
Discord tool error
JSON parsing
memory error
application bug
```

---

# 15. Fast path giảm API calls

Audit toàn bộ tools.

Nếu executor trả kết quả deterministic:

```js
{
  ok: true,
  reply: "..."
}
```

thì có thể trả thẳng.

Ứng viên:

```text
discord_query
discord_action
memory_action
simple music controls
```

Không cần Gemini request thứ hai chỉ để diễn đạt:

```text
"đã xóa tin nhắn"
```

---

# 16. Metrics cần thu thập

Không tối ưu bằng cảm giác.

Tối thiểu:

```text
requests_total
requests_success_first_try
requests_success_after_retry
requests_failed

429_count
503_count
timeout_count

attempts_per_user_request
model_switches
project_switches

latency_p50
latency_p95

success_rate_by_project_model
```

Không log raw API key.

Log alias:

```text
project=p03
key=GEMINI_3
model=gemini-x-flash
```

---

# 17. APIStatus redesign

Hiện `APIStatus` chủ yếu:

```text
key
model
suspendedUntil
reason
```

Đề xuất:

```js
{
  projectId,
  keyAlias,
  modelId,

  scope,
  state,

  cooldownUntil,

  lastStatusCode,
  lastErrorCategory,

  consecutiveFailures,
  consecutiveSuccesses,

  lastFailureAt,
  lastSuccessAt,

  ewmaLatencyMs
}
```

Không nhất thiết persist mọi counter theo từng request.

Metric nóng giữ RAM; snapshot định kỳ nếu cần.

---

# 18. Không tự động disable key khi thấy 403 chung chung

`403` cần được classify.

Có thể là:

```text
permission denied
service account permission
API restriction
billing/project config
```

Chỉ disable key nếu bằng chứng cho thấy credential thực sự invalid/revoked.

Đổi tên hàm:

```text
markLeaked()
```

thành các trạng thái rõ:

```text
disableKey(reason)
markCredentialInvalid()
```

`LEAKED` chỉ dùng khi Google thực sự báo leaked key.

---

# 19. Test plan

## 19.1. 429

### Project A bị quota

```text
A → 429
B → success
```

Expected:

```text
A cooldown
B được chọn
không thử key thứ hai cùng project A
```

### RetryInfo

Google trả delay:

```text
4.2s
```

Expected:

```text
cooldown >= 4.2s
không dùng fixed 60s nếu không cần
```

---

## 19.2. 503

```text
A / model X → 503
```

Expected:

```text
backoff
không disable key
không block model 5 phút ngay lập tức
```

Nhiều project cùng 503 model X:

```text
model circuit breaker opens
```

---

## 19.3. Timeout

Expected:

```text
abort request
không coi là quota
không disable key
retry budget giới hạn
```

---

## 19.4. 400

Expected:

```text
0 key rotation
0 project switch
0 model punishment
```

---

## 19.5. 403

Expected:

```text
không mặc định mark LEAKED
classify trước
```

---

## 19.6. Application error

Ví dụ:

```text
Discord function throws
Mongo throws
JSON parser throws
```

Expected:

```text
không retry Gemini
không cooldown project/model
```

---

## 19.7. Retry storm

12 project đều lỗi.

Expected:

```text
không gửi 12 request liên tiếp
global retry budget được tôn trọng
```

---

# 20. Các file dự kiến thay đổi

```text
class/apiKeyManager.js
class/GeminiManager.js

services/geminiModelService.js
services/geminiErrorClassifier.js      [NEW]
services/apiRequestScheduler.js        [NEW]

models/APIKeys.js
models/APIStatus.js

resources/vi/logs.json

test/test_api_key_manager.mjs          [NEW]
test/test_api_scheduler.mjs            [NEW]
test/test_gemini_error_classifier.mjs  [NEW]
```

Không sửa Discord tools / memory / agent nếu không cần.

---

# 21. Migration strategy

## Phase 1 — Observability

Chưa đổi routing mạnh.

Thêm:

```text
error classifier
metrics
project metadata
structured logs
```

Chạy vài ngày để lấy baseline.

---

## Phase 2 — Retry correctness

Thay:

```text
100ms key rotation
fixed cooldown
generic 403 leaked
generic model failure
```

bằng:

```text
structured retry policy
RetryInfo
backoff+jitter
scope-aware failure
```

---

## Phase 3 — Scheduler

Thêm:

```text
concurrency
health score
project selection
circuit breaker
```

---

## Phase 4 — Optimization

Audit:

```text
function-call round trips
history size
vision payload
memory injection
agent requests
```

Giảm request/token không cần thiết.

---

# 22. Tiêu chí thành công

Không đánh giá bằng "ít thấy lỗi hơn".

Đặt số liệu:

```text
first-attempt success rate ↑
overall request success rate ↑

average attempts/request ↓
429 retries/request ↓
useless project switches ↓

p50 latency ổn định
p95 latency giảm

0 false key disable
0 false model block
```

---

# 23. GitHub workflow đề xuất

Repository:

```text
dangminhtai/dolia
```

Không sửa trực tiếp `main`.

Sau khi plan được duyệt:

```text
main
  ↓
branch:
feat/gemini-reliability-layer
```

Thứ tự commit:

```text
1. test: add Gemini error classification fixtures
2. feat: add project metadata to API keys
3. feat: centralize Gemini error classifier
4. refactor: replace blind key rotation
5. feat: add request scheduler and circuit breaker
6. fix: scope model cooldown correctly
7. test: add 429/503/timeout regression suite
8. docs: document reliability behavior
```

Sau đó:

```text
Pull Request
→ review diff
→ test
→ merge sau khi user duyệt
```

---

# 24. Nguyên tắc cuối

```text
API key != quota bucket nếu chưa xác minh project
```

Trong trường hợp Dolia đã xác minh:

```text
12 keys = 12 projects
```

thì project rotation là hợp lý.

Nhưng vẫn phải tuân theo:

> Không đổi project chỉ vì request thất bại. Phải biết lỗi thuộc phạm vi nào và việc đổi project có khả năng giải quyết nó hay không.

Đây là khác biệt giữa:

```text
retry system
```

và:

```text
spam API cho tới khi một request may mắn sống sót.
```
