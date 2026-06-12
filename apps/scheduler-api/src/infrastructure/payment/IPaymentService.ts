export interface CheckoutResult {
    url: string;
    subscriptionId: string;
}

export interface IPaymentService {
    isConfigured(): boolean;
    createCheckoutPreference(
        tenantId: string,
        planExternalId: string,
        payerEmail: string,
        successUrl: string,
        cancelUrl: string
    ): Promise<CheckoutResult>;
    cancelSubscription(subscriptionId: string): Promise<void>;
    handleWebhook(body: any, headers: Record<string, string>): Promise<void>;
}
