const fetch = require('node-fetch');

async function createPlan() {
    const token = "APP_USR-8363082812010742-061118-f4592d9255f4979a0d8ef008e6753d04-1878259";
    
    const body = {
        reason: "Plano Business",
        auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            billing_day: 10,
            billing_day_proportional: true,
            transaction_amount: 29.90,
            currency_id: "BRL"
        },
        payment_methods_allowed: {
            payment_types: [
                { id: "credit_card" }
            ],
            payment_methods: []
        },
        back_url: "https://psicoapp-production.up.railway.app/dashboard"
    };

    const res = await fetch("https://api.mercadopago.com/preapproval_plan", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(body)
    });

    const data = await res.json();
    if (res.ok) {
        console.log("PLAN_ID=" + data.id);
    } else {
        console.error("ERROR:", JSON.stringify(data, null, 2));
    }
}

createPlan();
