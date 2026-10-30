# Meme Pilot · PAPER WEEK

This branch (`codex/paper-week`) is an isolated **virtual SOL experiment**, based on
LIVE commit `6dc5158`. It does not modify or deploy the LIVE branches/services.

- Starts with **0.5 virtual SOL**, configurable before the first run.
- Reuses deterministic PROJECT RULES; no AI and no account secret required.
- Only fresh read-only quotes can produce simulated fills. No signing/broadcast API.
- Sends a **23:59 Vietnam** Telegram summary with a training `.txt` attachment.
- Separate persistent `.paper-week` data, bounded logs and explicit missing evidence.
- New entries stop after seven days; open virtual positions remain monitored.

Read [HUONG-DAN-PAPER-WEEK.txt](HUONG-DAN-PAPER-WEEK.txt) for Windows setup,
Telegram, limitations and the separate-service Railway option.

```sh
npm ci --omit=dev --ignore-scripts
# Copy paper-week.env.example to paper-week.env; fill existing API/Telegram locally.
npm start
# Open http://127.0.0.1:3100
npm test
npm run check
node paper-week/analyze.js .paper-week > ket-qua-tuan.txt
```

Required safety/social/creation-block evidence is not invented. Missing evidence
means WATCH; a strict trial can have zero fills. Unknown sampled outcomes remain
unverified. Virtual profits are not proof of executable LIVE profits.

Railway config and `npm start` on this branch target **paper-week/bootstrap.js**.
Never select this branch on the existing LIVE service. Create a separate service
and separate Volume if choosing Railway; an extra service consumes credits.
