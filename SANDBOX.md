# Plan vận hành Dolia Agent trong Sandbox

## 1. Mục tiêu

Dolia Agent được phép tạo, sửa và xoá file **chỉ trong thư mục `sandbox/`**.

Sandbox là khu vực làm việc tạm thời của Agent. Mọi thay đổi trong sandbox **không có hiệu lực trực tiếp trên hệ thống thật**.

Code thật chỉ được thay đổi sau khi chủ nhân duyệt thông qua một bước `apply`.

Kiến trúc tổng quát:

```text
Dolia Agent
    │
    ▼
 sandbox/
    ├── slash/
    ├── scripts/
    ├── i18n/
    ├── utils/
    ├── config/
    └── ...
          │
          │ review
          ▼
     Apply Engine
          │
          │ approved changes only
          ▼
      Production Code
          │
          ▼
       Loader / Deploy
```

---

# 2. Phạm vi làm việc của Agent

Agent chỉ được phép ghi dữ liệu vào:

```text
sandbox/
```

Toàn bộ thư mục con bên trong `sandbox/` đều thuộc quyền quản lý của Agent.

Ví dụ hợp lệ:

```text
sandbox/slash/ping.js
sandbox/slash/music.js
sandbox/scripts/reload.js
sandbox/scripts/check.js
sandbox/i18n/vi.json
sandbox/i18n/en.json
sandbox/utils/format.js
sandbox/config/music.json
sandbox/docs/README.md
```

Không giới hạn cứng số lượng thư mục con.

Sau này có thể mở rộng:

```text
sandbox/
├── slash/
├── scripts/
├── i18n/
├── utils/
├── config/
├── services/
├── events/
└── ...
```

Agent không cần sửa logic bảo vệ mỗi khi thêm một thư mục mới.

---

# 3. Các thư mục Agent không được ghi trực tiếp

Agent tuyệt đối không được ghi trực tiếp vào code thật:

```text
commands/
events/
utils/
models/
resources/
services/
config/
src/
```

và các thư mục hệ thống khác ngoài `sandbox/`.

Việc đọc các thư mục này có thể được cho phép ở mức cần thiết để Agent hiểu:

* cấu trúc project
* convention
* import/export
* naming
* dependency
* cách command hiện tại hoạt động
* vị trí file đích khi apply

Nhưng quyền:

```text
READ production
WRITE sandbox
```

phải được tách biệt.

---

# 4. Quy tắc bảo vệ Path

Mọi thao tác filesystem của Agent phải đi qua một `Sandbox File Manager`.

Không cho phép Agent gọi trực tiếp filesystem API để bypass kiểm tra.

Ví dụ:

```js
sandbox.write(...)
sandbox.read(...)
sandbox.delete(...)
sandbox.exists(...)
sandbox.list(...)
```

Mọi path phải được resolve và kiểm tra trước khi thao tác.

Điều kiện bắt buộc:

```text
resolvedPath.startsWith(SANDBOX_ROOT)
```

Các dạng sau phải bị chặn:

```text
../
../../
/absolute/path
C:\Windows\...
/etc/...
```

Không cho phép symlink escape sandbox.

Nếu phát hiện path nằm ngoài `sandbox/`:

```text
status = error
action = blocked
reason = PATH_OUTSIDE_SANDBOX
```

Agent phải dừng thao tác đó.

---

# 5. Agent có thể làm gì trong Sandbox

Agent được phép:

```text
CREATE
MODIFY
DELETE
READ
RENAME
MOVE
```

nhưng chỉ khi source và destination đều nằm trong:

```text
sandbox/
```

Ví dụ:

```text
sandbox/slash/a.js
      ↓ rename
sandbox/slash/b.js
```

được phép.

Nhưng:

```text
sandbox/slash/a.js
      ↓
commands/slash/a.js
```

không được phép thực hiện bởi Agent.

Đây là nhiệm vụ của `Apply Engine`.

---

# 6. Luồng làm việc chuẩn

## Phase 1 — Understand

Agent nhận yêu cầu.

Agent xác định:

```text
feature
files cần tạo
files cần sửa
files cần xoá
dependencies liên quan
```

Nếu yêu cầu đủ rõ → tiếp tục.

Nếu không rõ → hỏi chủ nhân trước khi thay đổi.

---

# Phase 2 — Sandbox Generation

Agent chỉ thao tác trong:

```text
sandbox/
```

Ví dụ:

```text
sandbox/slash/play.js
sandbox/i18n/vi.json
sandbox/utils/music.js
```

Không có file production nào bị thay đổi.

---

# Phase 3 — Validation

Agent kiểm tra:

```text
JavaScript syntax
ESM import/export
Discord.js v14 structure
JSON validity
i18n key
naming
path safety
dependency
```

Có thể chạy:

```text
node --check
```

hoặc validator tương ứng.

Nếu validation thất bại:

```text
status = error
```

Agent không được tự ý ghi production để sửa lỗi.

---

# Phase 4 — Change Manifest

Sau khi tạo code, Agent phải tạo một manifest mô tả chính xác thay đổi.

Ví dụ:

