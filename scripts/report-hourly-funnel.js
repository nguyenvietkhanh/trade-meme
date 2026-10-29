import {readFile} from 'node:fs/promises';
const file=process.argv[2];if(!file){console.error('Usage: node scripts/report-hourly-funnel.js <export.json>');process.exitCode=2;}else{
 const doc=JSON.parse(await readFile(file,'utf8')),report=doc.hourlyFunnel??doc.funnel?.hourlyReport??doc.rules?.funnel?.hourlyReport;
 console.log(JSON.stringify({exportedAt:doc.exportedAt??null,policyVersion:doc.rules?.version??doc.entryPolicy?.version??null,status:report?'available':'unavailable',report:report??null,note:report?'UTC calendar hours; observe coverage and evaluation counts before changing thresholds.':'No measured hourly report in this export. Old decisions cannot reconstruct a complete running hour.'},null,2));
}
