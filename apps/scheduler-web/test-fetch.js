const http = require('http');

http.get('http://localhost:3000/api/messages', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log("Response:", parsed);
      if (parsed.data && parsed.data.length > 0) {
        const msg = parsed.data.find(m => m.metadata != null);
        console.log("First message with metadata:", msg);
        if (msg) {
          console.log("Metadata type:", typeof msg.metadata);
          console.log("Recurrence:", msg.metadata.recurrence);
        }
      }
    } catch(e) { console.error(e); }
  });
});
