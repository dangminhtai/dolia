# LUÔN ĐẢM BẢO CÁC RULE ĐƯỢC THỎA MÃN

- Hãy luôn nghiêm túc nghĩ hệ thống luôn có lỗi, luôn lo sợ hơn là nói hệ thống ổn định không crash,...
- Tuyệt đối không hard-code các giá trị có thể thay đổi trong tương lai. Hãy ưu tiên sử dụng hệ thống config/resource hiện có. Nếu cần thêm một key hoặc cấu hình mới, phải hỏi và được người dùng đồng ý trước khi thực hiện.
- Không được hard code model Gemini (không bao giờ ghi model gemini trong code ) hãy làm cho nó có thể sử dụng được trong tương lai pattern 3 phần phần đầu là gemini phần 2 là phiên bản phần 3 là flash hoặc flash lite
 - pass gemini-3.5-flash-lite
 - pass gemini-3.6-flash
 - fail gemini-omni-flash
 - fail gemini-3.1-pro

để làm được điều này hãy lấy dữ liệu từ model list trả về 

- Dolia có tính cách riêng vì thế mọi tin nhắn hiển thị lên cho người dùng thấy hướng đến xưng hô mình và bạn
