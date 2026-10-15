"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button, type Row } from "../Shared";

export default function AnalysisSources({selected,onChange,sceneId,topicId}:{selected:Row[];onChange:(rows:Row[])=>void;sceneId:string|null;topicId:string|null}){
  const [kind,setKind]=useState("information"),[page,setPage]=useState(1),[data,setData]=useState<Row|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setData(null);setError("");
    const params=new URLSearchParams({page:String(page),scene:sceneId||"all",topic:topicId||""});
    void fetch(`/api/situation/${kind}?${params}`,{signal:controller.signal,cache:"no-store"}).then(async response=>{
      const value=await response.json();if(!response.ok)throw Error(value.error||"无法读取资料");if(!controller.signal.aborted)setData(value);
    }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"无法读取资料");});
    return()=>controller.abort();
  },[kind,page,sceneId,topicId,retry]);
  return <section aria-label="选择研判资料" className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><strong>已选 {selected.length}/15 条</strong><Button disabled={!selected.length} onClick={()=>onChange([])}>清空选择</Button></div>
    {!!selected.length&&<ul className="space-y-1">{selected.map(row=><li key={row.id} className="flex items-start gap-2 text-xs"><span className="min-w-0 flex-1 break-words">{row.title}</span><button type="button" title="移除所选资料" aria-label={`移除资料 ${row.title}`} onClick={()=>onChange(selected.filter(s=>s.id!==row.id))} className="shrink-0 p-1"><X size={14}/></button></li>)}</ul>}
    <div role="group" aria-label="资料类型" className="flex flex-wrap gap-1">{[["information","信息卡"],["analysis","分析稿"],["judgement","研判卡"]].map(([value,label])=><button key={value} type="button" aria-pressed={kind===value} onClick={()=>{setKind(value);setPage(1);}} className={`min-h-9 border-b-2 px-3 py-2 text-xs ${kind===value?"border-sage text-sage":"border-transparent text-slate-500"}`}>{label}</button>)}</div>
    {error?<p role="alert" className="text-xs text-red-700">{error} <Button onClick={()=>setRetry(retry+1)}>重试</Button></p>:!data?<p role="status" className="text-xs">正在读取资料…</p>:<>
      <div className="max-h-52 divide-y divide-line overflow-y-auto border-y border-line">{data.rows.length?data.rows.map((row:Row)=><label key={row.id} className="flex items-start gap-2 py-3 text-xs"><input type="checkbox" className="mt-0.5 !w-auto shrink-0" aria-label={`选入研判 ${row.title}`} checked={selected.some(s=>s.id===row.id)} disabled={selected.length>=15&&!selected.some(s=>s.id===row.id)} onChange={e=>onChange(e.target.checked?[...selected,{id:row.id,title:row.title,kind:row.kind}]:selected.filter(s=>s.id!==row.id))}/><span className="min-w-0 break-words">{row.title}</span></label>):<p className="py-3 text-xs text-slate-500">当前场景和主题下暂无此类资料。</p>}</div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>{data.total} 条 · 第 {page} 页</span><div className="flex gap-2"><Button disabled={page<=1} onClick={()=>setPage(page-1)}>上一页资料</Button><Button disabled={page*data.size>=data.total} onClick={()=>setPage(page+1)}>下一页资料</Button></div></div>
    </>}
  </section>;
}
