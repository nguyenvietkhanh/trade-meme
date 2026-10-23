const DAY=86400000,OFFSET=7*3600000,CUTOFF=(23*60+59)*60000;
export const PAPER_REPORT_TIME='23:59';
export const PAPER_REPORT_TIMEZONE='Asia/Ho_Chi_Minh';
export const paperReportEnd=now=>Math.floor((now+OFFSET-CUTOFF)/DAY)*DAY+CUTOFF-OFFSET;
// An old 23:00 checkpoint first gets a short 59-minute transition report.
// No reset, skipped interval or duplicate accounting on schedule migration.
export const nextPaperReportEnd=last=>paperReportEnd(last)+DAY;
export function validPaperReportRef(ref){
 const end=ref?.end;
 const legacy=Number.isSafeInteger(end)&&(end+OFFSET-23*3600000)%DAY===0;
 return Number.isSafeInteger(end)&&end>0&&(paperReportEnd(end)===end||legacy)&&Number.isSafeInteger(ref.part)&&ref.part>=1&&ref.part<=10000;
}
