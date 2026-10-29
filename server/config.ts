// Keep runtime configuration on the server and preserve the legacy local owner identity.
import path from 'node:path';
export const localOwnerId='docker-local-owner';
export function serverConfig(variables:NodeJS.ProcessEnv=process.env){
 const port=Number(variables.PORT||3000);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be between 1 and 65535');
 return {port,host:variables.SHIQU_BIND_IP||'0.0.0.0',dataDirectory:path.resolve(variables.SHIQU_DATA_DIR||'./data'),ownerId:localOwnerId};
}
