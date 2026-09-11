import antigravityKeyManager from '../class/antigravityKeyManager.js';
import Logger from '../class/Logger.js';
import geminiModelService from './geminiModelService.js';
import { loadAgentPrompt } from '../helpers/promptHelper.js';
import SkillHelper from '../helpers/skillHelper.js';
import { getAgentSession, updateAgentSession } from '../helpers/chatHelper.js';

export class AntigravityService {
    /**
     * Ủy quyền cho Antigravity Agent trên Google Cloud Sandbox phát triển và kiểm thử tính năng/game
     * @param {Object} options
     * @param {string} options.prompt - Yêu cầu tính năng từ người dùng
     * @param {string} options.featureName - Tên định danh (slug) của lệnh
     * @param {Function} [options.onProgress] - Callback cập nhật trạng thái tiến trình thực tế từ luồng SSE
     * @param {Object} [options.context] - Ngữ cảnh Discord { client, guild, channel, user, message }
     */
    static async developFeature({ prompt, featureName, onProgress = null, context = null }) {
        const safeSlug = (featureName || prompt.split(' ')[0])
            .toLowerCase()
            .trim()
            .replace(/đ/g, 'd')
            .replace(/[^a-z0-9_-]/g, '_')
            .replace(/_+/g, '_')
            .substring(0, 32);

        // Ưu tiên flash-lite cho Antigravity Cloud: nhanh hơn, quota rộng hơn, giữ render Discord mượt
        const activeModel = await geminiModelService.getActiveModel('flash-lite', 'agent');
        Logger.info(`[Antigravity] 🚀 Khởi chạy Antigravity Agent (Cloud Sandbox) với model: ${activeModel}...`);

        // Đọc prompt tùy biến từ config/prompt/agent/AgentInstruction.md và nhúng Skills chuẩn Google Custom Agents
        const baseInstruction = loadAgentPrompt('AgentInstruction.md', {
            '{{safeSlug}}': safeSlug
        });
        const systemInstruction = SkillHelper.enhanceInstructionWithSkills(baseInstruction, prompt);
        const promptInstruction = `${systemInstruction}\n\n[NHIỆM VỤ HIỆN TẠI]: Hãy thiết kế và lập trình tính năng mới sau: "${prompt}". Tên lệnh được chỉ định: "${safeSlug}". Trả về DUY NHẤT một JSON hợp lệ theo [CHẾ ĐỘ 2: SLASH COMMAND]!`;

        const sessionKey = context?.channel?.id ? `${context.guild?.id || 'dm'}_${context.channel.id}` : null;
        let dbSession = null;
        if (context?.user?.id && context?.channel?.id) {
            dbSession = await getAgentSession(context.user.id, context.channel.id);
        }

        return await antigravityKeyManager.execute(async (apiKey) => {
            const sessionEnv = antigravityKeyManager.getEnvironmentId(sessionKey) || dbSession;
            const skillSources = SkillHelper.getEnvironmentSources();

            let envParam = sessionEnv?.environmentId || "remote";
            let previousInteractionId = sessionEnv?.lastInteractionId || null;

            Logger.info(`[Antigravity] 🔍 Nạp Session kênh [${context?.channel?.id || 'unknown'}]: environmentId=${sessionEnv?.environmentId || 'null (sẽ tạo mới remote container)'}, previousInteractionId=${previousInteractionId || 'null'}`);

            if (!sessionEnv?.environmentId && skillSources.length > 0) {
                // Nhúng các file SKILL.md inline vào remote sandbox theo chuẩn Google Custom Agents
                envParam = {
                    type: "remote",
                    sources: skillSources
                };
                Logger.info(`[Antigravity] 📦 Đã nhúng ${skillSources.length} skills vào environment.sources (.agents/skills/): ${skillSources.map(s => s.target).join(', ')}`);
            } else if (sessionEnv?.environmentId) {
                Logger.info(`[Antigravity] ⚡ Tái sử dụng Warm Sandbox Container ID: ${sessionEnv.environmentId}${previousInteractionId ? ` (Chained Interaction: ${previousInteractionId})` : ''}`);
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse&key=${apiKey}`;
            const requestPayload = {
                agent: "antigravity-preview-05-2026",
                input: promptInstruction,
                environment: envParam,
                stream: true,
                agent_config: {
                    type: "antigravity",
                    model: activeModel
                },
                system_instruction: systemInstruction
            };

            if (previousInteractionId) {
                requestPayload.previous_interaction_id = previousInteractionId;
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestPayload)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const err = Array.isArray(errorData) ? errorData[0]?.error : errorData.error;
                const apiErr = new Error(err?.message || `HTTP ${response.status} ${response.statusText}`);
                apiErr.status = response.status;
                apiErr.error = err;

                // Nếu môi trường cũ đã hết hạn hoặc không tìm thấy, xóa cache để lần sau tạo mới
                if (sessionEnv?.environmentId && (response.status === 400 || response.status === 404)) {
                    antigravityKeyManager.clearEnvironmentId(sessionKey);
                    if (context?.user?.id && context?.channel?.id) {
                        updateAgentSession(context.user.id, context.channel.id, {
                            environmentId: null,
                            lastInteractionId: null
                        }).catch(() => {});
                    }
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

                        if (eventType === 'interaction.created' && eventObj.interaction) {
                            const newEnvId = eventObj.interaction.environment_id;
                            const newInteractionId = eventObj.interaction.id;
                            Logger.info(`[Antigravity] ☁️ Google Cloud Interaction Created: environmentId="${newEnvId || 'null'}", interactionId="${newInteractionId || 'null'}"`);
                            if (newEnvId) {
                                antigravityKeyManager.setEnvironmentId(newEnvId, sessionKey, newInteractionId);
                                if (context?.user?.id && context?.channel?.id) {
                                    updateAgentSession(context.user.id, context.channel.id, {
                                        environmentId: newEnvId,
                                        lastInteractionId: newInteractionId
                                    }).catch(() => {});
                                }
                            }
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
                            Logger.info(`[Antigravity] ✅ Google Cloud Interaction Completed: environmentId="${finalInteraction?.environment_id || 'null'}", interactionId="${finalInteraction?.id || 'null'}"`);
                            if (finalInteraction?.environment_id) {
                                antigravityKeyManager.setEnvironmentId(finalInteraction.environment_id, sessionKey, finalInteraction.id);
                                if (context?.user?.id && context?.channel?.id) {
                                    updateAgentSession(context.user.id, context.channel.id, {
                                        environmentId: finalInteraction.environment_id,
                                        lastInteractionId: finalInteraction.id
                                    }).catch(() => {});
                                }
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
                environmentId: antigravityKeyManager.getEnvironmentId(sessionKey)?.environmentId || null
            };
        }, { timeoutMs: 180000, maxRetries: 2 });
    }
}

export default AntigravityService;

