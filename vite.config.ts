import vinext from 'vinext';
import {defineConfig} from 'vite';
import {cloudflare} from '@cloudflare/vite-plugin';

// Standalone build: no Sites plugin, sign-in service or Cloudflare account needed.
export default defineConfig({
 plugins:[vinext(),cloudflare({
  viteEnvironment:{name:'rsc',childEnvironments:['ssr']},
  inspectorPort:false,
  config:{
   name:'shiqu-local',main:'./worker/index.ts',compatibility_date:'2026-05-15',compatibility_flags:['nodejs_compat'],
   d1_databases:[{binding:'DB',database_name:'shiqu-local',database_id:'00000000-0000-4000-8000-000000000000'}],
   r2_buckets:[{binding:'BUCKET',bucket_name:'shiqu-media'}],
  },
  persistState:{path:process.env.SHIQU_DATA_DIR||'/data'},
 })],
});
