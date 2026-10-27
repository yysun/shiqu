// Share subscription-only child configuration between the server and sign-in commands.
import path from 'node:path';
const names=['PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TMPDIR','TEMP','TMP','LANG','SSL_CERT_FILE','CODEX_CA_CERTIFICATE','HTTP_PROXY','HTTPS_PROXY','NO_PROXY'];
export function codexEnvironment(home,source=process.env){
 const env=Object.fromEntries(names.filter(name=>source[name]).map(name=>[name,source[name]]));
 if(home)env.CODEX_HOME=path.resolve(home);else if(source.CODEX_HOME)env.CODEX_HOME=source.CODEX_HOME;
 return env;
}
