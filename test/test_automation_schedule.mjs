import test from 'node:test';
import assert from 'node:assert/strict';
import { nextScheduleAt, scheduleOccurrenceKey, shouldSkipMissedRun } from '../core/automation/schedule.js';

test('daily_at converts local Vietnam time to UTC and advances by local calendar day', () => {
    const rule = { ruleId: 'aut_daily', revision: 1, timezone: 'Asia/Ho_Chi_Minh', trigger: { type: 'daily_at', config: { time: '07:00' } } };
    assert.equal(nextScheduleAt(rule, new Date('2026-09-25T00:01:00Z')).toISOString(), '2026-09-25T24:00:00.000Z'.replace('25T24', '26T00'));
});

test('daily window slot is stable for the same rule and day', () => {
    const rule = { ruleId: 'aut_window', revision: 2, timezone: 'Asia/Ho_Chi_Minh', trigger: { type: 'daily_window', config: { start: '21:30', end: '23:30' } } };
    const from = new Date('2026-09-25T10:00:00Z');
    const first = nextScheduleAt(rule, from);
    const second = nextScheduleAt(rule, from);
    assert.equal(first.toISOString(), second.toISOString());
    assert.match(scheduleOccurrenceKey(rule, first), /^schedule:.*:r2$/);
});

test('window missed-run policy skips after local window has ended', () => {
    const rule = {
        timezone: 'Asia/Ho_Chi_Minh', schedule: { missedRunPolicy: 'skip' },
        trigger: { type: 'daily_window', config: { start: '21:30', end: '23:30' } }
    };
    assert.equal(shouldSkipMissedRun(rule, new Date('2026-09-25T15:00:00Z'), new Date('2026-09-25T17:30:00Z')), true);
});

test('grace policy runs only within configured grace', () => {
    const rule = { schedule: { missedRunPolicy: 'run_if_within_grace', graceMinutes: 30 }, trigger: { type: 'daily_at' } };
    const due = new Date('2026-09-25T00:00:00Z');
    assert.equal(shouldSkipMissedRun(rule, due, new Date('2026-09-25T00:20:00Z')), false);
    assert.equal(shouldSkipMissedRun(rule, due, new Date('2026-09-25T00:31:00Z')), true);
});