```text
sandbox/.manifest.json
```

```json
{
  "status": "ready",
  "changes": [
    {
      "action": "create",
      "source": "sandbox/slash/play.js",
      "target": "commands/slash/play.js"
    },
    {
      "action": "modify",
      "source": "sandbox/i18n/vi.json",
      "target": "resources/vi/music.json"
    }
  ]
}
```

Manifest là cầu nối giữa:

```text
Sandbox
```

và:

```text
Production
```

Agent không được tự quyết định copy file sang production.

---

# 7. Apply Engine

Đây là phần quan trọng nhất.

Dolia phải có một module riêng, ví dụ:

```text
core/
└── sandbox/
    ├── sandbox-manager.js
    ├── sandbox-validator.js
    ├── change-manifest.js
    └── apply-engine.js
```

Agent chỉ có:

```text
SandboxManager
```

Còn:

```text
ApplyEngine
```

phải thuộc hệ thống host và không nằm trong quyền ghi của Agent.

---

# 8. Logic liên kết Sandbox → Production

Không copy toàn bộ sandbox.

Không:

```text
cp -r sandbox/* project/
```

Thay vào đó:

```text
Sandbox File
      │
      ▼
Manifest
      │
      ▼
Review
      │
      ▼
Approved
      │
      ▼
Apply Engine
      │
      ▼
Explicit Mapping
      │
      ▼
Production File
```

Mỗi file phải có mapping cụ thể.

Ví dụ:

```text
sandbox/slash/play.js
        ↓
commands/slash/play.js
```

```text
sandbox/i18n/vi/music.json
        ↓
resources/vi/music.json
```

```text
sandbox/scripts/reload.js
        ↓
scripts/reload.js
```

Nếu không có mapping:

```text
SKIP
```

Không tự đoán destination.

---

# 9. Mapping Registry

Nên có một registry trung tâm:

```text
sandbox/mappings.json
```

Ví dụ:

```json
{
  "slash": {
    "source": "sandbox/slash/",
    "target": "commands/slash/"
  },
  "i18n": {
    "source": "sandbox/i18n/",
    "target": "resources/vi/"
  },
  "scripts": {
    "source": "sandbox/scripts/",
    "target": "scripts/"
  }
}
```

Apply Engine chỉ được phép sử dụng mapping đã khai báo.

Ví dụ:

```text
sandbox/random/test.js
```

không có mapping:

```text
→ BLOCKED
```

---

# 10. Không cho phép wildcard nguy hiểm

Không được dùng logic kiểu:

```js
copy("sandbox/**/*", "project/")
```

Thay vào đó:

```js
apply({
    source: "sandbox/slash/play.js",
    target: "commands/slash/play.js"
})
```

hoặc manifest tương đương.

Mỗi thay đổi phải xác định:

```text
source
target
action
```

---

# 11. Approval Gate

Apply Engine chỉ hoạt động khi trạng thái là:

```text
PENDING_APPROVAL
```

Sau khi chủ nhân duyệt:

```text
APPROVED
```

Apply Engine mới được phép chạy.

Ví dụ:

```text
SANDBOX_READY
      ↓
VALIDATED
      ↓
PENDING_APPROVAL
      ↓
APPROVED
      ↓
APPLYING
      ↓
APPLIED
```

Nếu chủ nhân từ chối:

```text
REJECTED
```

Sandbox vẫn giữ nguyên để kiểm tra hoặc chỉnh sửa.

---

# 12. Atomic Apply

Không copy từng file một cách không kiểm soát.

Trước khi apply:

```text
Production Backup / Snapshot
```

Sau đó:

```text
validate tất cả
        ↓
prepare tất cả
        ↓
apply
        ↓
verify
```

Nếu một file thất bại:

```text
ROLLBACK
```

để tránh trạng thái production bị cập nhật một nửa.

---

# 13. Rollback

Mỗi lần apply nên có transaction ID:

```text
apply-20260910-001
```

Ví dụ:

```text
.apply/
└── apply-20260910-001/
    ├── manifest.json
    ├── backup/
    └── result.json
```

Rollback:

```text
Production
    ↓
Backup
    ↓
Restore
```

Sandbox không phải nguồn rollback duy nhất.

Snapshot trước mỗi lần apply sẽ an toàn hơn.

---

# 14. Deploy và Hot Reload

Agent tuyệt đối không được:

```text
deploy
restart
hot reload
git commit
git push
```

Apply Engine cũng không tự động deploy mặc định.

Sau khi apply thành công:

```text
APPLIED
```

mới chuyển sang bước:

```text
READY_FOR_RELOAD
```

Chủ nhân hoặc hệ thống có quyền cao hơn mới quyết định:

```text
reload
restart
deploy
```

---

# 15. Ví dụ thực tế

Agent muốn tạo:

```text
/play
```

Agent tạo:

```text
sandbox/slash/play.js
sandbox/i18n/vi/play.json
```

Validation:

```text
✓ JavaScript valid
✓ JSON valid
✓ Discord.js v14 valid
✓ imports valid
```

Manifest:

