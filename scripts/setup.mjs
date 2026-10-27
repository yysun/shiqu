// Prepare checkout-local configuration without replacing an existing secret file.
// The setup script then installs the lockfile with the project's pinned pnpm release.
import {copyFileSync, constants, chmodSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

if (Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error(`Node 24 is required; see .nvmrc. Current version: ${process.versions.node}`);
}
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
try {
  copyFileSync('.env.example', '.env', constants.COPYFILE_EXCL);
  chmodSync('.env', 0o600);
  console.log('Created .env. Leave the Gemini key blank to read the sample.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Keeping existing .env.');
}
