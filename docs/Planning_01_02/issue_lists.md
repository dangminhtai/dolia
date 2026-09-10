# Issue Tracking List

## [BUG001] {{vn_time}} hiển thị sai định dạng mong muốn
- **Mô tả lỗi**: Placeholder `{{vn_time}}` hiện đang hiển thị đầy đủ ngày/tháng/năm và giờ (ví dụ: `01:15:05 01/02/2026`). Người dùng chỉ muốn hiển thị giờ và phút (ví dụ: `01:15`).
- **Actions hiện tại**: Đang sử dụng `.toLocaleString("vi-VN", ...)` với đầy đủ các trường `hour`, `minute`, `second`, `day`, `month`, `year`.
- **Giải pháp đề xuất**: Chỉnh sửa logic `{{vn_time}}` trong `helpers/placeHolder.js` để sử dụng `formatTimeShort(now)` (trả về định dạng HH:mm) thay vì `formatDate(now)`.
- **Trạng thái**: ✅ Đã xử lý (Sử dụng `formatTimeShort` để lấy giờ:phút).

## [BUG002] Rò rỉ tài liệu, file test và scripts lên Git
- **Mô tả lỗi**: Các file trong thư mục `docs/`, `test/` và `scripts/` đã bị push lên repository công khai/chung, gây rủi ro bảo mật thông tin nội bộ.
- **Actions hiện tại**: Đã push toàn bộ code bao gồm cả các file nhạy cảm.
- **Giải pháp đề xuất**:
    1. Cập nhật `.gitignore` để chặn `bot/Dolia/docs/`, `bot/Dolia/test/` và `scripts/`.
    2. Chạy `git rm -r --cached` để xóa chúng khỏi tracking của Git (vẫn giữ lại file ở máy local).
    3. Commit và push bản cập nhật để xóa các file này trên GitHub.
- **Trạng thái**: ✅ Đã xử lý (Đã xóa khỏi Git bám sát quy trình bảo mật).

## [BUG003] Lỗi phân quyền lệnh /manage_morning_user
- **Mô tả lỗi**: Người dùng (Bot Creator) không thể sử dụng lệnh, bot báo thiếu quyền mặc dù là Admin.
- **Actions hiện tại**: Logic đang kiểm tra `interaction.user.id !== process.env.BOT_ADMIN_ID`.
- **Giải pháp đề xuất**: Hardcode `BOT_ADMIN_ID = '1149477475001323540'` trực tiếp vào lệnh (theo yêu cầu của người dùng) để đảm bảo quyền hạn được áp dụng ngay lập tức mà không phụ thuộc vào `.env`.
- **Trạng thái**: ✅ Đã xử lý (Hardcoded Admin ID thành công).
