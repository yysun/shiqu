// Share Node HTTP lifecycle while letting installed callers supply an immutable asset root.
import {createApplication} from './app.ts';
import {createHttpServer} from './http.ts';
import {serverConfig} from './config.ts';
import {phoneUrls,printPhoneAccess} from './phone-access.ts';
import {developmentAccess} from './development-access.ts';
import {desktopAccess} from './desktop-access.ts';
import {stopCodexProcesses} from './codex-runner.ts';

export function startServer({root, variables = process.env, localAccess = false}:{root:string;variables?:NodeJS.ProcessEnv;localAccess?:boolean}) {
  const config = serverConfig(variables);
  const app = createApplication({root, dataDirectory:config.dataDirectory, variables});
  const urls = phoneUrls(config.host, config.port);
  const handle = localAccess ? desktopAccess(app.handle, {hosts:[`localhost:${config.port}`,`127.0.0.1:${config.port}`,`[::1]:${config.port}`,...urls.map(url=>new URL(url).host)]}).handle
    : developmentAccess(app.handle, variables, config.port);
  const server = createHttpServer(handle);
  let stopping = false;
  async function closeApplication() {
    app.stopGeneration();
    await stopCodexProcesses();
    await app.close();
  }
  server.on('error', error => {
    console.error('Server failed:', error.message);
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    void closeApplication().then(()=>{process.exitCode = 1;});
  });
  function stop() {
    if (stopping) return;
    stopping = true;
    app.stopGeneration();
    const closed = new Promise<void>(resolve=>server.close(()=>resolve()));
    server.closeIdleConnections();
    void Promise.all([closed, stopCodexProcesses()]).then(()=>app.close()).then(()=>process.exit(0));
  }
  for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal, stop);
  server.listen(config.port, config.host, () => {
    const browserHost = config.host === '0.0.0.0' ? '127.0.0.1' : config.host === '::' ? '::1' : config.host;
    const host = browserHost.includes(':') ? `[${browserHost}]` : browserHost;
    console.log(`拾趣: http://${host}:${config.port} — data: ${config.dataDirectory}`);
    printPhoneAccess(urls);
  });
  return server;
}
