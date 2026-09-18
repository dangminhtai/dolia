export function isOwner(userId) {
    return Boolean(process.env.OWNER_ID && userId && userId === process.env.OWNER_ID);
}
