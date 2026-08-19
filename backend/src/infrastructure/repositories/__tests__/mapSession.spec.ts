import 'reflect-metadata';
import { mapSession } from '../shared';
import { SessionRow } from '../dbRowTypes';

const baseRow: SessionRow = {
    id: 'session-1',
    tenant_id: 'tenant-1',
    patient_id: 'patient-1',
    date: new Date('2026-08-19T10:30:00.000Z'),
    status: 'attended',
    notes: null,
    appointment_id: 'appointment-1',
    created_at: new Date('2026-08-19T10:30:00.000Z'),
    updated_at: new Date('2026-08-19T10:30:00.000Z')
};

describe('mapSession — googleMeetLink (achado real: Lucilene 2026-08-19)', () => {
    it('repassa google_meet_link do agendamento vinculado quando presente na linha', () => {
        const session = mapSession({ ...baseRow, google_meet_link: 'https://meet.google.com/eqp-uqmk-kgs' });
        expect(session.googleMeetLink).toBe('https://meet.google.com/eqp-uqmk-kgs');
    });

    it('fica undefined quando a query não trouxe o JOIN (coluna ausente)', () => {
        const session = mapSession(baseRow);
        expect(session.googleMeetLink).toBeUndefined();
    });

    it('fica undefined quando o agendamento vinculado não tem Meet ainda (null)', () => {
        const session = mapSession({ ...baseRow, google_meet_link: null });
        expect(session.googleMeetLink).toBeUndefined();
    });
});
