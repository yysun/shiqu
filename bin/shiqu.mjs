#!/usr/bin/env node
// Check the supported runtime before loading dependencies that require Node's SQLite API.
import {constants, accessSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

if (Number(process.versions.node.split('.')[0]) !== 24) {
  console.error(`shiqu requires Node 24 (recommended: 24.22.1); found ${process.versions.node}.`);
  process.exitCode = 1;
} else {
  try {
    const {runCli} = await import('../dist/server/cli.js');
    const root = fileURLToPath(new URL('../', import.meta.url));
    const args = process.argv.slice(2);
    // 此 worktree 的搜索命令优先使用实验索引，显式目录仍由 CLI 处理。
    if (args[0] === 'books' && args[1] === 'search' && !process.env.SHIQU_DATA_DIR) {
      const localDirectory = new URL('../.data/dev-local/', import.meta.url);
      for (const index of ['story-indexes/', 'story-search.sqlite']) {
        try {
          accessSync(new URL(index, localDirectory), constants.R_OK);
          process.env.SHIQU_DATA_DIR = fileURLToPath(localDirectory);
          break;
        } catch {
          // 继续检查另一个索引位置。
        }
      }
    }
    await runCli(root, args);
  } catch (error) {
    console.error(`shiqu: ${error instanceof Error ? error.message : 'Startup failed'}`);
    process.exitCode = 1;
  }
}
