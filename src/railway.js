// Public Railway demo: no wallet, paper only, no remote mutation endpoints.
process.env.HOST='0.0.0.0';
process.env.PUBLIC_READ_ONLY='true';
process.env.PAPER_AUTOSTART='true';
await import('./server.js');
