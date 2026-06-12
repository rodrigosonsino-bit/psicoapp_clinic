const fetch = require('node-fetch');

async function createPreApproval() {
    const token = "TEST-8363082812010742-061118-98238f459ea44968cf8a32564cc48138-1878259";
    
    const body = {
        preapproval_plan_id: "f288a6fc89f5449d85e3650796403d9d",
        payer_email: "rodrigosonsino@gmail.com",
        back_url: "https://whatsapp-scheduler-backend-production-14af.up.railway.app"
    };

    const res = await fetch("https://api.mercadopago.com/preapproval", {
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

createPreApproval();
