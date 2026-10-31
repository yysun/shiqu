// Run one local Node process; schema and book metadata initialization finish before listening.
import {startServer} from './start.ts';
startServer({root:process.cwd()});
