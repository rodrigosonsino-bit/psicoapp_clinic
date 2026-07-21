import crypto from 'crypto';

/**
 * Google Calendar accepts the base32hex alphabet (a-v, 0-9) for caller-supplied
 * event IDs. A hexadecimal SHA-256 digest is a safe subset of that alphabet.
 * Including the generation lets a genuinely deleted/tombstoned event be
 * recreated without making retries of the same generation non-idempotent.
 */
export class GoogleCalendarEventIdFactory {
    create(tenantId: string, appointmentId: string, generation: number): string {
        if (!Number.isInteger(generation) || generation < 0) {
            throw new Error('Google Calendar event generation must be a non-negative integer.');
        }

        const digest = crypto
            .createHash('sha256')
            .update(`${tenantId}:${appointmentId}:${generation}`)
            .digest('hex');

        return `psico${digest}`;
    }

    tenantFingerprint(tenantId: string): string {
        return crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 16);
    }
}
