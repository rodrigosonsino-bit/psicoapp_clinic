async function test() {
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

        console.log("Fetching /api/auth/me...");
        const meRes = await fetch("https://whatsapp-scheduler-backend-production-14af.up.railway.app/api/auth/me", {
            headers: { "Authorization": `Bearer ${token}` }
        });

        const meData = await meRes.json();
        console.log("Response:", meData);
        console.log("is_admin:", meData.is_admin);
        
    } catch (e) {
        console.error(e);
    }
}

test();
