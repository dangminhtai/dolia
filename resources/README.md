# Chỉnh câu chữ của Dolia


## Chuẩn câu chữ của bản này

- `logs.json`: log dành cho terminal, viết ngắn gọn, trung tính, có tên component và dữ liệu chẩn đoán cần thiết. Không dùng emoji, không dùng lời thoại nhân vật, không viết kiểu “nè/á/UwU”.
- Các file còn lại: là nội dung người dùng có thể nhìn thấy trên Discord. Giữ giọng Dolia thân thiện, xưng **mình – bạn**, hơi tinh nghịch nhưng không trẻ con quá mức.
- Emoji là phụ trợ, không phải dấu câu. Một thông báo ngắn thường dùng **0–1 emoji**; chỉ tiêu đề/trạng thái cần nhận diện nhanh mới nên có icon.
- Không dùng chuỗi icon liên tiếp như `✨💖🫧🐬`, không rải emoji ở mọi dòng.
- Khi báo lỗi cho người dùng, nói rõ tình trạng và cách thử lại; không dùng cách nói mơ hồ kiểu “đầu mình quay quay” hoặc “node nhạc đang mệt”.
- Giữ nguyên mọi placeholder `{{...}}` khi sửa text.


Anh chỉ cần sửa giá trị bên phải trong JSON, giữ nguyên tên khóa và các biến `{{...}}`. File dùng UTF-8. Có thể tìm nguyên câu đang thấy bằng Ctrl+Shift+F trong thư mục `resources`.

## Chọn đúng file

| File trong `vi/` | Nội dung |
| --- | --- |
| `commands.json` | Mô tả lệnh, lựa chọn, thông báo riêng của lệnh |
| `messages.json` | Thông báo tiến trình, phản hồi dự phòng, mẫu danh sách, biểu tượng; chia nhóm theo chức năng/file |
| `logs.json` | Mẫu log theo thành phần; nhóm `logger` chứa nhãn mức độ và bố cục dòng |
| `common.json`, `errors.json`, `self_dev.json` | Thông báo chung, lỗi, giới hạn quyền sử dụng |
| `music.json`, `panel.json`, `games.json`, `general.json` | Nhạc, bảng điều khiển, trò chơi, lời bài hát |

`catalog.json` là hợp đồng kiểm tra: khóa, biến được phép và nơi sử dụng. Không sửa file này chỉ để thay câu chữ. Khi lập trình thêm thông báo mới, cập nhật hợp đồng tương ứng.

## Giữ riêng bản anh đã chỉnh

Thứ tự ưu tiên từ thấp đến cao:

1. `resources/vi/<nhóm>.json`: văn bản mặc định.
2. `sandbox/i18n/<nhóm>.json`: văn bản tính năng do AI tạo.
3. `resources/overrides/vi/<nhóm>.json`: bản anh chỉnh, luôn được ưu tiên.

Các lớp được gộp theo từng khóa, không thay thế cả nhóm. Anh chỉ cần chép đúng nhánh muốn sửa vào file cùng tên trong `overrides/vi/`. Ví dụ, ghi vào `overrides/vi/messages.json`:

```json
{
  "selfdevservice": {
    "settitle_hoan_tat_roi_ne": "Mình chuẩn bị xong rồi, bạn thử nhé!"
  },
  "music": {
    "radio_list_item": "{{rank}}. [{{title}}]({{url}}) · Người thêm: {{addedBy}}"
  }
}
```

Để chỉnh một câu của tính năng AI sinh, mở `sandbox/i18n/<tên-lệnh>.json`, chép nhánh cần sửa sang `resources/overrides/vi/<tên-lệnh>.json`. Không đổi `customId`, giá trị lựa chọn, tên lệnh hoặc tên tham số trong code chỉ để đổi cách hiển thị.

Ví dụ `overrides/vi/logs.json` đổi nhãn và bố cục Logger:

```json
{
  "logger": {
    "info": " THÔNG TIN ",
    "line": "{{timestamp}} {{level}} | {{message}}"
  }
}
```

Mẫu nội dung của các lệnh `console.*` cũng nằm trong `logs.json`; bố cục `logger.line` chỉ áp dụng cho lớp `Logger`. Nội dung lỗi và stack do thư viện trả về vẫn giữ nguyên để tra lỗi.

## Kiểm tra và áp dụng

Chạy tại thư mục gốc bot:

```powershell
npm run check:resources
npm run test:resources
```

Sau khi kiểm tra đạt, khởi động lại tiến trình bot để nạp câu chữ mới. Nếu đang phát triển, code có thể gọi `reloadI18n()`; hàm này giữ bản đang dùng nếu lần đọc mới lỗi. Hiện chưa có tự động theo dõi file hoặc giao diện biên tập. Các giá trị được tạo lúc import module vẫn cần khởi động lại.

Đổi mô tả lệnh/lựa chọn cần đồng bộ lệnh lên Discord qua quy trình deploy hiện có (`npm run deploy`), sau đó khởi động lại bot. Tin nhắn đã gửi không tự thay đổi; câu chữ mới dùng cho lần gửi/cập nhật tiếp theo.

## Quy tắc khi sửa hoặc mở rộng

- Giữ nguyên tên và tập biến `{{title}}`, `{{count}}`…; có thể đổi vị trí chúng. Chuỗi rỗng chỉ dùng khi vị trí đó cho phép.
- Viết `\n` để xuống dòng, `\"` cho dấu nháy kép trong JSON; không thêm dấu phẩy cuối hoặc comment.
- Thông báo Discord dùng “mình – bạn”, tránh chi tiết kỹ thuật và lỗi nội bộ. Log có thể dùng thuật ngữ để tìm nguyên nhân.
- Với code mới, gọi `t('nhóm.chức_năng.tên_thông_báo', { biến })`. Không dùng câu chữ làm điều kiện xử lý; mã lỗi, ID và đường dẫn kỹ thuật giữ trong code.
- Hợp đồng kiểm tra được JSON, khóa thiếu, tên biến và phần văn bản tĩnh vượt giới hạn đã khai báo. Dữ liệu động dài, tổng kích thước embed, URL và emoji thực tế vẫn cần kiểm tra khi gửi Discord.
- Câu trả lời được AI viết theo từng cuộc trò chuyện không phải mẫu cố định. Chỉnh phong cách tại `config/prompt/Persona.md`, `Task.md`, `Format.md`; tài nguyên ở đây điều khiển các mẫu cố định và tính năng có dùng `t()`.
- Các tính năng sandbox cũ có câu chữ viết thẳng trong code cần chuyển sang `t()` trước; thêm JSON một mình không tự thay câu chữ đó.
