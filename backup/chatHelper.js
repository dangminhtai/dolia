import Chat from '../models/Chat.js';
import User from '../models/User.js';

export async function getChatSession(userId, channelId) {
    try {
        let chatSession = await Chat.findOne({ userId, channelId });
        if (!chatSession) {
            chatSession = new Chat({ userId, channelId, turns: [] });
        }
        return chatSession;
    } catch (error) {
        console.error('Error getting chat session:', error);
        throw error;
    }
}

export async function getHistory(userId, chatSession) {
    try {
        const user = await User.findOne({ userId });
        const limit = user?.chatLimit || 20;

        if (!chatSession || !chatSession.turns || chatSession.turns.length === 0) return [];

        // 1. Get raw turns (Lấy dư ra một chút để có thể lọc bớt)
        const rawTurns = chatSession.turns.slice(-(limit + 6));

        // 2. Map & Clean Data (FIX CRITICAL: p.toObject crash)
        let history = rawTurns.map(turn => {
            if (!turn || !turn.parts) return null;

            const parts = turn.parts.map(p => {
                // [FIX 1] Kiểm tra p có tồn tại không trước khi gọi toObject
                if (!p) return null;

                // [FIX 2] Handle Mongoose Document safely
                const partData = (p && typeof p.toObject === 'function') ? p.toObject() : p;

                const cleanPart = {};
                if (partData.text) cleanPart.text = partData.text;
                if (partData.functionCall) cleanPart.functionCall = partData.functionCall;
                if (partData.functionResponse) cleanPart.functionResponse = partData.functionResponse;

                return Object.keys(cleanPart).length > 0 ? cleanPart : null;
            }).filter(p => p !== null);

            if (parts.length === 0) return null;

            return {
                role: turn.role,
                parts: parts
            };
        }).filter(t => t !== null);

        // 3. SANITIZE (FIX CRITICAL: Error 400 Dangling Function Call)
        // Nếu turn cuối cùng là Model và chứa FunctionCall, nghĩa là nó bị "treo".
        // Ta phải xóa nó đi vì turn tiếp theo sẽ là User Text (message mới).
        // Quy tắc Gemini: Model(Call) bắt buộc phải đi kèm User(Response).
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
        // [FIX CRITICAL] Nếu xóa Model đầu tiên, phải kiểm tra xem nó có để lại FunctionResponse mồ côi không.
        while (history.length > 0) {
            const firstTurn = history[0];

            if (firstTurn.role === 'model') {
                history.shift(); // Xóa Model đầu hàng
                continue;
            }

            if (firstTurn.role === 'user') {
                // Nếu User turn này là một FunctionResponse mồ côi (do Model Call vừa bị xóa hoặc bị slice mất) -> Xóa luôn.
                const isOrphanResponse = firstTurn.parts.some(p => p.functionResponse);
                if (isOrphanResponse) {
                    history.shift();
                    continue;
                }

                // Nếu là User text bình thường -> OK, dừng lại.
                break;
            }
        }

        return history;
    } catch (error) {
        console.error('Error in getHistory (Fixed):', error);
        return []; // Trả về mảng rỗng để reset context nếu lỗi quá nặng
    }
}

export async function saveInteraction(chatSession, newContents) {
    try {
        for (const content of newContents) {
            const dbParts = content.parts.map(p => {
                const part = {};
                if (p.text) part.text = p.text;
                if (p.functionCall) part.functionCall = p.functionCall;
                if (p.functionResponse) part.functionResponse = p.functionResponse;

                // Fallback for simple string parts
                if (!part.text && !part.functionCall && !part.functionResponse && typeof p === 'string') {
                    part.text = p;
                }
                return part;
            });

            chatSession.turns.push({
                role: content.role,
                parts: dbParts
            });
        }

        if (chatSession.turns.length > 50) {
            chatSession.turns = chatSession.turns.slice(-50);
        }

        await chatSession.save();
    } catch (error) {
        console.error('Failed to save interaction:', error);
    }
}

export async function saveLastInteractionId(chatSession, interactionId) {
    try {
        chatSession.lastInteractionId = interactionId;
        await chatSession.save();
    } catch (error) {
        console.error('Failed to save lastInteractionId:', error);
    }
}
