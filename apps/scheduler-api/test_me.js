const fetch = require('node-fetch');

async function testMe() {
    // First login to get token
    const loginRes = await fetch("https://whatsapp-scheduler-backend-production-14af.up.railway.app/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "rodrigosonsino@gmail.com", password: "admin123" })
    });
    
    const loginData = await loginRes.json();
    console.log("Login status:", loginRes.status);
    
    if (!loginData.token) {
        console.error("No token in login response:", JSON.stringify(loginData));
        return;
    }
    
    // Now call /me
    const meRes = await fetch("https://whatsapp-scheduler-backend-production-14af.up.railway.app/api/auth/me", {
        headers: { "Authorization": `Bearer ${loginData.token}` }
    });
    
    const meData = await meRes.json();
    console.log("/me response:", JSON.stringify(meData, null, 2));
}

testMe();
