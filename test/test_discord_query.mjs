import assert from 'node:assert/strict';
import { discord_query } from '../utils/discordFunctions.js';

function member(name, bot = false, status = 'offline') {
    return {
        displayName: name,
        nickname: null,
        user: {
            username: name.toLowerCase(),
            globalName: name,
            bot,
            createdAt: new Date('2025-01-01T00:00:00Z'),
            displayAvatarURL: () => 'https://example.com/avatar.png'
        },
        joinedAt: new Date('2026-01-01T00:00:00Z'),
        roles: { cache: new Map() },
        presence: { status, activities: [] },
        voice: { channel: null, selfMute: false, selfDeaf: false, serverMute: false, serverDeaf: false },
        displayAvatarURL: () => 'https://example.com/avatar.png'
    };
}

const alice = member('Alice', false, 'online');
const bot = member('Dolia', true, 'online');
const members = new Map([['1', alice], ['2', bot]]);
const guild = {
    name: 'Test Guild',
    description: 'Demo',
    memberCount: 2,
    members: {
        cache: members,
        me: bot,
        fetch: async () => members
    },
    channels: { cache: new Map([['c1', {}]]) },
    roles: { cache: new Map([['r1', {}]]) },
    premiumSubscriptionCount: 0,
    premiumTier: 0,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    preferredLocale: 'vi'
};
const message = {
    member: alice,
    mentions: { members: new Map([['1', alice]]) }
};

const overview = await discord_query({ action: 'server_overview', guild, message });
assert.equal(overview.guild.total_members, 2);
assert.equal(overview.guild.humans, 1);
assert.equal(overview.guild.bots, 1);

const online = await discord_query({ action: 'online_members', guild, message });
assert.equal(online.count, 2);

const profile = await discord_query({ action: 'member_profile', target: 'u1', guild, message });
assert.equal(profile.profile.display_name, 'Alice');

const bad = await discord_query({ action: 'member_profile', target: 'u99', guild, message });
assert.equal(bad.code, 'TARGET_REQUIRED');

console.log('discord_query tests: PASS');
