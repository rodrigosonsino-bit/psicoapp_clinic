import { PsychotherapyReceipt } from '../PsychotherapyReceipt';
import { TenantProfile } from '../TenantProfile';

describe('Models', () => {
    describe('PsychotherapyReceipt', () => {
        it('should correctly serialize to JSON', () => {
            const date = new Date();
            const receipt = new PsychotherapyReceipt(
                'rec-id',
                'tenant-id',
                'patient-id',
                42,
                15000,
                date,
                'Description',
                date,
                date
            );

            expect(receipt.toJSON()).toEqual({
                id: 'rec-id',
                tenantId: 'tenant-id',
                patientId: 'patient-id',
                receiptNumber: 42,
                amountCents: 15000,
                issueDate: date,
                description: 'Description',
                createdAt: date,
                updatedAt: date
            });
        });
    });

    describe('TenantProfile', () => {
        it('should correctly serialize to JSON', () => {
            const profile = new TenantProfile(
                'tenant-id',
                'Tenant Name',
                'tenant@example.com',
                'Full Name',
                'CPF/CNPJ',
                'Professional ID',
                'Address'
            );

            expect(profile.toJSON()).toEqual({
                id: 'tenant-id',
                name: 'Tenant Name',
                email: 'tenant@example.com',
                fullName: 'Full Name',
                document: 'CPF/CNPJ',
                professionalId: 'Professional ID',
                address: 'Address',
                twoFactorEnabled: false,
                bookingPage: null,
                cardFeeRates: null
            });
        });
    });
});
