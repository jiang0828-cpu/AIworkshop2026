import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
const url=process.env.DATABASE_URL||'file:../data/ai-workbench.db';
if(!url.startsWith('file:'))throw Error('Local only');
const path=resolve('prisma',url.slice(5)),db=new DatabaseSync(path);
try{db.exec('PRAGMA busy_timeout=15000');db.prepare('VACUUM INTO ?').run(`${path}.before-news-wal-${Date.now()}.db`);console.log(db.prepare('PRAGMA journal_mode=WAL').get());}finally{db.close();}
