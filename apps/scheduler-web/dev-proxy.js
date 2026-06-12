#!/usr/bin/env node
/**
 * dev-proxy.js — CORS proxy for local development.
 * Forwards requests from localhost:3001 to the Railway backend.
 * Run: node dev-proxy.js
 * Then set EXPO_PUBLIC_API_URL=http://localhost:3001/api in .env
 */
const http = require('http');
const https = require('https');

const TARGET = 'whatsapp-scheduler-backend-production-14af.up.railway.app';
const PORT = 3001;

const server = http.createServer((req, res) => {
  const options = {
    hostname: TARGET,
    port: 443,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: TARGET,
    },
  };

  // Strip problematic hop-by-hop headers
  delete options.headers['origin'];
  delete options.headers['referer'];

  const corsHeaders = {
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const proxy = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, { ...proxyRes.headers, ...corsHeaders });
    proxyRes.pipe(res);
  });

  proxy.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.writeHead(502);
    res.end('Proxy error: ' + err.message);
  });

  req.pipe(proxy);
});

server.listen(PORT, () => {
  console.log(`✅ Dev proxy running on http://localhost:${PORT}`);
  console.log(`   Forwarding to https://${TARGET}`);
  console.log(`\n   Set in .env:`);
  console.log(`   EXPO_PUBLIC_API_URL=http://localhost:${PORT}/api\n`);
});
