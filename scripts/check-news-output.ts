import { PrismaClient } from "@prisma/client";
import { publishableNews } from "../src/lib/radar/news-shared";
import { z } from "zod";
import { revalidateNews } from "../src/lib/radar/news";
import { withDailyLock } from "../src/lib/daily/service";
const db=new PrismaClient();
async function main(){for(const b of await db.researchBatch.findMany({where:{id:{startsWith:"news-"},profileId:"local-profile",status:"failed"}})){
  const r=await db.radarRecord.findUnique({where:{id:b.id}});if(!r)continue;const p=JSON.parse(r.payload),calls=JSON.parse(b.calls),out=calls.findLast((c:{output?:string})=>c.output)?.output;
  if(!out){console.log({column:p.column,stage:p.stage,models:p.modelCount,outputSaved:false});continue;}
  try{const result=publishableNews(JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g,"")),p.sources,p.cutoff);if(process.argv.includes("--repair"))await withDailyLock(db,()=>revalidateNews(db,{id:b.id}));console.log({column:p.column,validItems:result.items.length,republishedWithoutProviderCall:process.argv.includes("--repair")});}
  catch(e){console.log({column:p.column,issues:e instanceof z.ZodError?e.issues.map(i=>({path:i.path,code:i.code})):"Unparseable or invalid citation"});}
}}
main().finally(()=>db.$disconnect());
