---
name: canvas
description: Kỹ năng vẽ Canvas chuyên nghiệp cho bot Discord (bố cục, text tiếng Việt, màu sắc, avatar bo góc, cache, tối ưu render)
---

# Skills vẽ Canvas cho bot Discord

## 1) Nền tảng
- Biết tạo canvas với kích thước đúng mục đích: avatar, card, banner, rank card, poster.
- Hiểu luồng cơ bản: tạo canvas → lấy context → vẽ nền → vẽ layer → render text/icon → xuất PNG/JPG/WebP.
- Tự do lựa chọn công cụ phù hợp: Node.js Canvas (`@napi-rs/canvas`, `canvas`) hoặc Python (`Pillow/PIL`, `matplotlib`, `numpy`) tùy tác vụ.
- Biết kiểm tra chất lượng ảnh ở nhiều kích thước.

## 2) Bố cục
- Căn lề, chia lưới, giữ khoảng trắng hợp lý.
- Ưu tiên 1 điểm nhấn chính, 2–4 thành phần phụ.
- Dùng khung nhìn rõ ràng: trái phải, trên dưới, center card.
- Hạn chế nhồi quá nhiều chữ vào một vùng nhỏ.

## 3) Text
- Chọn font phù hợp cho tiếng Việt (ưu tiên Segoe UI, Arial, Roboto).
- Canh chữ theo baseline, line-height, letter-spacing.
- Tự co cỡ chữ khi tên quá dài.
- Có cơ chế cắt chữ bằng ellipsis khi cần.
- Tách tiêu đề, nhãn, số liệu bằng trọng lượng chữ khác nhau.

## 4) Màu sắc và hiệu ứng
- Dùng gradient để tránh nền phẳng.
- Dùng shadow nhẹ để tách lớp.
- Giữ độ tương phản đủ cao cho chữ.
- Hạn chế quá nhiều màu chói cùng lúc.
- Có thể thêm blur, glow, overlay, vignette nhẹ.

## 5) Icon và emoji
- Không phụ thuộc hoàn toàn vào emoji màu trong font hệ thống.
- Nếu emoji không hiện ổn định, dùng PNG/SVG hoặc Twemoji.
- Nên có bộ icon vector đơn giản cho thống kê, rank, thông báo.
- Kiểm tra font fallback trước khi triển khai thật.

## 6) Ảnh và avatar
- Cắt ảnh tròn, bo góc, mask theo shape.
- Resize ảnh đúng tỉ lệ, tránh méo.
- Có viền sáng, viền đậm hoặc shadow để nổi ảnh.
- Xử lý ảnh đầu vào lỗi, ảnh rỗng, ảnh quá nhỏ.

## 7) Layout nâng cao
- Dùng layer rõ ràng: background, decoration, content, foreground.
- Tạo card nhiều khối: profile, stats, progress, badge.
- Thiết kế responsive theo nhiều tỉ lệ ảnh nếu bot hỗ trợ.
- Hỗ trợ nhiều theme: dark, light, neon, pastel.

## 8) Dữ liệu động từ Discord
- Lấy tên người dùng, avatar, nickname, role, level, XP.
- Xử lý text dài và ký tự đặc biệt.
- Có fallback khi thiếu avatar hoặc thiếu dữ liệu.
- Render an toàn khi dữ liệu từ API không đầy đủ.

## 9) Chất lượng ảnh
- Xuất ảnh ở độ phân giải đủ cao để không vỡ chữ.
- Kiểm tra anti-aliasing, bo góc, shadow, stroke.
- So sánh ảnh trên desktop và mobile.
- Test trường hợp chữ dài, số lớn, icon thiếu, ảnh lỗi.

## 10) Tối ưu
- Tránh vẽ lại phần tĩnh quá nhiều.
- Cache background hoặc asset nếu dùng thường xuyên.
- Giảm số lần load font và ảnh.
- Cân nhắc thời gian render khi bot gửi ảnh hàng loạt.

## 11) Checklist khi làm một mẫu canvas
- Có bố cục rõ.
- Text đọc được.
- Màu hợp nhau.
- Avatar/ảnh không méo.
- Icon hiện ổn định.
- Không vỡ khi tên dài.
- Xuất ảnh đẹp ở cả nền tối và sáng.

## 12) Kỹ năng nên luyện thêm
- Vẽ progress bar.
- Vẽ avatar tròn có viền.
- Vẽ card thống kê.
- Vẽ biểu đồ đơn giản.
- Vẽ banner có nhiều layer.
- Xử lý emoji và icon an toàn.
- Thiết kế prompt test khó để kiểm tra giới hạn.

## Gợi ý bài test cho bot Discord
- Rank card có avatar, level, XP bar và 4 chỉ số.
- Welcome banner có tên người vào server và badge.
- Trading card có rarity, frame, stat.
- Poster có nền gradient, glow, nhiều layer chữ.
- Biểu đồ nhỏ gọn cho thống kê hoạt động.

## Kết luận
Một bot Discord vẽ Canvas tốt cần 4 thứ:
- Bố cục đẹp.
- Text ổn định.
- Asset hiện đúng.
- Render không lỗi khi dữ liệu phức tạp.
