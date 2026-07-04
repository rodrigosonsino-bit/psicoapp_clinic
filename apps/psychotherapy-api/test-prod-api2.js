const jwt = require('jsonwebtoken');
const https = require('https');
const { Pool } = require('pg');

async function run() {
    const secret = process.env.JWT_SECRET;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const tenantRes = await pool.query('SELECT tenant_id FROM therapy_groups LIMIT 1');
    const tenant_id = tenantRes.rows[0].tenant_id;
    
    // Generate valid token
    const token = jwt.sign({ 
        tenantId: tenant_id, 
        userId: tenant_id,
        email: "test@test.com",
        plan: "premium",
        tokenUse: 'session' 
    }, secret, { expiresIn: '1h' });
    
    // Call API
    const options = {
      hostname: 'backend-production-7b2ea.up.railway.app',
      port: 443,
      path: '/api/psychotherapy/groups/531e0a18-2477-417f-abb3-6afb30bd3c66/payments?month=2026-07',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };
    
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
          console.log('STATUS:', res.statusCode);
          console.log('DATA:', data);
          process.exit(0);
      });
    });
    
    req.on('error', e => {
        console.error(e);
        process.exit(1);
    });
    
    req.end();
}
run();
