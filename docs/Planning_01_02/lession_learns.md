# Bài học kinh nghiệm

## Quy trình Planning chuẩn (Standard Flow)
Để đảm bảo tiến độ và chất lượng, mỗi planning mới cần tuân thủ các bước sau:
1. **Phân tích Yêu cầu (`requirements.md`)**: Xác định rõ tính năng, quyền hạn (Admin/User) và logic nghiệp vụ.
2. **Lập Checklist (`check_lists.md`)**: Chia nhỏ nhiệm vụ thành các giai đoạn: Chuẩn bị -> Core -> Nâng cao -> Kiểm thử -> Tài liệu.
3. **Lên Plan Triển khai (Artifact)**: Liệt kê các file sẽ thay đổi ([MODIFY], [NEW]) và logic cụ thể.
4. **Thực hiện & Kiểm thử (Execution & Verification)**: Code và viết script test trong thư mục `test/` để verify logic.
5. **Quản lý lỗi (`issue_lists.md`)**: Ghi chép BUG00x (Mô tả, Giải pháp đã thử, Giải pháp cuối). Tuyệt đối không thử lại các giải pháp đã thất bại.
6. **Cập nhật Bài học (`lession_learns.md`)**: Lưu lại kinh nghiệm mới vào danh sách bên dưới.
7. **Triển khai Git**: `git add` -> `git commit` -> `git push` (Luôn tuân thủ quy tắc bảo mật trong `.gitignore`).

---

## Danh sách bài học chi tiết
- Nội dung file hướng dẫn/tài liệu phải hoàn toàn bằng tiếng Việt để dễ hiểu và thống nhất.
- Sau khi chốt file requirements, cần lập ngay file `check_lists.md` để liệt kê chi tiết các công việc cần làm để hoàn thành kế hoạch.
- Bot tự viết code, tự kiểm tra và tự đánh dấu checklist. User chỉ đóng vai trò Reviewer và chạy server.
- File test phải nằm trong thư mục `test` riêng biệt để tránh lộn xộn. Code bắt buộc sử dụng chuẩn ESM (import/export), không dùng CommonJS.
- Trong file checklist, cần phân chia các yêu cầu theo mã định danh (ví dụ: REQ001, REQ002...) để dễ dàng quản lý và mở rộng sau này.
- Bot con không cần cài node_modules vì nó sử dụng thư viện của bot cha.
- Đối với những tác vụ liên quan đến CRUD, ghi log, hoặc quản lý dữ liệu người dùng, cần sử dụng Database thay vì lưu trong file JSON hoặc RAM. File JSON chỉ nên dùng cho các cấu hình tĩnh hoặc danh sách chuỗi cố định.
- Check-lists không phải là cố định, chúng có thể và cần được điều chỉnh linh hoạt theo yêu cầu và phản hồi của người dùng trong quá trình phát triển.
- Mỗi khi có yêu cầu mới hoặc thay đổi hướng đi, bot cần tự giác cập nhật hoặc tạo mới các file `requirements.md` và `check_lists.md` để đảm bảo quy trình làm việc minh bạch và có hệ thống.
- Cần duy trì file `issue_lists.md` để theo dõi và quản lý lỗi (BUG001, BUG002...). Mỗi lỗi cần mô tả rõ: mô tả lỗi, các action/giải pháp đã thử nhưng thất bại, và giải pháp cuối cùng được áp dụng. Tuyệt đối không thử lại các giải pháp đã thất bại.
- Khi người dùng yêu cầu "push lên git", thực hiện các lệnh: `git add <file>`, `git commit -m "<mô tả>"`, và `git push`. Đây là quy trình chuẩn để cập nhật code lên repository.
- Tuyệt đối không push các tài liệu nội bộ, file test nhạy cảm hoặc cấu hình bảo mật lên GitHub. Luôn luôn kiểm tra file `.gitignore` và sử dụng `git status` để xem danh sách file sẽ được push trước khi thực hiện lệnh commit/push.
