// Explicit local operator action: a new interpretation round, no new search.
import { PrismaClient } from "@prisma/client";
import { refinishNews } from "../src/lib/radar/news";
import { withDailyLock } from "../src/lib/daily/service";
const db=new PrismaClient();
async function main(){
  const column=process.argv[2];if(!["politics","economy"].includes(column))throw Error("Specify politics or economy");
  const rows=await db.radarRecord.findMany({where:{profileId:"local-profile",kind:"newsRun"},orderBy:{createdAt:"desc"}});
  const row=rows.find(r=>JSON.parse(r.payload).column===column);if(!row)throw Error("No source round");
  console.log(await withDailyLock(db,()=>refinishNews(db,{id:row.id,requestId:crypto.randomUUID()})));
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Unable to queue");process.exitCode=1;}).finally(()=>db.$disconnect());
