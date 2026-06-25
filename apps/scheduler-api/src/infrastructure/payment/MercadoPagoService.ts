import { MercadoPagoConfig, PreApproval } from 'mercadopago';
import { createHmac } from 'crypto';
import { Pool } from 'pg';
import { logger } from '../logger/logger';
import { IPaymentService, CheckoutResult } from './IPaymentService';

export class MercadoPagoService implements IPaymentService {
    private client: MercadoPagoConfig | null = null;

    constructor(private readonly dbPool: Pool) {
        const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN;
        if (accessToken?.trim()) {
            this.client = new MercadoPagoConfig({ accessToken: accessToken.trim() });
            logger.info('Mercado Pago inicializado com sucesso.');
        } else {
            logger.warn('MP_ACCESS_TOKEN não configurado. Faturamento estará inativo.');
        }
    }

    isConfigured(): boolean {
        return this.client !== null;
    }

    async createCheckoutPreference(
        tenantId: string,
        planExternalId: string,
        payerEmail: string,
        successUrl: string,
        cancelUrl: string
    ): Promise<CheckoutResult> {
        if (!this.client) throw new Error('Mercado Pago não configurado.');

        // 1. Obter detalhes do plano do Mercado Pago (para pegar o preço e frequência)
        const token = process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN;
        const res = await fetch(`https://api.mercadopago.com/preapproval_plan/${planExternalId}`, {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });
        
        if (!res.ok) {
            throw new Error(`Falha ao obter plano do Mercado Pago: ${res.statusText}`);
        }
        const planData = await res.json();

        // 2. Criar a PreApproval inline (Assinatura) atrelada ao tenantId (sem card_token_id)
        const preApproval = new PreApproval(this.client);
        const result = await preApproval.create({
            body: {
                reason: planData.reason || 'Assinatura',
                external_reference: tenantId,
                payer_email: payerEmail,
                back_url: successUrl, // Pode ser successUrl ou cancelUrl
                auto_recurring: {
                    frequency: planData.auto_recurring.frequency,
                    frequency_type: planData.auto_recurring.frequency_type,
                    transaction_amount: planData.auto_recurring.transaction_amount,
                    currency_id: planData.auto_recurring.currency_id
                }
            } as any,
        });

        if (!result.init_point) {
            throw new Error('Mercado Pago não retornou URL de checkout.');
        }

        await this.dbPool.query(
            'UPDATE tenants SET mp_subscription_id = $1, updated_at = NOW() WHERE id = $2',
            [result.id, tenantId]
        );

        return { url: result.init_point, subscriptionId: result.id! };
    }

    async cancelSubscription(subscriptionId: string): Promise<void> {
        if (!this.client) throw new Error('Mercado Pago não configurado.');

        const preApproval = new PreApproval(this.client);
        await preApproval.update({
            id: subscriptionId,
            body: { status: 'cancelled' } as any,
        });
    }

    async handleWebhook(body: any, headers: Record<string, string>): Promise<void> {
        if (!this.client) throw new Error('Mercado Pago não configurado.');

        const webhookSecret = process.env.MP_WEBHOOK_SECRET;
        if (webhookSecret) {
            this.validateSignature(body, headers, webhookSecret);
        }

        const type: string = body.type || body.topic;
        const dataId: string = body.data?.id || body.id;

        if (!dataId) {
            logger.warn('Webhook MP sem data.id. Ignorando.');
            return;
        }

        // Idempotência
        const exists = await this.dbPool.query(
            'SELECT 1 FROM mp_events WHERE event_id = $1',
            [dataId + ':' + type]
        );
        if (exists.rows.length > 0) {
            logger.info({ dataId, type }, 'Webhook MP já processado. Ignorando.');
            return;
        }

        logger.info({ type, dataId }, 'Processando webhook do Mercado Pago');

        if (type === 'preapproval' || type === 'subscription_preapproval') {
            await this.processPreapprovalEvent(dataId);
        } else if (type === 'payment') {
            await this.processPaymentEvent(dataId);
        } else {
            logger.info({ type }, 'Tipo de webhook MP não tratado. Ignorando.');
        }

        await this.dbPool.query(
            'INSERT INTO mp_events (event_id, type, processed_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING',
            [dataId + ':' + type, type]
        );
    }

