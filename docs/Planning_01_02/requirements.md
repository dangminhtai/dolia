# Yêu cầu: Helper Placeholder Đa năng

## 1. Mục tiêu
Tạo một hàm helper mạnh mẽ và toàn diện để xử lý việc thay thế văn bản (placeholder) cho bot Discord. Hàm này sẽ thay thế các thẻ như `{{user}}`, `{{server_name}}` bằng dữ liệu thực tế từ ngữ cảnh hiện tại (User, Member, Guild, Channel).

## 2. File Mục tiêu
- **Đường dẫn**: `bot/Dolia/helpers/placeHolder.js`
- **Mô tả**: Cập nhật hàm `formatString` hiện có hoặc tạo helper dạng class mới nếu chức năng trở nên phức tạp.

## 3. Các Placeholder được hỗ trợ

### 3.1 Ngữ cảnh Người dùng (`{{user...}}`)
| Placeholder | Mô tả | Ví dụ kết quả |
| :--- | :--- | :--- |
| `{{user}}` | Tag người dùng | `<@123456789>` |
| `{{user_id}}` | ID người dùng | `123456789` |
| `{{user_name}}` | Tên đăng nhập | `dolia_bot` |
| `{{user_global_name}}` | Tên hiển thị toàn cầu | `Dolia Bot` |
| `{{nickname}}` | Biệt danh server (ưu tiên) hoặc tên đăng nhập | `Dolia [Admin]` |
| `{{user_tag}}` | Tag người dùng (Legacy) | `dolia_bot` |
| `{{user_avatar}}` | Link Avatar | `https://cdn.discord...` |
| `{{user_created_at}}` | Ngày tạo tài khoản (Giờ VN) | `10:00 01/01/2023` |
| `{{user_joined_at}}` | Ngày vào server (Giờ VN) | `14:30 15/06/2024` |
| `{{user_age}}` | Tuổi tài khoản (Dễ đọc) | `2 năm, 3 tháng` |

### 3.2 Ngữ cảnh Server (`{{server...}}`)
| Placeholder | Mô tả | Ví dụ kết quả |
| :--- | :--- | :--- |
| `{{server_name}}` | Tên Server | `Community Server` |
| `{{server_id}}` | ID Server | `987654321` |
| `{{member_count}}` | Tổng thành viên | `150` |
| `{{server_icon}}` | Link Icon Server | `https://cdn.discord...` |
| `{{server_owner_id}}` | ID Chủ Server | `1122334455` |

### 3.3 Ngữ cảnh Bot (`{{bot...}}`)
| Placeholder | Mô tả | Ví dụ kết quả |
| :--- | :--- | :--- |
| `{{bot_name}}` | Tên Bot | `Dolia` |
| `{{bot_id}}` | ID Bot | `555555555` |
| `{{bot_avatar}}` | Link Avatar Bot | `https://cdn.discord...` |
| `{{bot_ping}}` | Độ trễ WebSocket | `24ms` |

### 3.4 Ngữ cảnh Kênh (`{{channel...}}`)
| Placeholder | Mô tả | Ví dụ kết quả |
| :--- | :--- | :--- |
| `{{channel_name}}` | Tên kênh | `chat-chung` |
| `{{channel_id}}` | ID kênh | `111222333` |
| `{{channel_mention}}` | Tag kênh (Clickable) | `<#111222333>` |
| `{{channel_topic}}` | Chủ đề kênh | `Thảo luận chung` |

### 3.5 Thời gian & Tiện ích (`{{...}}`)
| Placeholder | Mô tả | Ví dụ kết quả |
| :--- | :--- | :--- |
| `{{vn_time}}` | Giờ VN hiện tại | `HH:mm dd/MM/YYYY` |
| `{{timestamp}}` | Unix Timestamp (giây) | `1700000000` |
| `{{date}}` | Ngày hiện tại | `dd/MM/YYYY` |
| `{{time}}` | Giờ hiện tại | `HH:mm:ss` |

## 4. Yêu cầu Chức năng

1.  **Xử lý mạnh mẽ**:
    - Nếu thiếu giá trị (ví dụ: user không có avatar), trả về chuỗi mặc định hoặc rỗng, không báo lỗi.
    - Nếu `context` thiếu thành phần (ví dụ: DM không có `guild`), xử lý mượt mà (trả về "N/A" hoặc fallback).

2.  **Linh hoạt định dạng**:
    - Hỗ trợ khoảng trắng trong ngoặc: `{{ user_name }}` phải hoạt động giống `{{user_name}}`.
    - **Không phân biệt hoa thường**: `{{USER_NAME}}` phải hiểu là `{{user_name}}`.

3.  **Khả năng mở rộng**:
    - Code phải được cấu trúc để dễ dàng thêm placeholder mới trong tương lai (ví dụ: dùng map hoặc object config).

## 5. Ghi chú Triển khai
- Sử dụng file hiện có `helpers/placeHolder.js`.
- Đảm bảo múi giờ luôn là `Asia/Ho_Chi_Minh`.
- Sử dụng object `Message` hoặc `Interaction` của Discord.js làm nguồn dữ liệu chính.

## REQ002: Tự động chào buổi sáng & Quản lý người dùng

### 1. Mục tiêu
- Bot tự động gửi tin nhắn chào buổi sáng lúc **6:00 AM (Giờ Việt Nam)** hằng ngày.
- Đối tượng: Những người dùng đã được thêm vào danh sách.
- Quản lý: Admin có lệnh thêm người dùng vào danh sách.
- Trả lời DM: Nếu user nhắn riêng cho bot, bot trả lời thông báo chưa hỗ trợ.

### 2. Chi tiết Chức năng
1.  **Lập lịch (Cron Job)**:
    - Thời gian: `0 6 * * *` (6h sáng mỗi ngày).
    - Timezone: `Asia/Ho_Chi_Minh`.
    - Hành động: Lặp qua danh sách user đăng ký -> Gửi tin nhắn chào.
    - Nội dung tin nhắn: Sử dụng `helpers/placeHolder.js` để custom (ví dụ: "Chào buổi sáng {{user_name}}!").

2.  **Lệnh Admin (`manage_morning_user`)**:
    - Input: `user` (User cần thêm/xóa/test), `action` (add/remove/test).
    - Logic:
        - `add`: Lưu ID user vào database.
        - `remove`: Xóa ID user khỏi database.
        - `test`: Gửi ngay lập tức một tin nhắn chào buổi sáng (ngẫu nhiên từ config) cho user đó để verify.
    - Permission: Chỉ **Bot Admin** (Chủ sở hữu bot).

3.  **Xử lý DM (Direct Message)**:
    - Khi nhận tin nhắn trong DM (không phải từ Server):
        - Bot reply: "Bot chưa được phát triển ở DM để nhắn tin, vui lòng thử lại sau".
    - Không reply tin nhắn của chính mình (bot).

### 3. Lưu trữ
- File config: `bot/Dolia/config/Greeting/GoodMorning.json`.
- Cấu trúc: Danh sách User ID hoặc Object `{ userId, channelId }`.

