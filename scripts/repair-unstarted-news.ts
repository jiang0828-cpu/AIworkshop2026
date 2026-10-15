// One-time recovery for jobs seen by the previous scheduler before its restart.
import { PrismaClient } from "@prisma/client";
const db=new PrismaClient();
async function main(){
  const runs=await db.radarRecord.findMany({where:{profileId:"local-profile",kind:"newsRun"}});let count=0;
  for(const run of runs){const p=JSON.parse(run.payload);if(p.modelCount||p.searchCount||p.stage!=="plan")continue;
    const changed=await db.researchBatch.updateMany({where:{id:run.id,profileId:"local-profile",status:"failed",calls:"[]",error:"没有可分析的资料。请补充正文，或调整检索词新建一轮。"},data:{status:"queued",error:"",gaps:"",slot:null,leaseToken:null,leaseUntilSeconds:null,version:{increment:1}}});
    if(changed.count){count++;await db.radarRecord.deleteMany({where:{profileId:"local-profile",id:{in:[`radar-history-${run.id}`,`radar-topic-${run.id}`]},kind:{in:["history","topic"]},version:1}});}
  }console.log({requeuedBeforeAnyProviderCall:count});
}
main().finally(()=>db.$disconnect());
