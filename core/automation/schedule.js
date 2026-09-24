import crypto from 'node:crypto';

function zonedParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date);
    return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function localToUtc(parts, timeZone) {
    let stamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
    for (let i = 0; i < 3; i++) {
        const actual = zonedParts(new Date(stamp), timeZone);
        const desiredUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
        const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second || 0);
        stamp += desiredUtc - actualUtc;
    }
    return new Date(stamp);
}

function addLocalDays(parts, days) {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

const parseTime = value => {
    const [hour, minute] = String(value).split(':').map(Number);
    return { hour, minute };
};

function deterministicMinute(ruleId, dateKey, range) {
    const digest = crypto.createHash('sha256').update(`${ruleId}:${dateKey}`).digest();
    return digest.readUInt32BE(0) % Math.max(1, range);
}

export function nextScheduleAt(rule, from = new Date()) {
    const { type, config = {} } = rule.trigger || {};
    const timeZone = rule.timezone || 'Asia/Ho_Chi_Minh';
    if (type === 'once') {
        const at = new Date(config.at);
        return at > from ? at : null;
    }
    const nowLocal = zonedParts(from, timeZone);
    let day = { year: nowLocal.year, month: nowLocal.month, day: nowLocal.day };
    if (type === 'daily_at') {
        const time = parseTime(config.time);
        let candidate = localToUtc({ ...day, ...time, second: 0 }, timeZone);
        if (candidate <= from) {
            day = addLocalDays(day, 1);
            candidate = localToUtc({ ...day, ...time, second: 0 }, timeZone);
        }
        return candidate;
    }
    if (type === 'daily_window') {
        const start = parseTime(config.start);
        const end = parseTime(config.end);
        const startMinutes = start.hour * 60 + start.minute;
        const endMinutes = end.hour * 60 + end.minute;
        if (endMinutes <= startMinutes) throw new Error('INVALID_WINDOW_ORDER');
        const build = currentDay => {
            const key = `${currentDay.year}-${currentDay.month}-${currentDay.day}`;
            const minute = startMinutes + deterministicMinute(rule.ruleId, key, endMinutes - startMinutes + 1);
            return localToUtc({ ...currentDay, hour: Math.floor(minute / 60), minute: minute % 60, second: 0 }, timeZone);
        };
        let candidate = build(day);
        const endToday = localToUtc({ ...day, ...end, second: 59 }, timeZone);
        if (from > endToday || candidate <= from) {
            day = addLocalDays(day, 1);
            candidate = build(day);
        }
        return candidate;
    }
    return null;
}

export function scheduleOccurrenceKey(rule, scheduledFor) {
    return `schedule:${new Date(scheduledFor).toISOString()}:r${rule.revision}`;
}

export function shouldSkipMissedRun(rule, scheduledFor, now = new Date()) {
    const policy = rule.schedule?.missedRunPolicy || 'skip';
    if (policy === 'run_once_on_recovery') return false;
    const lagMinutes = Math.max(0, (now.getTime() - new Date(scheduledFor).getTime()) / 60000);
    if (policy === 'run_if_within_grace') return lagMinutes > (rule.schedule?.graceMinutes ?? 60);
    if (rule.trigger?.type !== 'daily_window') return lagMinutes > Math.min(rule.schedule?.graceMinutes ?? 5, 5);
    const local = zonedParts(now, rule.timezone || 'Asia/Ho_Chi_Minh');
    const scheduledLocal = zonedParts(new Date(scheduledFor), rule.timezone || 'Asia/Ho_Chi_Minh');
    const end = parseTime(rule.trigger.config.end);
    const sameDay = local.year === scheduledLocal.year && local.month === scheduledLocal.month && local.day === scheduledLocal.day;
    return !sameDay || local.hour * 60 + local.minute > end.hour * 60 + end.minute;
}
