import {readFile} from 'node:fs/promises';
import {BOT_CONFIGS} from '../src/paper-bot-config.js';
import {initialBotState} from '../src/paper-bot-state.js';
import {BotRuntime} from '../src/paper-bot-runtime.js';
const file=process.argv[2];if(!file)throw Error('Usage: node scripts/paper-replay.js frames.jsonl [--reverse] [--disable=nova] [--balance=nova:0.1]');
const frames=(await readFile(file,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
if(!frames.length||frames.some(f=>!f.snapshot?.snapshotId||!Number.isFinite(f.snapshot.timestamp)))throw Error('Expected frames: {snapshot, executions?: {requestKey: result}}');
const disabled=process.argv.find(a=>a.startsWith('--disable='))?.split('=')[1],balance=process.argv.find(a=>a.startsWith('--balance='))?.split('=')[1]?.split(':');
let configs=BOT_CONFIGS.filter(c=>c.id!==disabled);if(process.argv.includes('--reverse'))configs=[...configs].reverse();let frame;
const bots=configs.map(c=>{const s=initialBotState(c,frames[0].snapshot.timestamp);if(balance?.[0]===c.id)s.cashSol=Number(balance[1]);return new BotRuntime(c,s,{execute:async input=>{const key=[c.id,input.mint,input.side,input.amount].join(':');const result=frame.executions?.[key];if(!result)throw Error('MISSING_REPLAY_EXECUTION: '+key);return structuredClone(result);}});});
for(const f of frames){frame=f;for(const bot of bots)await bot.tick(f.snapshot,f.replayAt??f.snapshot.timestamp);}
const result=Object.fromEntries(bots.map(b=>[b.config.id,{cashSol:b.state.cashSol,positions:b.state.positions,trades:b.state.trades,decisions:b.state.decisions,failures:b.state.failures}]));process.stdout.write(JSON.stringify(result,null,2)+'\n');
