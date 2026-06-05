export type ExpenseCategory = 'rent' | 'taxes' | 'software' | 'marketing' | 'other';

export interface PsychotherapyExpense {
    id: string;
    tenantId: string;
    date: Date;
    amountCents: number;
    description: string;
    category: ExpenseCategory;
    createdAt: Date;
    updatedAt: Date;
}
