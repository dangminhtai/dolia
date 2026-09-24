import { Type } from '@google/genai';

const triggerSchema = {
    type: Type.OBJECT,
    properties: {
        type: { type: Type.STRING, enum: ['messageCreate', 'guildMemberAdd', 'autoModerationActionExecution', 'daily_at', 'daily_window', 'once'] },
        config: {
            type: Type.OBJECT,
            properties: {
                time: { type: Type.STRING, description: 'Giờ HH:mm cho daily_at.' },
                start: { type: Type.STRING, description: 'Giờ bắt đầu HH:mm cho daily_window.' },
                end: { type: Type.STRING, description: 'Giờ kết thúc HH:mm cho daily_window.' },
                at: { type: Type.STRING, description: 'Thời điểm ISO cho once.' }
            }
        }
    },
    required: ['type']
};

const conditionSchema = {
    type: Type.OBJECT,
    properties: {
        kind: { type: Type.STRING, enum: ['author_is', 'channel_is', 'contains', 'member_not_bot', 'member_not_welcomed', 'spam_threshold'] },
        userId: { type: Type.STRING }, channelId: { type: Type.STRING }, text: { type: Type.STRING },
        count: { type: Type.NUMBER }, windowSeconds: { type: Type.NUMBER }
    },
    required: ['kind']
};

const stepSchema = {
    type: Type.OBJECT,
    properties: {
        kind: { type: Type.STRING, enum: ['react', 'send_message', 'send_dm', 'warn', 'timeout', 'kick', 'research_web', 'filter', 'branch', 'delay_until', 'update_state'] },
        emoji: { type: Type.STRING }, content: { type: Type.STRING }, template: { type: Type.STRING },
        channelId: { type: Type.STRING }, userId: { type: Type.STRING }, includeBots: { type: Type.BOOLEAN },
        durationMinutes: { type: Type.NUMBER }, query: { type: Type.STRING }, lookbackHours: { type: Type.NUMBER },
        maxSources: { type: Type.NUMBER }, at: { type: Type.STRING }, delaySeconds: { type: Type.NUMBER }
        ,field: { type: Type.STRING, enum: ['event.type', 'event.actorId', 'event.subjectId', 'event.channelId'] },
        operator: { type: Type.STRING, enum: ['equals', 'not_equals', 'includes'] }, value: { type: Type.STRING },
        skipIfTrue: { type: Type.NUMBER }, skipIfFalse: { type: Type.NUMBER }, key: { type: Type.STRING }
    },
    required: ['kind']
};

const specSchema = {
    type: Type.OBJECT,
    properties: {
        name: { type: Type.STRING }, description: { type: Type.STRING },
        type: { type: Type.STRING, enum: ['configured', 'workflow', 'generated'] },
        trigger: triggerSchema,
        conditions: { type: Type.ARRAY, items: conditionSchema },
        steps: { type: Type.ARRAY, items: stepSchema },
        channelId: { type: Type.STRING }, timezone: { type: Type.STRING },
        schedule: {
            type: Type.OBJECT,
            properties: {
                missedRunPolicy: { type: Type.STRING, enum: ['skip', 'run_if_within_grace', 'run_once_on_recovery'] },
                graceMinutes: { type: Type.NUMBER }
            }
        },
        limits: {
            type: Type.OBJECT,
            properties: { maxRuns: { type: Type.NUMBER }, cooldownSeconds: { type: Type.NUMBER } }
        },
        retryPolicy: {
            type: Type.OBJECT,
            properties: { maxAttempts: { type: Type.NUMBER }, backoffMs: { type: Type.NUMBER } }
        }
    }
};

export const automationTools = [
    {
        name: 'automation_query',
        description: 'Xem rule automation và lịch sử thực thi mà người đang nói được phép quản lý. preview chỉ kiểm tra spec, không tạo rule.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                action: { type: Type.STRING, enum: ['list', 'get', 'history', 'preview'] },
                rule_id: { type: Type.STRING }, limit: { type: Type.NUMBER },
                scope: { type: Type.STRING, enum: ['personal', 'channel', 'guild'] }, spec: specSchema
            },
            required: ['action']
        }
    },
    {
        name: 'automation_action',
        description: 'Tạo hoặc quản lý automation khi người dùng trực tiếp yêu cầu trong lượt hiện tại. Rule mới luôn ở trạng thái tắt; phải có yêu cầu bật riêng. Không dùng agent_code để thay thế automation.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                action: { type: Type.STRING, enum: ['draft', 'create', 'update', 'enable', 'disable', 'delete', 'run_once'] },
                rule_id: { type: Type.STRING }, spec: specSchema
            },
            required: ['action']
        }
    }
];
