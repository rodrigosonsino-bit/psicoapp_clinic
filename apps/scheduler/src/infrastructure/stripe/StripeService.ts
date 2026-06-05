import Stripe from 'stripe';
import { Pool } from 'pg';
import { logger } from '../logger/logger';

export class StripeService {
    private stripe: any = null;

    constructor(private readonly dbPool: Pool) {
        const apiKey = process.env.STRIPE_SECRET_KEY;
        if (apiKey && apiKey.trim() !== '') {
            try {
                this.stripe = new Stripe(apiKey, {
                    apiVersion: '2024-12-18.acacia' as any,
                });
                logger.info('Stripe inicializado com sucesso.');
            } catch (err) {
                logger.error({ err }, 'Erro ao instanciar o Stripe. Funcionalidades de faturamento estarão inativas.');
            }
        } else {
            logger.warn('STRIPE_SECRET_KEY não configurada ou vazia. Funcionalidades de faturamento estarão inativas.');
        }
    }

    async createCustomer(email: string, name: string): Promise<any> {
        if (!this.stripe) {
            throw new Error('Serviço Stripe não configurado.');
        }
        return await this.stripe.customers.create({
            email,
            name,
        });
    }

    async createCheckoutSession(tenantId: string, priceId: string, successUrl: string, cancelUrl: string): Promise<any> {
        if (!this.stripe) {
            throw new Error('Serviço Stripe não configurado.');
        }
        
        const tenantRes = await this.dbPool.query('SELECT stripe_customer_id, email, name FROM tenants WHERE id = $1', [tenantId]);
        if (tenantRes.rows.length === 0) {
            throw new Error('Tenant não encontrado');
        }
        
        let customerId = tenantRes.rows[0].stripe_customer_id;
        if (!customerId) {
            const customer = await this.createCustomer(tenantRes.rows[0].email, tenantRes.rows[0].name);
            customerId = customer.id;
            await this.dbPool.query('UPDATE tenants SET stripe_customer_id = $1 WHERE id = $2', [customerId, tenantId]);
        }

        return await this.stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: successUrl,
            cancel_url: cancelUrl,
            subscription_data: {
                metadata: {
                    tenantId,
                },
            },
            metadata: {
                tenantId,
            },
        });
    }

    async createPortalSession(customerId: string, returnUrl: string): Promise<any> {
        if (!this.stripe) {
            throw new Error('Serviço Stripe não configurado.');
        }
        return await this.stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
        });
    }

    async handleWebhook(payload: Buffer, signature: string, webhookSecret: string): Promise<void> {
        if (!this.stripe) {
            throw new Error('Serviço Stripe não configurado.');
        }
        
        const event = this.stripe.webhooks.constructEvent(
            payload,
            signature,
            webhookSecret
        );

        logger.info({ eventId: event.id, eventType: event.type }, 'Processando webhook do Stripe');

        const exists = await this.dbPool.query(
            'SELECT 1 FROM stripe_events WHERE event_id = $1',
            [event.id]
        );
        if (exists.rows.length > 0) {
            logger.info({ eventId: event.id }, 'Webhook já processado anteriormente. Ignorando.');
            return;
        }

        const client = await this.dbPool.connect();
        try {
            await client.query('BEGIN');

            switch (event.type) {
                case 'checkout.session.completed': {
                    const session = event.data.object as any;
                    const tenantId = session.metadata?.tenantId || session.subscription_data?.metadata?.tenantId;
                    const customerId = session.customer as string;
                    const subscriptionId = session.subscription as string;

                    if (tenantId) {
                        const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
                        const priceId = subscription.items.data[0]?.price.id;
                        
                        const planRes = await client.query('SELECT id, max_messages_per_month FROM plans WHERE stripe_price_id = $1', [priceId]);
                        let planId = 'starter';
                        let maxMessages = 200;
                        if (planRes.rows.length > 0) {
                            planId = planRes.rows[0].id;
                            maxMessages = planRes.rows[0].max_messages_per_month;
                        }

                        const periodEnd = new Date(subscription.current_period_end * 1000);

                        await client.query(`
                            UPDATE tenants 
                            SET stripe_customer_id = $1,
                                stripe_subscription_id = $2,
                                subscription_status = $3,
                                current_period_end = $4,
                                plan = $5,
                                max_messages_per_month = $6,
                                status = 'active',
                                updated_at = NOW()
                            WHERE id = $7
                        `, [customerId, subscriptionId, subscription.status, periodEnd, planId, maxMessages, tenantId]);
                        
                        logger.info({ tenantId, planId, maxMessages }, 'Assinatura ativada com sucesso via checkout');
                    }
                    break;
                }

                case 'invoice.paid': {
                    const invoice = event.data.object as any;
                    const subscriptionId = invoice.subscription as string;
                    
                    if (subscriptionId) {
                        const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
                        const periodEnd = new Date(subscription.current_period_end * 1000);
                        const priceId = subscription.items.data[0]?.price.id;

                        const planRes = await client.query('SELECT id, max_messages_per_month FROM plans WHERE stripe_price_id = $1', [priceId]);
                        let planId = 'starter';
                        let maxMessages = 200;
                        if (planRes.rows.length > 0) {
                            planId = planRes.rows[0].id;
                            maxMessages = planRes.rows[0].max_messages_per_month;
                        }

                        await client.query(`
                            UPDATE tenants 
                            SET subscription_status = $1,
                                current_period_end = $2,
                                plan = $3,
                                max_messages_per_month = $4,
                                status = 'active',
                                updated_at = NOW()
                            WHERE stripe_subscription_id = $5
                        `, [subscription.status, periodEnd, planId, maxMessages, subscriptionId]);

                        logger.info({ subscriptionId, periodEnd }, 'Fatura paga e assinatura renovada');
                    }
                    break;
                }

                case 'invoice.payment_failed': {
                    const invoice = event.data.object as any;
                    const subscriptionId = invoice.subscription as string;
                    if (subscriptionId) {
                        await client.query(`
                            UPDATE tenants 
                            SET subscription_status = 'past_due',
                                updated_at = NOW()
                            WHERE stripe_subscription_id = $1
                        `, [subscriptionId]);
                        logger.warn({ subscriptionId }, 'Pagamento de fatura falhou. Assinatura marcada como past_due');
                    }
                    break;
                }

                case 'customer.subscription.updated': {
                    const subscription = event.data.object as any;
                    const subscriptionId = subscription.id;
                    const priceId = subscription.items.data[0]?.price.id;
                    const periodEnd = new Date(subscription.current_period_end * 1000);

                    const planRes = await client.query('SELECT id, max_messages_per_month FROM plans WHERE stripe_price_id = $1', [priceId]);
                    let planId = 'starter';
                    let maxMessages = 200;
                    if (planRes.rows.length > 0) {
                        planId = planRes.rows[0].id;
                        maxMessages = planRes.rows[0].max_messages_per_month;
                    }

                    await client.query(`
                        UPDATE tenants
                        SET subscription_status = $1,
                            current_period_end = $2,
                            plan = $3,
                            max_messages_per_month = $4,
                            updated_at = NOW()
                        WHERE stripe_subscription_id = $5
                    `, [subscription.status, periodEnd, planId, maxMessages, subscriptionId]);

                    logger.info({ subscriptionId, status: subscription.status }, 'Assinatura atualizada no Stripe');
                    break;
                }

                case 'customer.subscription.deleted': {
                    const subscription = event.data.object as any;
                    const subscriptionId = subscription.id;
                    
                    await client.query(`
                        UPDATE tenants 
                        SET subscription_status = 'canceled',
                            status = 'suspended',
                            max_messages_per_month = 0,
                            updated_at = NOW()
                        WHERE stripe_subscription_id = $1
                    `, [subscriptionId]);

                    logger.info({ subscriptionId }, 'Assinatura cancelada no Stripe e tenant suspenso');
                    break;
                }
            }

            await client.query(
                'INSERT INTO stripe_events (event_id, type, processed_at) VALUES ($1, $2, NOW())',
                [event.id, event.type]
            );

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            logger.error({ err, eventId: event.id }, 'Erro ao processar webhook transacional');
            throw err;
        } finally {
            client.release();
        }
    }
}
