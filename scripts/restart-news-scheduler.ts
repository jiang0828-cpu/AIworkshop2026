import { PrismaClient } from "@prisma/client";
import { spawn,execFileSync } from "node:child_process";
import { openSync } from "node:fs";
import { withDailyLock } from "../src/lib/daily/service";
const db=new PrismaClient(),pid=Number(process.argv[2]);
async function main(){
  if(!Number.isSafeInteger(pid)||pid<=0)throw Error("Expected scheduler process ID");
  const command=execFileSync("powershell.exe",["-NoProfile","-Command",`(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`],{encoding:"utf8",windowsHide:true});
  if(!command.includes("scripts/daily-scheduler.ts"))throw Error("Process is not the local scheduler");
  await withDailyLock(db,async()=>{
    const end=Date.now()+175000;
    while(await db.researchBatch.count({where:{slot:{not:null}}})||await db.dailyRun.count({where:{slot:{not:null}}})){
      if(Date.now()>end)throw Error("Active request has not finished; scheduler left running");
      await new Promise(r=>setTimeout(r,500));
    }
    process.kill(pid);
    const out=openSync("data/news-scheduler.log","a"),err=openSync("data/news-scheduler-error.log","a");
    const child=spawn(process.execPath,["--env-file=.env","--import","tsx","scripts/daily-scheduler.ts"],{cwd:process.cwd(),windowsHide:true,detached:true,stdio:["ignore",out,err]});child.unref();console.log({schedulerPid:child.pid,restartedBetweenRequests:true});
  });
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
