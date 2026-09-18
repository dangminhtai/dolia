export function isOwner(userId) {
    if (!userId) return false;
    const raw = process.env.OWNER_ID || process.env.OWNER_IDS || '';
    const owners = raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    return owners.includes(String(userId));
}
