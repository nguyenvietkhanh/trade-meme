// Mainnet UI. Financial controls require the fixed owner's signed session.
process.env.HOST='0.0.0.0';
process.env.PUBLIC_READ_ONLY='true';
await import('./server.js');
