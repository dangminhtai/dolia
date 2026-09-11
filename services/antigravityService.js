import antigravityKeyManager from '../class/antigravityKeyManager.js';
import Logger from '../class/Logger.js';
import geminiModelService from './geminiModelService.js';
import { loadAgentPrompt } from '../helpers/promptHelper.js';

export class AntigravityService {
    /**
     * Ủy quyền cho Antigravity Agent trên Google Cloud Sandbox phát triển và kiểm thử tính năng/game
     * @param {Object} options
     * @param {string} options.prompt - Yêu cầu tính năng từ người dùng
     * @param {string} options.featureName - Tên định danh (slug) của lệnh
     * @param {Function} [options.onProgress] - Callback cập nhật trạng thái tiến trình thực tế từ luồng SSE
     */
    static async developFeature({ prompt, featureName, onProgress = null }) {
        const safeSlug = (featureName || prompt.split(' ')[0])
            .toLowerCase()
            .trim()
            .replace(/đ/g, 'd')
            .replace(/[^a-z0-9_-]/g, '_')
            .replace(/_+/g, '_')
            .substring(0, 32);

        // Ưu tiên flash-lite cho Antigravity Cloud: nhanh hơn, quota rộng hơn, giữ render Discord mượt
        const activeModel = await geminiModelService.getActiveModel('flash-lite');
        Logger.info(`[Antigravity] 🚀 Khởi chạy Antigravity Agent (Cloud Sandbox) với model: ${activeModel}...`);

        // Đọc prompt tùy biến từ config/prompt/agent/AgentInstruction.md
        const systemInstruction = loadAgentPrompt('AgentInstruction.md', {
            '{{safeSlug}}': safeSlug
        });
        const promptInstruction = `${systemInstruction}\n\n[NHIỆM VỤ HIỆN TẠI]: Hãy thiết kế và lập trình tính năng mới sau: "${prompt}". Tên lệnh được chỉ định: "${safeSlug}". Trả về DUY NHẤT một JSON hợp lệ theo [CHẾ ĐỘ 2: SLASH COMMAND]!`;

        return await antigravityKeyManager.execute(async (apiKey) => {
            const cachedEnv = antigravityKeyManager.getEnvironmentId();
            const envParam = cachedEnv || "remote";
            if (cachedEnv) {
                Logger.info(`[Antigravity] ⚡ Tái sử dụng Warm Sandbox Container ID: ${cachedEnv}`);
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse&key=${apiKey}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agent: "antigravity-preview-05-2026",
                    input: promptInstruction,
                    environment: envParam,
                    stream: true,
                    agent_config: {
                        type: "antigravity",
                        model: activeModel
                    },
                    system_instruction: systemInstruction
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const err = Array.isArray(errorData) ? errorData[0]?.error : errorData.error;
                const apiErr = new Error(err?.message || `HTTP ${response.status} ${response.statusText}`);
                apiErr.status = response.status;
                apiErr.error = err;

                // Nếu môi trường cũ đã hết hạn hoặc không tìm thấy, xóa cache để lần sau tạo mới
                if (cachedEnv && (response.status === 400 || response.status === 404)) {
                    antigravityKeyManager.clearEnvironmentId();
                }

                throw apiErr;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let rawText = '';
            let finalInteraction = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line.startsWith('data:')) continue;
                    const jsonStr = line.replace(/^data:\s*/, '').trim();
                    if (!jsonStr) continue;

                    try {
                        const eventObj = JSON.parse(jsonStr);
                        const eventType = eventObj.event_type;

                        if (eventType === 'interaction.created' && eventObj.interaction?.environment_id) {
                            antigravityKeyManager.setEnvironmentId(eventObj.interaction.environment_id);
                            if (typeof onProgress === 'function') {
                                onProgress({ stage: 'connected', text: '☁️ Dolia đã kết nối không gian đám mây thành công!', event: eventType });
                            }
                        } else if (eventType === 'step.start') {
                            const stepType = eventObj.step?.type;
                            const stepName = eventObj.step?.name || '';
                            if (stepType === 'thought') {
                                if (typeof onProgress === 'function') {
                                    onProgress({ stage: 'thinking', text: '💭 Dolia đang phân tích và thiết kế luật chơi cho bạn...', event: eventType, stepType });
                                }
                            } else if (stepType === 'code_execution_call') {
                                if (typeof onProgress === 'function') {
                                    onProgress({ stage: 'coding', text: '✍️ Dolia đang viết mã lệnh và kiểm thử trên đám mây...', event: eventType, stepType });
                                }
                            } else if (stepType === 'function_call') {
                                const toolLabel = stepName === 'write_file' ? 'lưu file' : stepName === 'google_search' ? 'tìm kiếm Google' : stepName === 'url_context' ? 'đọc tài liệu' : 'gọi công cụ';
                                if (typeof onProgress === 'function') {
                                    onProgress({ stage: 'tool_call', text: `🔧 Dolia đang ${toolLabel} trên đám mây...`, event: eventType, stepType, toolName: stepName });
                                }
                            } else if (stepType === 'model_output') {
                                if (typeof onProgress === 'function') {
                                    onProgress({ stage: 'output', text: '✨ Gần xong rồi nè, mình đang đóng gói kết quả cho bạn! 💖', event: eventType, stepType });
                                }
                            } else if (typeof onProgress === 'function') {
                                onProgress({ stage: 'step', text: `⚙️ Dolia đang xử lý bước: ${stepType || 'unknown'}...`, event: eventType, stepType });
                            }
                        } else if (eventType === 'step.end') {
                            const stepType = eventObj.step?.type;
                            if (stepType === 'code_execution_call') {
                                if (typeof onProgress === 'function') {
                                    onProgress({ stage: 'code_done', text: '✅ Mã lệnh đã kiểm thử xong trên đám mây!', event: eventType, stepType });
                                }
                            }
                        } else if (eventType === 'step.delta') {
                            if (eventObj.delta?.text) {
                                rawText += eventObj.delta.text;
                            }
                        } else if (eventType === 'interaction.completed') {
                            finalInteraction = eventObj.interaction;
                            if (finalInteraction?.environment_id) {
                                antigravityKeyManager.setEnvironmentId(finalInteraction.environment_id);
                            }
                            if (typeof onProgress === 'function') {
                                onProgress({ stage: 'completed', text: '🎉 Antigravity Cloud đã hoàn tất!', event: eventType });
                            }
                        } else if (eventType === 'interaction.failed') {
                            Logger.error(`[Antigravity] ❌ Interaction failed: ${JSON.stringify(eventObj.error || eventObj)}`);
                            if (typeof onProgress === 'function') {
                                onProgress({ stage: 'failed', text: '❌ Đám mây gặp sự cố...', event: eventType });
                            }
                        }
                    } catch (_) { }
                }
            }

            Logger.info(`[Antigravity] ✅ Antigravity Cloud stream hoàn tất.`);

            // Trích xuất output hoàn chỉnh từ finalInteraction nếu có
            if (finalInteraction && Array.isArray(finalInteraction.steps)) {
                const modelOutputStep = [...finalInteraction.steps].reverse().find(s => s.type === 'model_output');
                if (modelOutputStep?.content) {
                    const extracted = modelOutputStep.content.map(c => c.text || '').join('\n');
                    if (extracted.length > rawText.length) {
                        rawText = extracted;
                    }
                }
                if (!rawText) {
                    const writeStep = finalInteraction.steps.find(s => s.type === 'function_call' && s.name === 'write_file');
                    if (writeStep?.arguments?.content) {
                        rawText = writeStep.arguments.content;
                    }
                }
            }

            // Trích xuất JSON
            let parsedData = null;
            try {
                parsedData = JSON.parse(rawText);
            } catch (_) {
                const match = rawText.match(/```(?:json)?([\s\S]*?)```/);
                if (match) {
                    parsedData = JSON.parse(match[1].trim());
                } else {
                    const jsonMatch = rawText.match(/\{[\s\S]*"command_name"[\s\S]*\}/);
                    if (jsonMatch) {
                        parsedData = JSON.parse(jsonMatch[0].trim());
                    }
                }
            }

            if (!parsedData || !parsedData.files || !Array.isArray(parsedData.files) || parsedData.files.length === 0) {
                throw new Error("Dữ liệu trả về từ Antigravity Agent không chứa cấu trúc files hợp lệ.");
            }

            return {
                success: true,
                data: parsedData,
                usedModel: activeModel,
                usedAgent: 'antigravity-preview-05-2026',
                environmentId: antigravityKeyManager.getEnvironmentId()
            };
        }, { timeoutMs: 180000, maxRetries: 2 });
    }
}

export default AntigravityService;

