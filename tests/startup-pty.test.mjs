// Run the checked-in POSIX terminal contract with isolated Python, fake credentials and disposable homes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

test('real CLI PTY onboarding, cancellation, configure and reset',{
 skip:process.platform==='win32'?'POSIX PTYs run on Linux/macOS; Windows runs the non-TTY startup matrix':false,timeout:120000,
},async t=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'shiqu-pty-launcher-'));
 const env={PATH:process.env.PATH,HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:path.join(home,'config'),XDG_DATA_HOME:path.join(home,'data'),LANG:'en_US.UTF-8'};
 if(process.env.TMPDIR)env.TMPDIR=process.env.TMPDIR;
 const child=spawn('python3',['-I',fileURLToPath(new URL('./fixtures/startup_pty.py',import.meta.url)),path.resolve(import.meta.dirname,'..'),process.execPath],{env,stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await exited;}await rm(home,{recursive:true,force:true});});
 const timer=setTimeout(()=>child.kill('SIGTERM'),110000);
 try{assert.equal((await exited)[0],0,output);assert.match(output,/OK/);t.diagnostic(output.trim());}finally{clearTimeout(timer);}
});
