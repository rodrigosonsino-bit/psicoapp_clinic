export type ExpenseCategory = 'rent' | 'taxes' | 'software' | 'marketing' | 'other';

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
