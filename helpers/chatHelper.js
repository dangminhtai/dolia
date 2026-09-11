import Chat from '../models/Chat.js';
import User from '../models/User.js';

export async function getChatSession(channelId, userId = null) {
    try {
        // 1. Tìm session chung của channel (ưu tiên channel_shared, sau đó đến session bất kỳ của channel)
        let chatSession = await Chat.findOne({ channelId, userId: 'channel_shared' });
        if (!chatSession && userId) {
            chatSession = await Chat.findOne({ channelId, userId });
        }
        if (!chatSession) {
            chatSession = await Chat.findOne({ channelId });
        }
        if (!chatSession) {
            chatSession = new Chat({ userId: 'channel_shared', channelId, turns: [] });
        }
        return chatSession;
    } catch (error) {
        console.error('Error getting chat session:', error);
        throw error;
    }
}

export async function getHistory(userId, chatSession) {
    try {
        const user = userId ? await User.findOne({ userId }) : null;
        const limit = user?.chatLimit || 25;

        if (!chatSession || !chatSession.turns || chatSession.turns.length === 0) return [];

        // 1. Get raw turns (Lấy dư ra một chút để có thể lọc bớt)
        const rawTurns = chatSession.turns.slice(-(limit + 6));

        // 2. Map & Clean Data (Định dạng Speaker Prefix [DisplayName]: text chuẩn Google AI Studio)
        let history = rawTurns.map(turn => {
            if (!turn || !turn.parts) return null;

            const parts = turn.parts.map(p => {
                if (!p) return null;
                const partData = (p && typeof p.toObject === 'function') ? p.toObject() : p;

                const cleanPart = {};
                if (partData.text) {
                    let text = partData.text;
                    // Chuẩn hóa định danh người nói nếu chưa có prefix [Name]
                    if (turn.role === 'user' && turn.authorName && !text.startsWith('[')) {
                        text = `[${turn.authorName}]: ${text}`;
                    }
                    cleanPart.text = text;
                }
                if (partData.functionCall) cleanPart.functionCall = partData.functionCall;
                if (partData.functionResponse) cleanPart.functionResponse = partData.functionResponse;
                if (partData.thoughtSignature) cleanPart.thoughtSignature = partData.thoughtSignature;
                if (partData.thought !== undefined) cleanPart.thought = partData.thought;

                return Object.keys(cleanPart).length > 0 ? cleanPart : null;
            }).filter(p => p !== null);

            if (parts.length === 0) return null;

            return {
                role: turn.role,
                parts: parts
            };
        }).filter(t => t !== null);

        // 3. SANITIZE (FIX CRITICAL: Error 400 Dangling Function Call)
        if (history.length > 0) {
            const lastTurn = history[history.length - 1];
            const isModel = lastTurn.role === 'model';
            const hasCall = lastTurn.parts.some(p => p.functionCall);

            if (isModel && hasCall) {
                console.warn('⚠️ Found dangling FunctionCall at end of history. Removing to fix Error 400.');
                history.pop();
            }
        }

        // 4. Ensure starts with User (Clean context)
        while (history.length > 0) {
            const firstTurn = history[0];

            if (firstTurn.role === 'model') {
                history.shift(); // Xóa Model đầu hàng
                continue;
            }

            if (firstTurn.role === 'user') {
                const isOrphanResponse = firstTurn.parts.some(p => p.functionResponse);
                if (isOrphanResponse) {
                    history.shift();
                    continue;
                }
                break;
            }
        }

        return history;
    } catch (error) {
        console.error('Error in getHistory (Fixed):', error);
        return [];
    }
}

export async function saveInteraction(chatSession, newContents, authorInfo = null) {
    try {
        for (const content of newContents) {
            const dbParts = content.parts.map(p => {
                const part = {};
                if (p.text) part.text = p.text;
                if (p.functionCall) part.functionCall = p.functionCall;
                if (p.functionResponse) part.functionResponse = p.functionResponse;
                if (p.thoughtSignature) part.thoughtSignature = p.thoughtSignature;
                if (p.thought !== undefined) part.thought = p.thought;

                if (!part.text && !part.functionCall && !part.functionResponse && typeof p === 'string') {
                    part.text = p;
                }
                return part;
            });

            const authorId = content.role === 'user' ? (content.authorId || authorInfo?.id || null) : null;
            const authorName = content.role === 'user' ? (content.authorName || authorInfo?.name || null) : null;

            chatSession.turns.push({
                role: content.role,
                parts: dbParts,
                authorId,
                authorName
            });
        }

        // Limit history size in DB (Lưu 60 lượt hội thoại gần nhất cho phòng chat nhóm)
        if (chatSession.turns.length > 60) {
            chatSession.turns = chatSession.turns.slice(-60);
        }

        await chatSession.save();
    } catch (error) {
        console.error('Failed to save interaction:', error);
    }
}

/**
 * Lấy thông tin Agent Session (environmentId, lastInteractionId, lastScript) theo channel
 */
export async function getAgentSession(userId, channelId) {
    try {
        const session = await Chat.findOne({ channelId, userId: 'channel_shared' }).select('agentSession')
            || await Chat.findOne({ channelId }).select('agentSession');
        return session?.agentSession || null;
    } catch (error) {
        console.error('Error getting agent session:', error);
        return null;
    }
}

/**
 * Cập nhật Agent Session (environmentId, lastInteractionId, lastScript, workspacePath) theo channel
 */
export async function updateAgentSession(userId, channelId, updates = {}) {
    try {
        const chatSession = await getChatSession(channelId, userId);
        if (!chatSession.agentSession) {
            chatSession.agentSession = {};
        }

        if (updates.environmentId !== undefined) chatSession.agentSession.environmentId = updates.environmentId;
        if (updates.lastInteractionId !== undefined) chatSession.agentSession.lastInteractionId = updates.lastInteractionId;
        if (updates.workspacePath !== undefined) chatSession.agentSession.workspacePath = updates.workspacePath;
        if (updates.lastScript) {
            chatSession.agentSession.lastScript = {
                name: updates.lastScript.name || 'script.js',
                code: updates.lastScript.code,
                prompt: updates.lastScript.prompt,
                createdAt: new Date()
            };
        }
        chatSession.agentSession.updatedAt = new Date();

        await chatSession.save();
        return chatSession.agentSession;
    } catch (error) {
        console.error('Failed to update agent session:', error);
        return null;
    }
}