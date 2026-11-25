// Explicit pre-consolidation fixtures use production historical hooks; never today's complete schema.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {migrate} from '../../server/database-migrations.ts';
import {makeStory} from './story.mjs';
export function historicalLibrary(directory,root=process.cwd(),through='0017_command_receipt_links.sql'){
 mkdirSync(directory,{recursive:true});const sqlite=new DatabaseSync(path.join(directory,'shiqu.sqlite'));
 migrate(sqlite,root,directory,through);sqlite.exec(readFileSync(path.join(root,'docker/seed.sql'),'utf8'));return sqlite;
}
export function insertStudio(sqlite,story=makeStory()){
 const fields={...story,pages:JSON.stringify(story.pages),checks:JSON.stringify(story.checks)};
 const names={bookId:'book_id',sourceText:'source_text',sourceUrl:'source_url',adaptationNote:'adaptation_note',createdAt:'created_at',updatedAt:'updated_at'};
 const entries=Object.entries(fields).filter(([key])=>!['actualCost','currency'].includes(key));
 sqlite.prepare(`INSERT INTO stories(${entries.map(([key])=>names[key]||key).join(',')}) VALUES(${entries.map(()=>'?').join(',')})`).run(...entries.map(([,value])=>value));
 return story;
}
