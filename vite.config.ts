// Share Worker bindings with local migration tools; keep development data checkout-local.
import path from 'node:path';
import vinext from 'vinext';
import {defineConfig} from 'vite';
import {cloudflare} from '@cloudflare/vite-plugin';

// Standalone build: no Sites plugin, sign-in service or Cloudflare account needed.
export default defineConfig({
 plugins:[vinext(),cloudflare({
  viteEnvironment:{name:'rsc',childEnvironments:['ssr']},
  inspectorPort:false,
  configPath:'./wrangler.json',
  persistState:{path:path.resolve(process.env.SHIQU_DATA_DIR||'.data/dev')},
 })],
 server:{strictPort:true},
});
