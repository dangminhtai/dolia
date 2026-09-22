# DOLIA MEMORY — Kế hoạch triển khai bộ nhớ dài hạn và bảng quản lý Discord

> **Trạng thái:** Kế hoạch thiết kế, chưa thay đổi source code.  
> **Source đối chiếu:** `dolia-stable-termux(3).zip` do người dùng gửi.  
> **Mục tiêu:** Bot riêng cho 2–5 người; ưu tiên phản hồi nhanh, tính nhất quán, dữ liệu đáng tin và người dùng kiểm soát được điều Dolia nhớ. Chạy trên Windows và Android/Termux, sử dụng MongoDB hiện có.  
> **Không làm:** Xây agent riêng để ghi một dòng memory; lưu toàn bộ transcript/ảnh dạng base64; tự ý biến câu nói của một người thành luật áp dụng cho toàn server.

## 1. Hiện trạng trong bản ZIP

| Thành phần                                   | Đã có                                                                                                       | Vấn đề liên quan memory                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `models/Chat.js`                             | Mongoose `Chat`: `channelId`, `userId`, `turns`, `agentSession`                                             | `turns` là lịch sử ngắn hạn, chưa có collection memory/nguồn dẫn/phiên bản.                                                                                                              |
| `helpers/chatHelper.js`                      | `getChatSession`, `getHistory`, `saveInteraction`                                                           | Session chung theo channel; lưu tối đa **60 turn**; `getHistory()` thường lấy `chatLimit` từ `User` (mặc định **20**), cắt thêm 6 turn để lọc. Không thể dùng nó như kho kỷ niệm đầy đủ. |
| `models/User.js`                             | `userId`, `chatLimit`, `musicProvider`                                                                      | Chưa có chính sách memory hay quyền xem/chỉnh.                                                                                                                                           |
| `class/GeminiManager.js`                     | Gemini function calling; `musicTools`, `discordTools`, `devTools`; prompt/context; lưu history sau phản hồi | Chưa có memory retrieval trước suy luận, chưa có direct memory tool, chưa có xác nhận lưu thành công.                                                                                    |
| `helpers/promptHelper.js` + `config/prompt/` | Persona, Task, Context, Format với prompt cache                                                             | Chưa tách quy tắc hệ thống khỏi ghi nhớ do user tạo.                                                                                                                                     |
| `events/client/messageCreate.js`             | Nhận chat tại `#dolia` và gửi kết quả                                                                       | Chưa có memory panel/handler component; không nên dùng `agent_code` để sửa memory.                                                                                                       |
| MongoDB / Termux                             | Hạ tầng và dependency `mongoose` sẵn có                                                                     | Không cần thêm vector DB, Redis hoặc Python cho MVP.                                                                                                                                     |

**Quy tắc kiến trúc:** chat history, long-term memory, user preference và server policy là **bốn loại dữ liệu khác nhau**. Không trộn chúng vào một prompt string hay một document MongoDB duy nhất.

## 2. Hành vi người dùng phải hỗ trợ

| Câu người dùng                                          | Cách xử lý mong muốn                                                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| “Hãy ghi nhớ điều này: tao thích câu trả lời ngắn.”     | Lưu preference của **người đang nói**, trả xác nhận sau khi MongoDB ghi thành công.                                                      |
| “Hãy nhớ điều tao vừa nhắc ở trên.”                     | Tra nguồn phù hợp gần đây; nếu nhiều ý khả dĩ thì liệt kê lựa chọn để xác nhận; không tự bịa referent.                                   |
| “Nhớ rằng dự án Dolia chạy trên Termux.”                | Lưu project fact đúng scope; gắn source message ID.                                                                                      |
| “Tóm tắt các kỷ niệm từ lịch sử trò chuyện vào bộ nhớ.” | Đọc phạm vi lịch sử được cho phép, trích các memory candidate kèm nguồn; hiển thị preview; user chọn mục để lưu.                         |
| “Từ nay hãy nói lịch sự với tao.”                       | Cập nhật preference/style riêng user; có thể áp dụng ngay cho lượt hiện tại.                                                             |
| “Dolia tự thêm quy tắc giao tiếp lịch sự.”              | Giữ etiquette **mặc định** trong Persona/Task; chỉ tự đề xuất preference mới khi có bằng chứng ổn định, không âm thầm sửa system policy. |
| “Mày nhớ gì về tao?”                                    | Direct `memory_query`, chỉ trả các memory user có quyền xem.                                                                             |
| “Sửa bộ nhớ số 3 thành...” / “Quên chuyện đó đi.”       | Sửa/xóa đúng memory ID theo quyền; yêu cầu phân giải khi không rõ mục.                                                                   |
| “Mở bảng bộ nhớ của tao.”                               | Gửi Discord ephemeral/slash panel có xem, thêm, sửa, xóa, history, xuất dữ liệu.                                                         |
| “Đừng nhớ chuyện này.”                                  | Không đưa nội dung đó vào đề xuất memory; tùy chọn ghi opt-out ở scope phù hợp.                                                          |

