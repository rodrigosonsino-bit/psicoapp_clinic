const fetch = require('node-fetch');

async function listPlans() {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
        console.error("No token found");
        return;
    }
    
    const res = await fetch("https://api.mercadopago.com/preapproval_plan/search?status=active", {
        headers: {
            "Authorization": `Bearer ${token}`
        }
    });

    if (!res.ok) {
        console.log("Error:", res.status, await res.text());
        return;
    }

    const data = await res.json();
    console.log("Found", data.results.length, "plans");
    
    data.results.forEach(plan => {
        console.log(`- ID: ${plan.id} | Reason: ${plan.reason} | Price: ${plan.auto_recurring.transaction_amount}`);
    });
}

listPlans();
