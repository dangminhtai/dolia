# Requirements Document: Tính năng Tìm kiếm Lời bài hát (Lyrics Search)

## 1. Tổng quan
Tạo một lệnh cho Discord Bot cho phép người dùng tìm kiếm thông tin chính xác về bài hát (Tên bài hát, Nghệ sĩ, Lời bài hát đầy đủ) chỉ dựa trên một đoạn lời (lyrics snippet) mà họ cung cấp. Tính năng này sẽ sử dụng sức mạnh của **Google Gemini AI** kết hợp với **Grounding with Google Search** để đảm bảo kết quả tìm kiếm là mới nhất và chính xác nhất.

## 2. Yêu cầu chức năng
- **Tên lệnh:** `/lyrics` (Slash Command).
- **Tham số đầu vào:** 
    - `query` (String, Required): Đoạn lời bài hát hoặc câu hát mà người dùng nhớ được.
- **Quy trình xử lý:**
    1. Nhận đoạn text từ người dùng.
    2. Gửi request đến model `gemini-2.5-flash-lite`
    3. Sử dụng công cụ `googleSearch` để tìm kiếm thông tin bài hát trên mạng.
    4. Trích xuất thông tin: Tên bài hát, Tên ca sĩ/nhạc sĩ, và Lời bài hát đầy đủ.
    5. Trả về kết quả dưới dạng Embed đẹp mắt trên Discord.
- **Xử lý lỗi:**
    - Nếu không tìm thấy: Thông báo cho người dùng một cách lịch sự.
    - Nếu API lỗi: Thông báo hệ thống đang bận.

## 3. Yêu cầu kỹ thuật
Sử dụng thư viện `@google/genai` kết hợp với **Structured Outputs** (JSON Schema) thông qua `zod` để đảm bảo dữ liệu trả về luôn có cấu trúc ổn định, dễ dàng parse và hiển thị trên Discord Embed.

### Định nghĩa Schema (Zod):
```javascript
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const lyricsSchema = z.object({
  is_found: z.boolean().describe("Trả về true nếu tìm thấy bài hát, false nếu không tìm thấy."),
  song_title: z.string().describe("Tên chính xác của bài hát."),
  artist: z.string().describe("Tên nghệ sĩ hoặc nhóm nhạc thể hiện."),
  lyrics: z.string().describe("Lời bài hát đầy đủ sạch sẽ, không bao gồm chú thích thừa."),
  thumbnail_url: z.string().url().optional().describe("URL hình ảnh ảnh bìa album hoặc nghệ sĩ nếu tìm được."), //nếu ko có thì fallback 1 ảnh mặc định nào đó
  search_reasoning: z.string().describe("Giải thích ngắn gọn tại sao AI chọn kết quả này.")
});
```

### Mẫu cấu hình AI với Grounding & Structured Output:
```javascript
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: "YOUR_API_KEY" });

const config = {
  tools: [{ googleSearch: {} }],
  responseMimeType: "application/json",
  responseJsonSchema: zodToJsonSchema(lyricsSchema),
};

async function findLyrics(snippet) {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite", // Hoặc gemini-2.5-flash
      contents: `Tìm thông tin bài hát và lời đầy đủ cho đoạn lyrics sau: "${snippet}"`,
      config,
    });
    
    // Parse kết quả JSON an toàn
    const songData = lyricsSchema.parse(JSON.parse(response.text));
    return songData;
}
```

## 4. Giao diện người dùng (UI/UX)
- Kết quả trả về qua **Discord Embed**:
    - **Thumbnail:** Hình ảnh liên quan đến bài hát (nếu tìm được URL image).
    - **Title:** [Tên bài hát] - [Nghệ sĩ].
    - **Description:** Lời bài hát (nếu quá dài (>2048 ký tự) thì cắt bớt và thêm link hoặc gửi file đính kèm/nhiều trang). Discord chỉ giới hạn 2000 ký tự thôi, cần 1 hàm xử lý riêng
    ví dụ

    ```javascript

    import { AttachmentBuilder } from "discord.js";
import fs from "fs";
import path from "path";

export async function sendSafeMessage(message, content) {
    if (!content) return;

    if (typeof content !== "string") {
        content = String(content);
    }

    if (content.length <= 2000) {
        await message.reply(content);
        return;
    }

    const filePath = path.join(process.cwd(), "long_message.md");
    fs.writeFileSync(filePath, content, "utf-8");

    const file = new AttachmentBuilder(filePath);
    await message.reply({
        content: "Tin nhắn quá dài, xem file 👉",
        files: [file],
    });

    fs.unlinkSync(filePath);
}```

    - **Footer:** Thông tin về bài hát (nếu tìm được).
    - **Color:** Màu sắc thương hiệu (ví dụ: xanh dương hoặc theo màu cover bài hát).

## 5. Kịch bản kiểm thử (Test Cases)
- **TC1:** Nhập đoạn lời bài hát nổi tiếng (ví dụ: "Sơn Tùng MTP chúng ta của sau này"). -> Kỳ vọng: Trả đúng bài "Chúng Ta Của Hiện Tại".
- **TC2:** Nhập đoạn lời bài hát sai chính tả nhẹ. -> Kỳ vọng: AI vẫn nhận diện đúng nhờ Google Search.
- **TC3:** Nhập đoạn lyrics không có thật hoặc vô nghĩa. -> Kỳ vọng: AI trả lời không tìm thấy.

## 6 Lưu ý
Bot con như Dolia không cần phải cài thư viện, nếu cần thì cài thư viện của bot cha "PS F:\X-FILE\Code_UNI\Node JS\bot discord\Welcome-lite> "