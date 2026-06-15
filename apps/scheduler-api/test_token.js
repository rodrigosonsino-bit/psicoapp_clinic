const fetch = require('node-fetch');

async function testToken() {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
        console.error("No token found");
        return;
    }
    
    const res = await fetch("https://api.mercadopago.com/users/me", {
        headers: {
            "Authorization": `Bearer ${token}`
        }
    });

    const text = await res.text();
    console.log("Status:", res.status, "Body:", text);
}

testToken();
