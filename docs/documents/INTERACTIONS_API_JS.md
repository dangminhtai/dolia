# Hướng dẫn Sử dụng Interactions API với JavaScript

Interactions API ([Beta](https://ai.google.dev/gemini-api/docs/api-versions)) là một giao diện thống nhất để tương tác với các mô hình Gemini và các tác nhân (agents). Nó đơn giản hóa việc quản lý trạng thái, điều phối công cụ và các tác vụ chạy lâu dài.

Tài liệu này tổng hợp cách sử dụng Interactions API bằng JavaScript (Node.js) với SDK `@google/genai`.

## 1. Cài đặt

Bạn cần cài đặt gói `@google/genai` (phiên bản `1.33.0` trở lên):

```bash
npm install @google/genai
```

## 2. Khởi tạo Client

Bạn cần tạo file `.env` và thêm key của bạn vào:
```env
GEMINI_API_KEY=your_api_key_here
```

Sau đó khởi tạo client trong code:

```javascript
import { GoogleGenAI } from '@google/genai';

// Đảm bảo bạn đã thiết lập biến môi trường GEMINI_API_KEY
const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
```

## 3. Tương tác Cơ bản (Text Input)

Cách đơn giản nhất để tương tác là gửi một prompt văn bản.

```javascript
const interaction = await client.interactions.create({
    model: 'gemini-3-flash-preview',
    input: 'Tell me a short joke about programming.',
});

console.log(interaction.outputs[interaction.outputs.length - 1].text);
```

## 4. Hội thoại (Conversation)

### Có trạng thái (Stateful) - Khuyên dùng

Bạn có thể tiếp tục hội thoại bằng cách sử dụng `interaction.id` từ lượt trước. Server sẽ tự nhớ lịch sử.

```javascript
// Lượt 1
const interaction1 = await client.interactions.create({
    model: 'gemini-3-flash-preview',
    input: 'Hi, my name is Phil.'
});
console.log(`Model: ${interaction1.outputs[interaction1.outputs.length - 1].text}`);

// Lượt 2 - Truyền previous_interaction_id
const interaction2 = await client.interactions.create({
    model: 'gemini-3-flash-preview',
    input: 'What is my name?',
    previous_interaction_id: interaction1.id
});
console.log(`Model: ${interaction2.outputs[interaction2.outputs.length - 1].text}`);
```

### Không trạng thái (Stateless)

Bạn tự quản lý lịch sử hội thoại ở phía client.

```javascript
const conversationHistory = [
    { role: 'user', content: "What are the three largest cities in Spain?" }
];

const interaction1 = await client.interactions.create({
    model: 'gemini-3-flash-preview',
    input: conversationHistory
});

// Thêm phản hồi của model vào lịch sử
conversationHistory.push({ role: 'model', content: interaction1.outputs });
conversationHistory.push({ role: 'user', content: "What is the most famous landmark in the second one?" });

const interaction2 = await client.interactions.create({
    model: 'gemini-3-flash-preview',
    input: conversationHistory
});
```

## 5. Khả năng Đa phương thức (Multimodal)

### Hiểu Hình ảnh / Âm thanh / Video / PDF

Bạn có thể gửi dữ liệu đa phương thức thông qua liên kết công khai (URL) hoặc sử dụng Gemini Files API.

**Ví dụ với Video (URL công khai):**

```javascript
const interaction = await client.interactions.create({
    model: 'gemini-3-flash-preview',
    input: [
        { type: 'text', text: 'What is happening in this video?' },
        {
            type: 'video',
            uri: 'https://storage.googleapis.com/generativeai-downloads/images/Sherlock_Jr_1924.mp4', // Ví dụ
            mime_type: 'video/mp4'
        }
    ]
});
console.log(interaction.outputs[interaction.outputs.length - 1].text);
```

### Tạo Hình ảnh (Image Generation)

Sử dụng model `gemini-3-pro-image-preview`.

```javascript
import * as fs from 'fs';

const interaction = await client.interactions.create({
    model: 'gemini-3-pro-image-preview',
    input: 'Generate an image of a futuristic city.',
    response_modalities: ['IMAGE'],
    generation_config: {
        image_config: {
            aspect_ratio: '16:9',
            image_size: '2k'
        }
    }
});

for (const output of interaction.outputs) {
    if (output.type === 'image') {
        fs.writeFileSync('generated_city.png', Buffer.from(output.data, 'base64'));
        console.log('Image saved to generated_city.png');
    }
}
```

### Tạo Giọng nói (Speech Generation)

Sử dụng model `gemini-2.5-flash-preview-tts`.

```javascript
import * as fs from 'fs';

const interaction = await client.interactions.create({
    model: 'gemini-2.5-flash-preview-tts',
    input: 'Say the following: WOOHOO This is so much fun!',
    response_modalities: ['AUDIO'],
    generation_config: {
        speech_config: {
            language: "en-us",
            voice: "kore" // Voice options: kore, zephyr, puck, etc.
        }
    }
});

for (const output of interaction.outputs) {
    if (output.type === 'audio') {
        fs.writeFileSync('generated_audio.wav', Buffer.from(output.data, 'base64')); // Lưu ý: Output thường là PCM, có thể cần convert sang WAV
    }
}
```

## 6. Gọi Hàm (Function Calling)

Bạn có thể định nghĩa công cụ (tools) để model gọi.

```javascript
// 1. Định nghĩa công cụ
const weatherTool = {
    type: 'function',
    name: 'get_weather',
    description: 'Gets the weather for a given location.',
    parameters: {
        type: 'object',
        properties: {
            location: { type: 'string', description: 'The city and state, e.g. San Francisco, CA' }
        },
        required: ['location']
    }
};

// 2. Gửi request kèm tools
let interaction = await client.interactions.create({
    model: 'gemini-3-flash-preview',
    input: 'What is the weather in Paris?',
    tools: [weatherTool]
});

// 3. Xử lý khi model gọi hàm
for (const output of interaction.outputs) {
    if (output.type === 'function_call') {
        console.log(`Tool Call: ${output.name}(${JSON.stringify(output.arguments)})`);

        // Giả lập thực thi hàm
        const result = `The weather in ${output.arguments.location} is sunny.`;

        // 4. Gửi kết quả lại cho model
        interaction = await client.interactions.create({
            model: 'gemini-3-flash-preview',
            previous_interaction_id: interaction.id,
            input: [{
                type: 'function_result',
                name: output.name,
                call_id: output.id,
                result: result
            }]
        });
        console.log(`Response: ${interaction.outputs[interaction.outputs.length - 1].text}`);
    }
}
```

## 7. Các Công cụ Tích hợp sẵn (Built-in Tools)

Gemini có sẵn một số công cụ mạnh mẽ:

*   `google_search`: Tìm kiếm Google (Grounding).
*   `code_execution`: Chạy code Python.
*   `url_context`: Đọc nội dung từ URL.
*   `computer_use`: Điều khiển máy tính (Beta).

**Ví dụ Google Search:**

```javascript
const interaction = await client.interactions.create({
    model: 'gemini-3-flash-preview',
    input: 'Who won the last Super Bowl?',
    tools: [{ type: 'google_search' }]
});

const textOutput = interaction.outputs.find(o => o.type === 'text');
if (textOutput) console.log(textOutput.text);
```

## 8. Output có Cấu trúc (Structured Output - JSON)

Bạn có thể ép buộc model trả về JSON theo schema nhất định.

```javascript
import { z } from 'zod'; // Cần cài đặt zod: npm install zod

const moderationSchema = z.object({
    decision: z.object({
        reason: z.string(),
        spam_type: z.enum(['phishing', 'scam', 'unsolicited promotion', 'other', 'none']),
        is_safe: z.boolean()
    })
});

const interaction = await client.interactions.create({
    model: 'gemini-3-flash-preview',
    input: "Evaluate this email: 'Click here to claim your prize!'",
    response_format: z.toJSONSchema(moderationSchema),
});

console.log(interaction.outputs[0].text); // Kết quả sẽ là chuỗi JSON hợp lệ
```

## 9. Streaming (Nhận phản hồi liên tục)

```javascript
const stream = await client.interactions.create({
    model: 'gemini-3-flash-preview',
    input: 'Explain quantum entanglement in simple terms.',
    stream: true,
});

for await (const chunk of stream) {
    if (chunk.event_type === 'content.delta') {
        if (chunk.delta.type === 'text') {
            process.stdout.write(chunk.delta.text);
        } else if (chunk.delta.type === 'thought') {
            // Hiển thị suy nghĩ của model (Thinking block)
            process.stdout.write(`[Thinking] ${chunk.delta.thought}`);
        }
    }
}
```

## 10. Agent "Deep Research"

Sử dụng agent chuyên dụng để nghiên cứu sâu.

```javascript
const initialInteraction = await client.interactions.create({
    input: 'Research the history of the Google TPUs with a focus on 2025 and 2026.',
    agent: 'deep-research-pro-preview-12-2025',
    background: true // Chạy nền
});

console.log(`Research started. ID: ${initialInteraction.id}`);

// Polling kết quả
while (true) {
    const interaction = await client.interactions.get(initialInteraction.id);
    if (interaction.status === 'completed') {
        console.log('\nFinal Report:\n', interaction.outputs[interaction.outputs.length - 1].text);
        break;
    }
    await new Promise(r => setTimeout(r, 10000)); // Đợi 10s rồi check lại
}
```

## Lưu ý Quan trọng

*   **Lưu trữ**: Mặc định `store=true`. Dữ liệu được giữ 55 ngày (trả phí) hoặc 1 ngày (miễn phí).
*   **State Management**: Khi dùng `previous_interaction_id`, chỉ có lịch sử chat được nhớ. Các tham số như `tools`, `system_instruction` cần được khai báo lại nếu muốn dùng tiếp cho lượt mới.
*   **Mô hình**: Nên sử dụng các model `gemini-3-flash-preview` hoặc `gemini-3-pro-preview` để có hiệu năng tốt nhất với Interactions API.
