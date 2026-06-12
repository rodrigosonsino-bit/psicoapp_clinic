const fetch = require('node-fetch');

async function getPlanAndCreateSubscription() {
    const token = "TEST-8363082812010742-061118-98238f459ea44968cf8a32564cc48138-1878259";
    const planId = "f288a6fc89f5449d85e3650796403d9d";
    
    // 1. Fetch Plan
    const planRes = await fetch(`https://api.mercadopago.com/preapproval_plan/${planId}`, {
        headers: { "Authorization": `Bearer ${token}` }
    });
    const plan = await planRes.json();
    console.log("Plan:", plan);

    // 2. Create PreApproval inline
    const body = {
        reason: plan.reason,
        external_reference: "TENANT_123",
        payer_email: "rodrigosonsino@gmail.com",
        back_url: "https://whatsapp-scheduler-backend-production-14af.up.railway.app",
        auto_recurring: {
            frequency: plan.auto_recurring.frequency,
            frequency_type: plan.auto_recurring.frequency_type,
            transaction_amount: plan.auto_recurring.transaction_amount,
            currency_id: plan.auto_recurring.currency_id
        }
    };

    const subRes = await fetch("https://api.mercadopago.com/preapproval", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    const sub = await subRes.json();
    console.log("Subscription:", sub);
}

getPlanAndCreateSubscription();