## 3. Phạm vi bộ nhớ và quyền truy cập

1. `user_private`: sở thích, cách xưng hô, dự án cá nhân; owner là Discord `userId`, không tự hiển thị cho người khác trong kênh chung.
2. `channel_shared`: các sự kiện/inside joke/project chung **đã được cho phép chia sẻ**, giới hạn `guildId + channelId`.
3. `guild_shared`: luật nội bộ, thông tin server có ích chung; chỉ owner hoặc người có quyền cấu hình được thêm/sửa rule loại này.
4. `bot_persona`: quy tắc mặc định do developer cung cấp, **quản lý bằng file prompt/code**, không cho memory user ghi đè.
5. `session_working`: mục tiêu tức thời và tham chiếu “điều vừa nói”, có hạn dùng, không phải memory dài hạn.

**Không dùng `OWNER_ID` của bot để mặc nhiên đọc hoặc công bố memory riêng của mọi người.** Với 2–5 người, đơn giản nhất là memory cá nhân chỉ người đó truy cập; chính chủ có quyền xóa; memory chung cần quyền rõ ràng.

### Đường biên tin cậy

- Memory là dữ liệu, **không phải system instruction**, không có quyền sửa tool policy, permission, intent guard hoặc chỉ dẫn bảo mật.
- Một user không thể yêu cầu Dolia lưu “từ nay tự ban bất cứ ai...” để vượt destructive-action guard.
- Không nhận nội dung của ảnh/file/web/agent/tool response làm **lệnh ghi nhớ** chỉ vì trong đó chứa “hãy nhớ”; chỉ nhận yêu cầu hợp lệ từ author hiện tại.
- Không tự nhớ token/API key/password, nội dung riêng tư của người khác, thông tin nhạy cảm, dữ liệu có thể gây hại hoặc dữ liệu không được phép ghi nhớ; nói rõ khi bỏ qua/đề nghị biên tập lại.
- Memory không cấp quyền mới trên Discord; quyền luôn được kiểm tra bằng runtime user/guild permissions.

## 4. Mô hình dữ liệu MongoDB

Tạo `models/Memory.js` (collection `memories`), không nhét thêm vào mảng `Chat.turns`:

```js
{
  _id: ObjectId,
  guildId: String | null,
  channelId: String | null,
  ownerId: String | null,
  scope: 'user_private' | 'channel_shared' | 'guild_shared',
  kind: 'fact' | 'preference' | 'project' | 'event' | 'relationship' | 'rule',
  key: String,                    // vd: 'reply_style', 'project:dolia:hosting'
  text: String,                   // sự thật/ưu tiên ngắn, độc lập ngữ cảnh
  tags: [String],
  status: 'active' | 'archived' | 'deleted',
  confidence: Number,            // nội bộ, KHÔNG trình bày như độ chính xác khách quan
  provenance: {
    source: 'explicit_user' | 'reviewed_summary' | 'approved_suggestion' | 'manual_ui',
    messageIds: [String],
    sourceChannelId: String | null,
    recordedBy: String
  },
  createdAt: Date,
  updatedAt: Date,
  expiresAt: Date | null,
  version: Number
}
```
