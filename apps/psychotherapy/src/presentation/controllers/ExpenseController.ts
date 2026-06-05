import { Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { SavePsychotherapyExpenseUseCase } from '../../application/useCases/SavePsychotherapyExpenseUseCase';
import { ListPsychotherapyExpensesUseCase } from '../../application/useCases/ListPsychotherapyExpensesUseCase';
import { DeletePsychotherapyExpenseUseCase } from '../../application/useCases/DeletePsychotherapyExpenseUseCase';
import { GetDashboardAnalyticsUseCase } from '../../application/useCases/GetDashboardAnalyticsUseCase';

@injectable()
export class ExpenseController {
    constructor(
        @inject(SavePsychotherapyExpenseUseCase) private saveExpenseUseCase: SavePsychotherapyExpenseUseCase,
        @inject(ListPsychotherapyExpensesUseCase) private listExpensesUseCase: ListPsychotherapyExpensesUseCase,
        @inject(DeletePsychotherapyExpenseUseCase) private deleteExpenseUseCase: DeletePsychotherapyExpenseUseCase,
        @inject(GetDashboardAnalyticsUseCase) private getDashboardAnalyticsUseCase: GetDashboardAnalyticsUseCase
    ) {}

    async saveExpense(req: AuthenticatedRequest, res: Response): Promise<void> {
        const tenantId = req.tenantId!;
        const data = { ...req.body, tenantId };
        const expense = await this.saveExpenseUseCase.execute(data);
        res.status(201).json(expense);
    }

    async listExpenses(req: AuthenticatedRequest, res: Response): Promise<void> {
        const tenantId = req.tenantId!;
        const { start, end, page, limit } = req.query as any;

        const result = await this.listExpensesUseCase.execute(
            tenantId,
            start,
            end,
            page,
            limit
        );
        res.status(200).json({
            data: result.data,
            meta: {
                total: result.total,
                page,
                limit,
                totalPages: Math.ceil(result.total / limit)
            }
        });
    }

    async deleteExpense(req: AuthenticatedRequest, res: Response): Promise<void> {
        const tenantId = req.tenantId!;
        const { id } = req.params;
        await this.deleteExpenseUseCase.execute(tenantId, id);
        res.status(204).send();
    }

    async getAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
        const tenantId = req.tenantId!;
        const { month } = req.query; // YYYY-MM
        const analytics = await this.getDashboardAnalyticsUseCase.execute(tenantId, month as string | undefined);
        res.status(200).json(analytics);
    }
}
