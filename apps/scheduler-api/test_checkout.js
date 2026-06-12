async function testCheckout() {
    try {
        console.log("Logging in...");
        const loginRes = await fetch("https://whatsapp-scheduler-backend-production-14af.up.railway.app/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "rodrigosonsino@gmail.com", password: "142536" })
        });
        
        if (!loginRes.ok) {
            console.error("Login failed:", await loginRes.text());
            return;
        }

        const data = await loginRes.json();
        const token = data.token;
        console.log("Got token.");

        console.log("Fetching /api/billing/checkout...");
        const checkoutRes = await fetch("https://whatsapp-scheduler-backend-production-14af.up.railway.app/api/billing/checkout", {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ planId: "business" })
        });

        if (!checkoutRes.ok) {
            console.error("Checkout failed:", checkoutRes.status, await checkoutRes.text());
            return;
        }

        const checkoutData = await checkoutRes.json();
        console.log("Checkout Response:", checkoutData);
        
    } catch (e) {
        console.error(e);
    }
}

testCheckout();