```json
{
  "changes": [
    {
      "action": "create",
      "source": "sandbox/slash/play.js",
      "target": "commands/slash/play.js"
    },
    {
      "action": "create",
      "source": "sandbox/i18n/vi/play.json",
      "target": "resources/vi/play.json"
    }
  ]
}
```

Trạng thái:

```text
PENDING_APPROVAL
```

Chủ nhân duyệt.

Apply Engine:

```text
sandbox/slash/play.js
        ↓
commands/slash/play.js
```

```text
sandbox/i18n/vi/play.json
        ↓
resources/vi/play.json
```

Sau đó verify production.

Nếu thành công:

```text
APPLIED
```

Agent vẫn không được tự deploy.

---

# 16. Delete an toàn

Xoá file cũng phải qua manifest.

Ví dụ:

```json
{
  "action": "delete",
  "target": "commands/slash/play.js"
}
```

Nhưng trước khi xoá production:

```text
backup
→ approval
→ delete
→ verify
```

Không cho phép:

```text
Agent → delete production
```

---

# 17. Output chuẩn

Mỗi phiên Agent trả về:

```json
{
  "status": "success",
  "summary": "Tạo command /play trong sandbox",
  "files_created": [
    "sandbox/slash/play.js"
  ],
  "files_modified": [],
  "files_deleted": [],
  "validation": {
    "syntax": "passed",
    "imports": "passed",
    "discordjs": "passed",
    "path_safety": "passed"
  },
  "next_action": "pending_approval"
}
```

Trạng thái hợp lệ:

```text
success
warning
error
blocked
pending_approval
applied
rejected
```

---

# 18. Quy tắc cứng cho Agent

```text
1. Chỉ được WRITE bên trong sandbox/.
2. Không được WRITE production trực tiếp.
3. Không được DELETE production trực tiếp.
4. Không được deploy.
5. Không được hot-reload.
6. Không được commit.
7. Không được push.
8. Không được sử dụng ../ để escape.
9. Không được sử dụng symlink để escape.
10. Không được copy toàn bộ sandbox sang production.
11. Mọi production change phải có manifest.
12. Mọi production change phải qua approval.
13. Mọi target phải nằm trong mapping hợp lệ.
14. Target không hợp lệ → BLOCKED.
15. Validation fail → không được apply.
```

---

# 19. Kiến trúc đề xuất cho Dolia

```text
Dolia
│
├── Agent
│
├── sandbox/
│   ├── slash/
│   ├── scripts/
│   ├── i18n/
│   ├── utils/
│   └── ...
│
├── core/
│   └── sandbox/
│       ├── sandbox-manager.js
│       ├── sandbox-validator.js
│       ├── manifest-manager.js
│       ├── mapping-registry.js
│       ├── apply-engine.js
│       ├── transaction-manager.js
│       └── rollback-manager.js
│
├── commands/
├── events/
├── utils/
├── models/
├── resources/
└── ...
```

Luồng chính:

```text
             ┌────────────────┐
             │   Dolia Agent  │
             └───────┬────────┘
                     │
                     ▼
              ┌─────────────┐
              │   sandbox/  │
              └──────┬──────┘
                     │
                     ▼
              ┌─────────────┐
              │  Validator  │
              └──────┬──────┘
                     │
                     ▼
              ┌─────────────┐
              │   Manifest  │
              └──────┬──────┘
                     │
                     ▼
             PENDING_APPROVAL
                     │
                Owner Approve
                     │
                     ▼
              ┌─────────────┐
              │ ApplyEngine │
              └──────┬──────┘
                     │
              Explicit Mapping
                     │
                     ▼
             ┌──────────────┐
             │ Production   │
             └──────┬───────┘
                    │
                    ▼
                 Verify
                    │
                    ▼
            READY_FOR_RELOAD
```

# 20. Tiêu chí đạt

Hệ thống được coi là đạt khi:

```text
✓ Agent chỉ ghi được sandbox/
✓ sandbox có thể mở rộng vô hạn thư mục con
✓ Production chỉ đọc đối với Agent
✓ Mọi thay đổi production đều có manifest
✓ Mọi target đều có mapping rõ ràng
✓ Không copy wildcard toàn bộ sandbox
✓ Chủ nhân phải approval trước apply
✓ Có transaction trước khi sửa production
✓ Có rollback
✓ Agent không deploy
✓ Agent không hot-reload
✓ Agent không commit/push
✓ Path traversal bị chặn
✓ Symlink escape bị chặn
✓ Có thể xoá toàn bộ sandbox mà không ảnh hưởng production
```

# 21. Nguyên tắc cốt lõi

Sandbox không phải là một phiên bản khác của production.

Sandbox là:

```text
Workspace của Agent
```

Production là:

```text
Hệ thống thật
```

`Apply Engine` là:

```text
cổng kiểm soát duy nhất
```

giữa hai bên.

Do đó Agent không bao giờ được có quyền:

```text
Sandbox → Production
```

mà chỉ được:

```text
Sandbox
   ↓
Manifest
   ↓
Approval
   ↓
Apply Engine
   ↓
Production
```

Đây là lớp bảo vệ quan trọng nhất của toàn bộ kiến trúc.
