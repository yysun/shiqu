#!/usr/bin/env node
// Check the supported runtime before loading dependencies that require Node's SQLite API.
import {fileURLToPath} from 'node:url';

if (Number(process.versions.node.split('.')[0]) !== 24) {
  console.error(`shiqu requires Node 24 (recommended: 24.22.1); found ${process.versions.node}.`);
  process.exitCode = 1;
} else {
  try {
    const {runCli} = await import('../dist/server/cli.js');
    await runCli(fileURLToPath(new URL('../', import.meta.url)));
  } catch (error) {
    console.error(`shiqu: ${error instanceof Error ? error.message : 'Startup failed'}`);
    process.exitCode = 1;
  }
}
