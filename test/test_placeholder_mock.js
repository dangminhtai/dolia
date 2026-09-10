import { formatString } from '../helpers/placeHolder.js';

// Mock User
const mockUser = {
    id: '123456789012345678',
    username: 'TestUser',
    globalName: 'Test Global Name',
    tag: 'TestUser#1234',
    displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/123/abc.png',
    createdAt: new Date('2023-01-01T00:00:00.000Z'),
};

// Mock Member
const mockMember = {
    displayName: 'Test Nickname',
    joinedAt: new Date('2023-06-01T00:00:00.000Z'),
};

// Mock Guild
const mockGuild = {
    id: '987654321098765432',
    name: 'Test Server',
    memberCount: 150,
    ownerId: '111111111111111111',
    iconURL: () => 'https://cdn.discordapp.com/icons/987/xyz.png',
};

// Mock Channel
const mockChannel = {
    id: '555555555555555555',
    name: 'general',
    topic: 'General chat',
};

// Mock Client
const mockClient = {
    user: {
        id: '999999999999999999',
        username: 'TestBot',
        displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/999/bot.png',
    },
    ws: { ping: 25 },
};

// Mock Context (Message)
const mockContext = {
    author: mockUser,
    member: mockMember,
    guild: mockGuild,
    channel: mockChannel,
    client: mockClient,
};

// Test Cases
const tests = [
    { template: 'Hello {{user}}!', expected: 'Hello <@123456789012345678>!' },
    { template: 'Welcome to {{server_name}}', expected: 'Welcome to Test Server' },
    { template: 'User: {{user_name}} ({{user_id}})', expected: 'User: TestUser (123456789012345678)' },
    { template: 'Nickname: {{nickname}}', expected: 'Nickname: Test Nickname' },
    { template: 'Joined: {{user_joined_at}}', check: (res) => res.includes('01/06/2023') },
    { template: 'Bot: {{bot_name}} | Ping: {{bot_ping}}', expected: 'Bot: TestBot | Ping: 25ms' },
    { template: 'Channel: {{channel_mention}}', expected: 'Channel: <#555555555555555555>' },
    { template: 'Case Insensitive: {{USER_NAME}}', expected: 'Case Insensitive: TestUser' },
    { template: 'Spacing: {{  server_name  }}', expected: 'Spacing: Test Server' },
    { template: 'Missing: {{invalid_placeholder}}', expected: 'Missing: {{invalid_placeholder}}' },
];

console.log('--- Starting Placeholder Tests ---');
let passed = 0;
let failed = 0;

tests.forEach((test, index) => {
    const result = formatString(test.template, mockContext);
    let isPass = false;

    if (test.expected) {
        // Simple equality check
        isPass = result === test.expected;
    } else if (test.check) {
        // Custom check function logic
        isPass = test.check(result);
    }

    if (isPass) {
        console.log(`[PASS] Test ${index + 1}: "${test.template}" -> "${result}"`);
        passed++;
    } else {
        console.log(`[FAIL] Test ${index + 1}: "${test.template}"`);
        console.log(`   Expected: "${test.expected}"`);
        console.log(`   Actual:   "${result}"`);
        failed++;
    }
});

console.log('--- Test Summary ---');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

// Test fallback (DM context - no guild/member)
const dmContext = {
    author: mockUser,
    channel: { type: 1, id: '123' },
    client: mockClient,
};
const dmResult = formatString('Server: {{server_name}}', dmContext);
console.log(`[DM Check] Server: {{server_name}} -> "${dmResult}" (Expected: "DM" or handled gracefully)`);
