# Cô lập sandbox trên nền e6050e7

## Yêu cầu

- Giữ tính năng và luồng sinh script, chạy, trả sản phẩm của commit e6050e7.
- Windows/Linux/Android; không bắt buộc Docker.
- Chỉ thay phần thực thi và quyền truy cập cần thiết. Không chuyển sang agent_task, không đổi prompt nhân vật, model, luồng chat hoặc hệ thống nhạc.
- Đã vá bảo vệ đường dẫn và bỏ thực thi mã trong bước kiểm tra. Chưa triển khai ranh giới thực thi; các bản vá này không chứng minh mã AI đã được cô lập.

## Những chỗ phải đưa ra khỏi tiến trình bot

- services/selfDevService.js: runDynamicScript import và chạy script với client/guild/channel/user/message thật.
- services/selfDevService.js: hot reload lệnh sinh ra và gọi execute ngay tại chỗ.
- deployCommands.js: import lệnh trong sandbox/slash lúc quét/đăng ký lệnh.
- core/sandbox/sandbox-validator.js: validateSlashCommand import mã khi kiểm tra cấu trúc.
- core/sandbox/package-installer.js: cài dependency của mã sinh vào dự án bot.
- Game có collector/callback và trạng thái sống: cần chuyển sự kiện qua lớp trung gian, không thay bằng ảnh chụp dữ liệu tĩnh.

## Vì sao không sao chép worker của dolia-android

Worker cục bộ đó sử dụng Docker với mạng tắt, dữ liệu Discord dạng snapshot và giao diện thực thi khác bản e6050e7. Snapshot không thay thế được fetch thành viên, gửi tin, collector, quản lý tin nhắn và các thao tác Discord khác. Nhánh remote agent khi worker tắt cũng đổi luồng giao sản phẩm. Sao chép nguyên hai cách đó không đáp ứng yêu cầu giữ tính năng.

## Ranh giới cần triển khai

1. Bot giữ token, kết nối database và đối tượng Discord thật.
2. Mã sinh chạy trong môi trường riêng, không có quyền đọc thư mục bot hoặc thông tin đăng nhập.
3. Các thao tác Discord được chuyển qua giao diện trung gian; host kiểm tra người gọi, kênh, quyền và đối tượng trước khi thực hiện. Không cho gọi phương thức tùy ý hoặc trả token qua giao diện này.
4. Chuyển dữ liệu, tệp và sự kiện giữa hai phía; giữ cách nhận kết quả, sửa script và thao tác game của người dùng.
5. Hạn thời gian phải dừng được tiến trình cùng tiến trình con. Promise.race chỉ kết thúc chờ, không dừng thực thi.
6. Cài dependency trong môi trường thực thi, không chạy lifecycle script của package do agent chọn trong bot chính.

## Điều kiện môi trường chưa xác nhận

Anh xác nhận Android chạy Termux không root. Đã đọc TERMUX.md từ dolia-android: tài liệu đó tắt Self-Dev, script cục bộ và sandbox extension có chủ đích; không cung cấp backend cô lập để chép sang mà giữ các tính năng này. Node chạy cùng UID trong Termux không tự tạo được ranh giới Android Application Sandbox giữa bot và script. Chưa chọn backend hoặc đưa phụ thuộc mới vào dự án.

Tách tiến trình, đổi cwd, xóa biến môi trường và bật Node Permission Model là những biện pháp bổ sung; không được mô tả chúng như sandbox chống mã độc. Bật lại native addon và child process để Canvas/Python/FFmpeg hoạt động càng đòi hỏi ranh giới ở hệ điều hành.

Nguồn: https://nodejs.org/api/permissions.html và https://source.android.com/docs/security/app-sandbox.

## Checklist triển khai

- [x] Đọc luồng cũ và đối chiếu worker hiện có.
- [x] Xác định điểm import mã sinh và phụ thuộc game/collector.
- [ ] Xác định backend cô lập phù hợp môi trường thực tế, nhất là Android.
- [ ] Triển khai runtime và giao diện Discord trung gian theo danh sách tính năng cũ.
- [ ] Chuyển toàn bộ điểm thực thi, gồm validation/deploy/hot reload.
- [ ] Kiểm tra cú pháp; anh kiểm tra hành vi Discord và môi trường thực thi.

Chưa thể xác nhận an toàn hoặc giữ đủ tính năng chỉ bằng kiểm tra cú pháp.

## Bản vá giới hạn đã thực hiện

- sandbox-manager.js: bỏ catch nuốt lỗi symlink, kiểm tra cả thư mục cha của tệp chưa tồn tại, kiểm tra root bị thay thế, chặn hard link của tệp và tên đặc biệt/alternate data stream; ngăn xóa gốc sandbox. Kiểm tra lại đường dẫn sau khi tạo thư mục cha.
- sandbox-validator.js: dùng execFile với process.execPath và mảng tham số cho node --check, không đưa tên tệp vào shell. Không import mã AI trong validateSlashCommand: import thực thi mã cấp module ngay cả khi chỉ muốn xem data. Việc xác nhận export thực tế vẫn nằm ở loader hiện có.
- Không thay agent/model, tính năng Discord, cách tạo/chạy/gửi script, hot reload, package hoặc backend. Việc này cũng có nghĩa mã sinh vẫn có thể chạy với quyền của bot ở những điểm được liệt kê phía trên.
- Giới hạn quan trọng: SandboxManager chỉ bảo vệ thao tác đi qua chính nó. Script import fs trực tiếp không bị lớp này chặn. Kiểm tra đường dẫn cũng không phải bảo đảm chống đổi symlink đồng thời bởi mã có cùng quyền hệ điều hành.
- Để cô lập thực thi thật trên Android không root mà vẫn có native Canvas/Python/FFmpeg, cần môi trường thực thi có quyền riêng, chẳng hạn ứng dụng Android riêng hoặc dịch vụ thực thi riêng, rồi triển khai giao diện Discord trung gian. Chưa làm phần này và không gọi các vá hiện tại là hoàn thành nhiệm vụ cô lập.
