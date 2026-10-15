import { writeFileSync } from 'node:fs';
const origin = 'http://localhost:3012';
let cookie = '';
async function api(resource, body) {
  const response = await fetch(`${origin}/api/situation/${resource}`, {method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
  const data = await response.json(); if(!response.ok)throw Error(data.error || `HTTP ${response.status}`); return data;
}
async function enqueue(mode, topicId, informationIds=[]) {
  const input={requestId:crypto.randomUUID(),mode,topicId,question:'核对公开的精准医疗监管资料，区分事实和仍待核实事项。',queries:mode==='collect'?['site.nmpa.gov.cn 伴随诊断 指导原则']:[],informationIds,selected:[],days:0};
  const preview=await api('preview',input); const job=await api('jobs',{...input,preview:JSON.stringify(preview)});
  console.log(JSON.stringify({stage:mode,jobId:job.id,status:'queued'}));
  for(let i=0;i<90;i++){
    const jobs=await api('jobs');const row=jobs.rows.find(r=>r.id===job.id);
    if(row?.execution?.status==='failed')throw Error(`${mode}: ${row.execution.error}`);
    if(row?.payload.published)return row;
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw Error(`${mode}: 超时，保留任务以便检查，未自动重试`);
}
try {
  if(process.env.APP_AUTH_EMAIL&&process.env.APP_AUTH_PASSWORD){const r=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email:process.env.APP_AUTH_EMAIL,password:process.env.APP_AUTH_PASSWORD})});if(!r.ok)throw Error('本地认证失败');cookie=r.headers.get('set-cookie').split(';')[0];}
  const config=await api('context');if(!config.searchConfigured||!config.aiConfigured)throw Error('服务配置未生效');
  const topic=await api('topic',{requestId:crypto.randomUUID(),title:'真实联网联调 · 公开监管资料',payload:{question:'验证 Tavily 与 DeepSeek 的真实来源闭环',dimension:'政策监管'}});
  const collected=await enqueue('collect',topic.id);
  const information=await api(`information?topic=${topic.id}`);
  const usable=information.rows.filter(r=>r.payload.source.content.trim());if(!usable.length)throw Error('没有取得可用正文或摘要');
  console.log(JSON.stringify({stage:'collect',sources:usable.length,qualities:usable.map(r=>r.payload.source.quality),calls:JSON.parse(collected.execution.calls)}));
  const analyzed=await enqueue('analyze',topic.id,usable.slice(0,2).map(r=>r.id));
  const drafts=await api(`analysis?topic=${topic.id}`);if(!drafts.rows.length)throw Error('未产生分析草稿');
  const result={at:new Date().toISOString(),topicId:topic.id,sourceCount:usable.length,sources:usable.map(r=>({title:r.title,url:r.payload.source.url,quality:r.payload.source.quality})),draftCount:drafts.rows.length,collectCalls:JSON.parse(collected.execution.calls),analysisCalls:JSON.parse(analyzed.execution.calls),url:`${origin}/?section=situation&tab=analyze&topic=${topic.id}`,confirmed:false};
  writeFileSync('data/radar-live-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(e){console.error(e.message);process.exitCode=1;}
