// Keep framework tooling logs in this checkout and disable background telemetry/fetches.
import {fileURLToPath} from 'node:url';

process.env.WRANGLER_LOG_PATH ||= fileURLToPath(new URL('../.wrangler/logs', import.meta.url));
process.env.WRANGLER_SEND_METRICS = 'false';
process.env.CLOUDFLARE_CF_FETCH_ENABLED = 'false';
