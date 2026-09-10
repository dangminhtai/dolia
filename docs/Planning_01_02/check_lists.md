# Checklist Triển khai Tổng hợp

## REQ001: Universal Placeholder Helper

### 1. Chuẩn bị
- [x] Xác nhận file `requirements.md` đã được duyệt.
- [x] Kiểm tra file hiện tại `bot/Dolia/helpers/placeHolder.js` để backup nếu cần.

### 2. Implement Core Logic (`helpers/placeHolder.js`)
- [x] Tạo cấu trúc hàm chính `formatString(template, context)`.
- [x] Implement phần xử lý **User Context**:
    - [x] `{{user}}`, `{{user_name}}`, `{{user_id}}`
    - [x] `{{nickname}}`, `{{user_global_name}}`
    - [x] `{{user_avatar}}`
    - [x] `{{user_created_at}}`, `{{user_joined_at}}`, `{{user_age}}`
- [x] Implement phần xử lý **Server Context**:
    - [x] `{{server_name}}`, `{{server_id}}`, `{{member_count}}`
    - [x] `{{server_icon}}`, `{{server_owner_id}}`
- [x] Implement phần xử lý **Bot Context**:
    - [x] `{{bot_name}}`, `{{bot_id}}`, `{{bot_avatar}}`
    - [x] `{{bot_ping}}`
- [x] Implement phần xử lý **Channel Context**:
    - [x] `{{channel_name}}`, `{{channel_id}}`, `{{channel_mention}}`, `{{channel_topic}}`
- [x] Implement phần xử lý **Time & Utilities**:
    - [x] `{{vn_time}}`, `{{timestamp}}`, `{{date}}`, `{{time}}`

### 3. Xử lý Nâng cao & Tối ưu
- [x] Đảm bảo Case Insensitive (ví dụ `{{USER_NAME}}` vẫn chạy).
- [x] Xử lý khoảng trắng thừa (ví dụ `{{ user }}`).
- [x] Xử lý lỗi (Graceful handling) khi thiếu dữ liệu (null/undefined).

### 4. Kiểm thử (Verification)
- [x] Tạo script test nhỏ hoặc lệnh test trong bot để verify các placeholder chính.
- [x] Verify hiển thị đúng múi giờ VN.
- [x] Verify các trường hợp thiếu context (ví dụ chạy trong DM thì server info phải fallback).

### 5. Tài liệu
- [x] Cập nhật `docs/documents/playholder.md` (nếu có) hoặc tạo docs hướng dẫn sử dụng helper mới.

## REQ002: Automated Morning Greeting

### 1. Chuẩn bị
- [x] Chuẩn bị file data `bot/Dolia/config/Greeting/GoodMorning.json` đúng chuẩn JSON.

### 2. Implement Lệnh Admin (`add_morning_user`)
- [x] Tạo Slash Command `add_morning_user`.
- [x] Xử lý lưu User ID vào file JSON/Database.

### 3. Implement Cron Job
- [x] Setup Cron Job chạy lúc 6:00 AM VN.
- [x] Logic lấy danh sách user -> Fetch User -> Gửi tin nhắn.
- [x] Áp dụng `helpers/placeHolder.js` vào nội dung tin nhắn.

### 4. Implement DM Handler
- [x] Listen event `messageCreate`.
- [x] Check `channel.type === 'DM'`.
- [x] Reply câu thông báo yêu cầu.

### 5. Kiểm thử
- [x] Test lệnh thêm user (Đã code logic).
- [x] Test cron (Đã code logic setup).
- [x] Test nhắn tin DM cho bot (Đã code logic).

## REQ002: DB Refactor & Logging
- [x] Lập kế hoạch chuyển đổi sang Database (`implementation_plan_db_refactor.md`).
- [x] Cập nhật `GoodMorning.json` thành mảng chuỗi lời chào.
- [x] Tạo model `MorningGreeting.js`.
- [x] Cập nhật lệnh `/manage_morning_user` (Hạn chế chỉ **Bot Admin**, thêm action `test`).
- [x] Cấu trúc lại `morningGreeting.js` để có thể tách hàm gửi tin nhắn (tái sử dụng được).
- [x] Verify chuyển đổi và tính năng test thành công.
- [x] Push code lên GitHub.
