# Hướng dẫn Sử dụng Placeholder

Hệ thống hỗ trợ các từ khóa (placeholder) để tự động thay thế bằng thông tin thực tế khi bot gửi tin nhắn. Bạn có thể dùng các thẻ này trong **tin nhắn chào mừng**, **tạm biệt**, hoặc **các lệnh custom**.

## 1. Người dùng (User)
| Từ khóa | Ý nghĩa | Ví dụ hiển thị |
| :--- | :--- | :--- |
| `{{user}}` | Tag tên người dùng | <@123456789> |
| `{{user_name}}` | Tên đăng nhập | dolia_bot |
| `{{user_id}}` | ID người dùng | 123456789 |
| `{{nickname}}` | Biệt danh trong server | Dolia [Admin] |
| `{{user_avatar}}` | Link ảnh đại diện | https://cdn... |
| `{{user_joined_at}}` | Ngày vào server | 10:00 01/01/2024 |
| `{{user_created_at}}`| Ngày tạo tài khoản | 14:30 15/06/2023 |
| `{{user_age}}` | Tuổi tài khoản | 1 năm, 2 tháng |

## 2. Server (Máy chủ)
| Từ khóa | Ý nghĩa | Ví dụ hiển thị |
| :--- | :--- | :--- |
| `{{server_name}}` | Tên Server | Cộng Đồng Game |
| `{{server_id}}` | ID Server | 987654321 |
| `{{member_count}}` | Tổng số thành viên | 150 |
| `{{server_icon}}` | Link Icon Server | https://cdn... |

## 3. Kênh (Channel)
| Từ khóa | Ý nghĩa | Ví dụ hiển thị |
| :--- | :--- | :--- |
| `{{channel_name}}` | Tên kênh hiện tại | chat-chung |
| `{{channel_mention}}`| Tag kênh | <#111222333> |
| `{{channel_topic}}` | Chủ đề kênh | Nơi thảo luận chung |

## 4. Bot
| Từ khóa | Ý nghĩa | Ví dụ hiển thị |
| :--- | :--- | :--- |
| `{{bot_name}}` | Tên Bot | Dolia |
| `{{bot_ping}}` | Độ trễ (Ping) | 24ms |

## 5. Thời gian
| Từ khóa | Ý nghĩa | Ví dụ hiển thị |
| :--- | :--- | :--- |
| `{{vn_time}}` | Giờ Việt Nam | 14:30 01/02/2026 |
| `{{timestamp}}` | Unix Timestamp | 1700000000 |
| `{{time}}` | Giờ hiện tại (ngắn) | 14:30:00 |
| `{{date}}` | Ngày hiện tại (ngắn)| 01/02/2026 |

**Lưu ý:**
- Các thẻ không phân biệt hoa thường (ví dụ `{{USER}}` giống `{{user}}`).
- Có thể viết có khoảng trắng: `{{ user_name }}`.