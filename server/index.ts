// Run one local Node process; schema and book metadata initialization finish before listening.
import {startServer} from './start.ts';
await startServer({root:process.cwd()});
