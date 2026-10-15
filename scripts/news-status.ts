import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
const db=new PrismaClient();
async function main(){
  const rows=await db.radarRecord.findMany({where:{profileId:"local-profile",kind:"newsRun"},orderBy:{createdAt:"asc"}});
  const result=[];
  for(const row of rows){const p=JSON.parse(row.payload),b=await db.researchBatch.findUnique({where:{id:row.id}}),calls=JSON.parse(b?.calls||"[]");result.push({id:row.id,date:p.date,column:p.column,cutoff:p.cutoff,status:b?.status,stage:p.stage,sources:p.sources.length,items:p.items.length,current:p.items.filter((i:{timeliness:string})=>i.timeliness==="current").length,models:p.modelCount,searches:p.searchCount,error:b?.error,gaps:p.gaps,calls});}
  if(process.argv.includes("--report"))writeFileSync("data/daily-news-live-report.json",JSON.stringify({checkedAt:new Date().toISOString(),runs:result},null,2));
  console.log(JSON.stringify(result.map(({calls,...row})=>({...row,calls:calls.length})),null,2));
}
main().finally(()=>db.$disconnect());
