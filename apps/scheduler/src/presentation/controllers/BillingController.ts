import { Request, Response } from 'express';
import { Pool } from 'pg';
import { IPaymentService } from '../../infrastructure/payment/IPaymentService';
import { logger } from '../../infrastructure/logger/logger';

interface AuthenticatedRequest extends Request {
    tenantId?: string;
    tenantEmail?: string;
    tenantPlan?: string;
}

export class BillingController {
    constructor(
        private readonly dbPool: Pool,
        private readonly paymentService: IPaymentService
    ) {}

    private getFrontendUrl(): string {
        return process.env.FRONTEND_URL || 'http://127.0.0.1:54321';
    }

    createCheckoutSession = async (req: AuthenticatedRequest, res: Response) => {
        const { tenantId, tenantEmail } = req;
        const { planId } = req.body;

        if (!tenantId || !tenantEmail) {
            return res.status(401).json({ error: 'Não autorizado' });
        }
        if (!planId) {
            return res.status(400).json({ error: 'Plano não especificado' });
        }
        if (!this.paymentService.isConfigured()) {
            return res.status(503).json({ error: 'Serviço de pagamento não configurado.' });
        }

        try {
            const planRes = await this.dbPool.query(
                'SELECT mp_plan_id FROM plans WHERE id = $1 AND active = TRUE',
                [planId]
            );
            if (planRes.rows.length === 0) {
                return res.status(404).json({ error: 'Plano não encontrado ou inativo' });
            }

            const mpPlanId = planRes.rows[0].mp_plan_id;
            if (!mpPlanId) {
                return res.status(400).json({ error: 'Plano sem ID do Mercado Pago configurado. Contate o suporte.' });
            }

            const base = this.getFrontendUrl();
            const result = await this.paymentService.createCheckoutSession(
                tenantId,
                mpPlanId,
                tenantEmail,
                `${base}/?billing=success`,
                `${base}/?billing=canceled`
            );

            return res.json({ url: result.url });
        } catch (error: any) {
            logger.error({ err: error, tenantId, planId }, 'Erro ao criar checkout session MP');
            return res.status(500).json({ error: 'Falha ao criar sessão de checkout' });
        }
    };

    cancelSubscription = async (req: AuthenticatedRequest, res: Response) => {
        const { tenantId } = req;
        if (!tenantId) return res.status(401).json({ error: 'Não autorizado' });
        if (!this.paymentService.isConfigured()) {
            return res.status(503).json({ error: 'Serviço de pagamento não configurado.' });
        }

        try {
            const tenantRes = await this.dbPool.query(
                'SELECT mp_subscription_id FROM tenants WHERE id = $1',
                [tenantId]
            );
            const subId = tenantRes.rows[0]?.mp_subscription_id;
            if (!subId) {
                return res.status(400).json({ error: 'Nenhuma assinatura ativa encontrada.' });
            }

            await this.paymentService.cancelSubscription(subId);
            await this.dbPool.query(
                `UPDATE tenants SET subscription_status = 'cancelled', status = 'suspended',
                 max_messages_per_month = 0, updated_at = NOW() WHERE id = $1`,
                [tenantId]
            );

            logger.info({ tenantId, subId }, 'Assinatura cancelada pelo tenant');
            return res.json({ success: true });
        } catch (error: any) {
            logger.error({ err: error, tenantId }, 'Erro ao cancelar assinatura');
            return res.status(500).json({ error: 'Falha ao cancelar assinatura' });
        }
    };

    getSubscription = async (req: AuthenticatedRequest, res: Response) => {
        const { tenantId } = req;
        if (!tenantId) return res.status(401).json({ error: 'Não autorizado' });

        try {
            const tenantRes = await this.dbPool.query(`
                SELECT t.plan, t.status, t.subscription_status, t.current_period_end,
                       t.max_messages_per_month, t.mp_subscription_id, p.name AS plan_name
                FROM tenants t
                LEFT JOIN plans p ON t.plan = p.id
                WHERE t.id = $1
            `, [tenantId]);

            if (tenantRes.rows.length === 0) {
                return res.status(404).json({ error: 'Tenant não encontrado' });
            }

            const tenant = tenantRes.rows[0];
            const currentMonth = new Date().toISOString().slice(0, 7);
            const usageRes = await this.dbPool.query(
                'SELECT messages_sent, messages_failed FROM usage_tracking WHERE tenant_id = $1 AND month = $2',
                [tenantId, currentMonth]
            );
            const usage = usageRes.rows[0] || { messages_sent: 0, messages_failed: 0 };

            return res.json({
                plan: {
                    id: tenant.plan,
                    name: tenant.plan_name || tenant.plan,
                    maxMessages: tenant.max_messages_per_month,
                },
                subscription: {
                    status: tenant.subscription_status,
                    accountStatus: tenant.status,
                    currentPeriodEnd: tenant.current_period_end,
                    hasActiveSubscription: !!tenant.mp_subscription_id,
                },
                usage: {
                    month: currentMonth,
                    messagesSent: usage.messages_sent,
                    messagesFailed: usage.messages_failed,
                },
            });
        } catch (error: any) {
            logger.error({ err: error, tenantId }, 'Erro ao buscar assinatura');
            return res.status(500).json({ error: 'Erro interno ao buscar assinatura' });
        }
    };

    handleWebhook = async (req: Request, res: Response) => {
        if (!this.paymentService.isConfigured()) {
            return res.status(503).json({ error: 'Serviço de pagamento não configurado.' });
        }

        try {
            await this.paymentService.handleWebhook(req.body, req.headers as Record<string, string>);
            return res.json({ received: true });
        } catch (error: any) {
            logger.error({ err: error }, 'Erro ao processar webhook MP');
            return res.status(400).json({ error: `Webhook Error: ${error.message}` });
        }
    };
}