    private async processPreapprovalEvent(preapprovalId: string): Promise<void> {
        const preApproval = new PreApproval(this.client!);
        const sub = await preApproval.get({ id: preapprovalId });

        const planId = (sub as any).preapproval_plan_id;
        const status = sub.status; // pending | authorized | paused | cancelled | expired

        const planRes = await this.dbPool.query(
            'SELECT id, max_messages_per_month FROM plans WHERE mp_plan_id = $1',
            [planId]
        );

        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            if (status === 'authorized') {
                let dbPlanId = 'business';
                let maxMessages = 5000;
                if (planRes.rows.length > 0) {
                    dbPlanId = planRes.rows[0].id;
                    maxMessages = planRes.rows[0].max_messages_per_month;
                }

                const nextBillingDate = (sub as any).next_payment_date
                    ? new Date((sub as any).next_payment_date)
                    : null;

                await client.query(`
                    UPDATE tenants
                    SET mp_subscription_id    = $1,
                        subscription_status   = 'active',
                        current_period_end    = $2,
                        plan                  = $3,
                        max_messages_per_month = $4,
                        status                = 'active',
                        updated_at            = NOW()
                    WHERE mp_subscription_id = $1 OR id = (
                        SELECT id FROM tenants WHERE mp_subscription_id = $1 LIMIT 1
                    )
                `, [preapprovalId, nextBillingDate, dbPlanId, maxMessages]);

                logger.info({ preapprovalId, dbPlanId }, 'Assinatura MP ativada');

            } else if (status === 'cancelled' || status === 'expired') {
                await client.query(`
                    UPDATE tenants
                    SET subscription_status    = $1,
                        status                 = 'suspended',
                        max_messages_per_month = 0,
                        updated_at             = NOW()
                    WHERE mp_subscription_id = $2
                `, [status, preapprovalId]);

                logger.info({ preapprovalId, status }, 'Assinatura MP cancelada/expirada');

            } else if (status === 'paused') {
                await client.query(`
                    UPDATE tenants
                    SET subscription_status = 'paused', updated_at = NOW()
                    WHERE mp_subscription_id = $1
                `, [preapprovalId]);

                logger.info({ preapprovalId }, 'Assinatura MP pausada');
            }

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    private async processPaymentEvent(paymentId: string): Promise<void> {
        // Pagamentos individuais — apenas loga; o status da assinatura
        // é gerenciado pelo evento preapproval.
        logger.info({ paymentId }, 'Evento de pagamento MP recebido (gerenciado via preapproval)');
    }

    private validateSignature(body: any, headers: Record<string, string>, secret: string): void {
        const xSignature = headers['x-signature'];
        const xRequestId = headers['x-request-id'];
        
        if (!xSignature) {
            throw new Error('Assinatura x-signature ausente no webhook Mercado Pago.');
        }

        const parts = Object.fromEntries(
            xSignature.split(',').map((p) => p.split('=') as [string, string])
        );
        const ts = parts['ts'];
        const v1 = parts['v1'];
        
        if (!ts || !v1) {
            throw new Error('Assinatura incompleta (ts ou v1 ausentes) no webhook Mercado Pago.');
        }

        const dataId = body?.data?.id ?? '';
        const message = `id:${dataId};request-id:${xRequestId ?? ''};ts:${ts};`;
        const expected = createHmac('sha256', secret).update(message).digest('hex');

        if (expected !== v1) {
            throw new Error('Assinatura do webhook Mercado Pago inválida.');
        }
    }
}
