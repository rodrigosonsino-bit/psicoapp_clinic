const fetch = require('node-fetch');

async function createPlan() {
    const token = "APP_USR-8363082812010742-061118-98238f459ea44968cf8a32564cc48138-1878259";
    
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

    const data = await res.json();
    console.log(data);
}

createPlan();
