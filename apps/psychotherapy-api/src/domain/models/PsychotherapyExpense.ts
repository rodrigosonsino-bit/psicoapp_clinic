export type ExpenseCategory = 'rent' | 'taxes' | 'software' | 'marketing' | 'utilities' | 'office_supplies' | 'services' | 'cleaning' | 'other';

export interface PsychotherapyExpense {
    id: string;
    tenantId: string;
    date: Date;
    amountCents: number;
    description: string;
    category: ExpenseCategory;
    fixedExpenseId?: string | null;
    referenceMonth?: string | null;
    createdAt: Date;
    updatedAt: Date;
}
