// Initialize persisted local bindings and launch the compiled application with Wrangler.
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,chmodSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const data=path.resolve(process.env.SHIQU_DATA_DIR||'/data');
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT must be between 1024 and 65535');
mkdirSync(data,{recursive:true});
const configPath=path.join(root,'dist/server/wrangler.json');
if(!existsSync(configPath))throw Error('Build missing. Run pnpm build before starting.');
const config=JSON.parse(readFileSync(configPath,'utf8'));
config.vars={...config.vars,ADMIN_USER_ID:'docker-local-owner'};
for(const db of config.d1_databases||[])db.migrations_dir=path.join(root,'drizzle');
writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
chmodSync(configPath,0o600);
const secretsPath=path.join(root,'dist/server/.dev.vars');
const variables=['GEMINI_API_KEY','GEMINI_TEXT_MODEL','GEMINI_IMAGE_MODEL'];
const lines=variables.filter(name=>process.env[name]?.trim()).map(name=>`${name}=${JSON.stringify(process.env[name].trim())}`);
writeFileSync(secretsPath,lines.join('\n')+'\n',{mode:0o600});chmodSync(secretsPath,0o600);
const env={...process.env,CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',WRANGLER_SEND_METRICS:'false',CLOUDFLARE_CF_FETCH_ENABLED:'false'};
const wrangler=path.join(root,'node_modules/wrangler/bin/wrangler.js');
const common=['--local','--config',configPath,'--persist-to',data];
function run(args){const result=spawnSync(process.execPath,[wrangler,...args],{env,stdio:'inherit'});if(result.status!==0)throw Error('Local database initialization failed. Existing data was kept.');}
console.log('Applying local database migrations...');
run(['d1','migrations','apply','DB',...common]);
run(['d1','execute','DB',...common,'--file',path.join(root,'docker/seed.sql')]);
console.log(`Starting 拾趣 on port ${port}. ${process.env.GEMINI_API_KEY?.trim()?'Gemini key configured.':'No Gemini key: sample reading is available; AI generation is disabled.'}`);
const child=spawn(process.execPath,[wrangler,'dev',...common,'--ip',process.env.SHIQU_BIND_IP||'0.0.0.0','--port',String(port),'--inspector-port','0','--log-level','warn'],{env,stdio:'inherit'});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>{console.error('Unable to start the local runtime.');process.exit(1);});
child.on('exit',code=>process.exit(code??0));
