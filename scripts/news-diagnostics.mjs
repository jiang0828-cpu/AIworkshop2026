import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
const url=process.env.DATABASE_URL||'file:../data/ai-workbench.db';
if(!url.startsWith('file:'))throw Error('Local only');
const db=new DatabaseSync(resolve('prisma',url.slice(5)),{readOnly:true});
db.exec('PRAGMA busy_timeout=5000');
try{
 console.log(db.prepare('PRAGMA journal_mode').get());
 console.log(db.prepare('SELECT maintenance,maintenanceUntil,heartbeat FROM DailyControl WHERE profileId=?').get('local-profile'));
 console.log(db.prepare("SELECT substr(id,1,27) AS job,status,slot,error,leaseUntilSeconds FROM ResearchBatch WHERE id LIKE 'news-%'").all());
}finally{db.close();}
