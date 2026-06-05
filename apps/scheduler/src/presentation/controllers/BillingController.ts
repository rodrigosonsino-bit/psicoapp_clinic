import { Request, Response } from 'express';
import { Pool } from 'pg';
import { StripeService } from '../../infrastructure/stripe/StripeService';
import { logger } from '../../infrastructure/logger/logger';

interface AuthenticatedRequest extends Request {
    tenantId?: string;
    tenantEmail?: string;
    tenantPlan?: string;
}

export class BillingController {
    constructor(
        private readonly dbPool: Pool,
        private readonly stripeService: StripeService
    ) {}

    private validateRedirectUrl(url: string | undefined, fallback: string): string {
        const frontendUrl = process.env.FRONTEND_URL;
        if (!frontendUrl && process.env.NODE_ENV === 'production') {
            throw new Error('FATAL: A variável de ambiente FRONTEND_URL é obrigatória em produção.');
        }
        const finalFrontendUrl = frontendUrl || 'http://localhost:3000';

        if (!url) {
            return fallback;
        }

        try {
            const parsed = new URL(url);
            const parsedFrontend = new URL(finalFrontendUrl);
            if (parsed.origin === parsedFrontend.origin) {
                return url;
            }
        } catch {
            if (url.startsWith('/')) {
                return `${finalFrontendUrl}${url}`;
            }
        }

        return fallback;
    }

    createCheckoutSession = async (req: AuthenticatedRequest, res: Response) => {
        const tenantId = req.tenantId;
        const { planId, successUrl, cancelUrl } = req.body;

        if (!tenantId) {
            return res.status(401).json({ error: 'Não autorizado' });
        }

        if (!planId) {
            return res.status(400).json({ error: 'Plano não especificado' });
        }

        try {
            // Obter price_id correspondente
            const planRes = await this.dbPool.query('SELECT stripe_price_id FROM plans WHERE id = $1 AND active = TRUE', [planId]);
            if (planRes.rows.length === 0) {
                return res.status(404).json({ error: 'Plano não encontrado ou inativo' });
            }

            const priceId = planRes.rows[0].stripe_price_id;
            if (!priceId) {
                return res.status(400).json({ error: 'Este plano não possui um ID do Stripe configurado' });
            }

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            const sUrl = this.validateRedirectUrl(successUrl, `${frontendUrl}/billing?success=true`);
            const cUrl = this.validateRedirectUrl(cancelUrl, `${frontendUrl}/billing?canceled=true`);

            const session = await this.stripeService.createCheckoutSession(tenantId, priceId, sUrl, cUrl);
            return res.json({ url: session.url });
        } catch (error: any) {
            logger.error({ err: error, tenantId, planId }, 'Erro ao criar checkout session');
            return res.status(500).json({ error: 'Falha ao criar sessão de checkout' });
        }
    };

    createPortalSession = async (req: AuthenticatedRequest, res: Response) => {
        const tenantId = req.tenantId;
        const { returnUrl } = req.body;

        if (!tenantId) {
            return res.status(401).json({ error: 'Não autorizado' });
        }

        try {
            const tenantRes = await this.dbPool.query('SELECT stripe_customer_id FROM tenants WHERE id = $1', [tenantId]);
            if (tenantRes.rows.length === 0) {
                return res.status(404).json({ error: 'Tenant não encontrado' });
            }

            const customerId = tenantRes.rows[0].stripe_customer_id;
            if (!customerId) {
                return res.status(400).json({ error: 'Você ainda não possui um cadastro de cobrança ativo. Realize uma assinatura primeiro.' });
            }

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            const rUrl = this.validateRedirectUrl(returnUrl, `${frontendUrl}/billing`);
            const session = await this.stripeService.createPortalSession(customerId, rUrl);
            return res.json({ url: session.url });
        } catch (error: any) {
            logger.error({ err: error, tenantId }, 'Erro ao criar portal session');
            return res.status(500).json({ error: 'Falha ao criar sessão do portal do cliente' });
        }
    };

    getSubscription = async (req: AuthenticatedRequest, res: Response) => {
        const tenantId = req.tenantId;

        if (!tenantId) {
            return res.status(401).json({ error: 'Não autorizado' });
        }

        try {
            const tenantRes = await this.dbPool.query(`
                SELECT t.id, t.name, t.email, t.plan, t.status, t.subscription_status, t.current_period_end, t.max_messages_per_month, p.name as plan_name
                FROM tenants t
                LEFT JOIN plans p ON t.plan = p.id
                WHERE t.id = $1
            `, [tenantId]);

            if (tenantRes.rows.length === 0) {
                return res.status(404).json({ error: 'Tenant não encontrado' });
            }

            const tenant = tenantRes.rows[0];

            // Obter uso atual do mês
            const currentMonth = new Date().toISOString().slice(0, 7); // Formato YYYY-MM
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
                },
                usage: {
                    month: currentMonth,
                    messagesSent: usage.messages_sent,
                    messagesFailed: usage.messages_failed,
                }
            });
        } catch (error: any) {
            logger.error({ err: error, tenantId }, 'Erro ao buscar dados de assinatura');
            return res.status(500).json({ error: 'Erro interno ao buscar assinatura' });
        }
    };

    handleWebhook = async (req: Request, res: Response) => {
        const signature = req.headers['stripe-signature'] as string;
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!signature) {
            return res.status(400).json({ error: 'Assinatura do Stripe ausente' });
        }

        if (!webhookSecret) {
            logger.error('STRIPE_WEBHOOK_SECRET não configurado!');
            return res.status(500).json({ error: 'Configuração do webhook incompleta' });
        }

        try {
            // req.body deve ser um Buffer (express.raw)
            await this.stripeService.handleWebhook(req.body, signature, webhookSecret);
            return res.json({ received: true });
        } catch (error: any) {
            logger.error({ err: error }, 'Erro ao processar webhook do Stripe');
            return res.status(400).json({ error: `Webhook Error: ${error.message}` });
        }
    };
}
