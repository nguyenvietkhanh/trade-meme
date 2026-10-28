import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Static public prompt asset only. No configuration/credential files are read.
export const PROMPT_V2_BASE=readFileSync(new URL('./prompts/live-ai-system.v2.txt',import.meta.url),'utf8');
export const PROMPT_V2_FOCUS=readFileSync(new URL('./prompts/live-ai-focus.v2.txt',import.meta.url),'utf8').trimEnd();
export const PROMPT_V2=PROMPT_V2_BASE+'\n\n'+PROMPT_V2_FOCUS;
export function liveAiPromptVersion(env=process.env){return env.LIVE_AI_PROMPT_VERSION==='v2'?'v2':'v1';}
export function modelPromptMetadata(context,system){
 const promptVersion=context.schema==='model-api-verification-v1'?'verification-v1':context.mode==='live'&&context.aiOnly?liveAiPromptVersion():context.mode==='live'?'live-legacy-v1':'paper-v1';
 return {promptVersion,promptSha256:createHash('sha256').update(system).digest('hex')};
}
