const fetch = require('node-fetch');

async function createPlan() {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
        console.error("No token found");
        return;
    }
    
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
        back_url: "https://whatsapp-scheduler-backend-production-14af.up.railway.app"
    };

    const res = await fetch("https://api.mercadopago.com/preapproval_plan", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    const text = await res.text();
    console.log("Status:", res.status, "Body:", text);
}

createPlan();
