import { GoogleGenAI, Type } from "@google/genai";
import { RATE_LIMITS } from "../config/rateLimits.js";

export class Gemini {
    constructor(apiKey, systemInstruction, modelId = 'gemini-3-flash-preview') {
        this.ai = new GoogleGenAI({ apiKey });
        this.systemInstruction = systemInstruction;

        if (!RATE_LIMITS[modelId]) {
            console.warn(`⚠️ Model '${modelId}' not found in RATE_LIMITS config. Using default.`);
        }
        this.modelId = modelId;
    }

    createChat(history = []) {
        const config = {
            temperature: 1.7,
            topK: 60,
            topP: 0.97,
            systemInstruction: this.systemInstruction
        };

        const effectiveHistory = JSON.parse(JSON.stringify(history));

        return this.ai.chats.create({
            model: this.modelId,
            history: effectiveHistory,
            config: config,
        });
    }

    async sendMessage(chat, userContent) {
        const res = await chat.sendMessage({
            message: { parts: [{ text: userContent }] }
        });
        try {
            return res.text;
        } catch (e) {
            console.error("Error sending message:", e);
            return null;
        }
    }
}
