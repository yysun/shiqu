// Share the app's CLI login directory without passing API keys to subscription authentication.
import {spawn} from 'node:child_process';
import {codexEnvironment} from './codex-env.mjs';
const [action,...provided]=process.argv.slice(2);
const extra=provided.filter(flag=>flag!=='--');
if(!['login','status'].includes(action)||extra.some(flag=>flag!=='--device-auth')||(action==='status'&&extra.length)){
 console.error('Use pnpm run codex:login [-- --device-auth] or pnpm run codex:status.');
 process.exitCode=1;
}else{
 const args=action==='status'?['login','status']:['login',...extra];
 const child=spawn(process.env.CODEX_BIN?.trim()||'codex',args,{stdio:'inherit',env:codexEnvironment(process.env.SHIQU_CODEX_HOME)});
 child.on('error',()=>{console.error('Codex CLI was not found. Install it with: pnpm add -g @openai/codex@0.165.0');process.exitCode=1;});
 child.on('exit',code=>{process.exitCode=code??1;});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
}
