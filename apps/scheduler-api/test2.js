const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_OilvbUx97fWr@ep-curly-hill-af1mhb7g-pooler.c-2.us-west-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require' });
client.connect()
  .then(() => client.query("UPDATE tenants SET status = 'active' WHERE id = 'e4c39d63-78ca-4c5e-b1de-efd41f7c5a35'"))
  .then(res => { console.log(res.rowCount); client.end(); })
  .catch(err => { console.error(err); client.end(); });
