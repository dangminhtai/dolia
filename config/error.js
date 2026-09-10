export const ERROR_CODES = {
    400: [
        { status: 'INVALID_ARGUMENT', action: 'CHECK_REQUEST', message: 'Request malformed/missing fields.' },
        { status: 'FAILED_PRECONDITION', action: 'BILLING_REQUIRED', message: 'Free tier not available/Billing required.' }
    ],
    403: [
        { status: 'PERMISSION_DENIED', action: 'CHECK_KEY', message: 'Invalid API key or permissions.' }
    ],
    404: [
        { status: 'NOT_FOUND', action: 'CHECK_RESOURCE', message: 'Resource/Model not found.' }
    ],
    429: [
        { status: 'RESOURCE_EXHAUSTED', action: 'ROTATE_KEY', message: 'Rate limit exceeded.' }
    ],
    500: [
        { status: 'INTERNAL', action: 'RETRY', message: 'Internal server error.' }
    ],
    503: [
        { status: 'UNAVAILABLE', action: 'RETRY', message: 'Service overloaded/down.' }
    ],
    504: [
        { status: 'DEADLINE_EXCEEDED', action: 'RETRY_LATER', message: 'Processing timeout.' }
    ]
};

export const ACTIONS = {
    ROTATE_KEY: 'ROTATE_KEY',
    RETRY: 'RETRY',
    STOP: 'STOP',
    RETRY_LATER: 'RETRY_LATER'
};

export function getActionForError(status, code) {
    if (ERROR_CODES[code]) {
        const errorDetail = ERROR_CODES[code].find(e => e.status === status) || ERROR_CODES[code][0]; // fallback to first if status match fails but code matches

        switch (errorDetail.action) {
            case 'ROTATE_KEY':
            case 'CHECK_KEY': // Treat invalid/leaked keys as needing rotation
                return ACTIONS.ROTATE_KEY;
            case 'RETRY':
            case 'RETRY_LATER':
                return ACTIONS.RETRY; // Simplify retry logic for now
            default:
                return ACTIONS.STOP; // Stop for 400, 403, 404 etc unless we have specific handling
        }
    }
    return ACTIONS.STOP; // Default to stop for unknown errors
}
