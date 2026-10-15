import { PrismaClient } from "@prisma/client";
import { updateResearch } from "../src/lib/research/service";
import { withDailyLock } from "../src/lib/daily/service";
const db=new PrismaClient();
async function main(){
  const rows=await db.researchBatch.findMany({where:{profileId:"local-profile",id:{startsWith:"news-"},status:"failed",error:{startsWith:"执行中断"}}});
  for(const row of rows){
    const calls=JSON.parse(row.calls);if(calls.some((c:{status:string})=>c.status==="running")&&!process.argv.includes("--include-uncertain")){console.log({id:row.id,skipped:"uncertain provider request"});continue;}
    await withDailyLock(db,async()=>{await db.researchBatch.updateMany({where:{id:row.id,version:row.version,status:"failed"},data:{calls:JSON.stringify(calls.map((c:{status:string})=>c.status==="running"?{...c,status:"failed",interrupted:true}:c))}});return updateResearch(db,"retry",{id:row.id,version:row.version});});console.log({id:row.id,resumedWithPriorAttemptsStillCounted:true});
  }
}
main().finally(()=>db.$disconnect());
