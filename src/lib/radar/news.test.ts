import { describe,it,expect } from "vitest";
import { defaultNewsConfig,newsConfigSchema,newsSourceSchema,scheduledToday,timeliness,validateNews,publishableNews,toolCommand,newsScore,newsRunSchema,canRetryNews } from "./news-shared";
import { mergeNewsSources, newsFinalSources } from "./news-worker";
import { pauseRestoredNews } from "./news";
const cutoff="2026-10-05T23:00:00.000Z";
const source=newsSourceSchema.parse({id:"S1",title:"公告",url:"https://example.com/news",publisher:"机构",content:"研究仍处于临床前阶段，不能推断治疗获益。",collectedAt:cutoff,publishedAt:"2026-10-05",publishedTime:"2026-10-05T10:00:00Z",quality:"text",group:"original"});
const item={title:"研究进展",facts:"临床前研究",impact:"仍需临床验证",reason:"原始公告",section:"医药",eventDate:null,uncertainty:"证据有限",citations:[{sourceId:"S1",quote:"研究仍处于临床前阶段"}]};
describe("每日资讯规则",()=>{
  it("大批来源的整理上下文有界，保留全部来源编号与原始正文",()=>{
    const sources=Array.from({length:100},(_,i)=>({...source,id:`source-${i}`,content:"原始事实".repeat(1000)}));
    const context=newsFinalSources(sources);
    expect(context).toHaveLength(100);
    expect(context.reduce((n,s)=>n+s.content.length,0)).toBeLessThanOrEqual(48000);
    expect(context.map(s=>s.id)).toEqual(sources.map((_,i)=>`S${i+1}`));
    expect(context.every((s,i)=>sources[i].content.startsWith(s.content))).toBe(true);
    expect(sources[0].content).toHaveLength(4000);
    expect(newsFinalSources([])).toEqual([]);
  });
  it("临时HTTP错误及超时最多自动续跑一次，不重试未知中断、校验失败或耗尽轮次",()=>{
    const p=newsRunSchema.parse({batchId:"test",column:"politics",date:"2026-10-15",cutoff,prompt:"test",modelCount:1});
    for(const code of [429,502,503,504])expect(canRetryNews(`AI 服务返回 HTTP ${code}`,p)).toBe(true);
    expect(canRetryNews("AI 服务返回 HTTP 503",{...p,stage:"check",modelCount:2})).toBe(true);
    expect(canRetryNews("AI 调用超时，请确认服务状态后重试",{...p,stage:"final"})).toBe(true);
    for(const error of ["AI 服务返回 HTTP 401","TimeoutError","执行中断","资讯来源或支持摘录无法核对"])expect(canRetryNews(error,p)).toBe(false);
    for(const change of [{automaticRetries:1},{published:true},{modelCount:3},{modelCount:2},{stage:"search" as const}])expect(canRetryNews("AI 服务返回 HTTP 503",{...p,...change})).toBe(false);
  });
  it("评分根据已取得资料，缺失和摘要不冒充完整报道，重复引用不加分",()=>{
    const news={...item,timeliness:"current"};
    expect(newsScore(news,[source]).total).toBe(100);
    expect(newsScore({...news,citations:[...item.citations,...item.citations]},[source]).total).toBe(100);
    expect(newsScore({...news,timeliness:"unknown"},[{...source,quality:"snippet",publishedTime:null,publishedAt:null}]).total).toBe(30);
    expect(newsScore(news,[]).total).toBe(40);
  });
  it("覆盖11栏，提前05:00启动，模板可编辑但栏目不可重复",()=>{const c=defaultNewsConfig();expect(c.columns).toHaveLength(11);expect(c.time).toBe("05:00");expect(c.columns.every(v=>v.prompt.includes("{date}"))).toBe(true);c.columns[1]=c.columns[0];expect(newsConfigSchema.safeParse(c).success).toBe(false);});
  it("上海07:00边界",()=>{expect(scheduledToday(new Date("2026-10-05T22:59:59Z"),"07:00")).toBe(false);expect(scheduledToday(new Date(cutoff),"07:00")).toBe(true);});
  it("24小时、未知日期、无时刻日期、未来及旧闻",()=>{expect(timeliness(source,cutoff)).toBe("current");expect(timeliness({...source,publishedTime:null},cutoff)).toBe("unknown");expect(timeliness({...source,publishedTime:"2026-10-05"},cutoff)).toBe("unknown");expect(timeliness({...source,publishedTime:"2026-10-06T01:00:00Z"},cutoff)).toBe("unknown");expect(timeliness({...source,publishedTime:"2026-10-04T22:59:59Z"},cutoff)).toBe("background");});
  it("拒绝伪造ID、摘录和生成链接",()=>{expect(validateNews({items:[item],gaps:""},[source],cutoff).items[0].timeliness).toBe("current");for(const invalid of [{...item,citations:[{sourceId:"fake",quote:"研究"}]},{...item,citations:[{sourceId:"S1",quote:"已治愈所有患者"}]},{...item,impact:"https://fake.example"}])expect(()=>validateNews({items:[invalid],gaps:""},[source],cutoff)).toThrow();});
  it("新文章谈旧事件只作背景",()=>{expect(validateNews({items:[{...item,eventDate:"2026-09-01"}],gaps:""},[source],cutoff).items[0].timeliness).toBe("background");});
  it("逐条拦截坏引用，不影响已核对资讯，短编号只映射本次来源",()=>{const output=publishableNews({items:[item,{...item,citations:[{sourceId:"S999",quote:"伪造引用"}]}],gaps:""},[source],cutoff);expect(output.items).toHaveLength(1);expect(output.gaps).toContain("拦截 1 条");});
  it("日期格式异常只拒绝该条候选，不把未知时间补成采集时间",()=>{const output=publishableNews({items:[item,{...item,eventDate:"最近"}],gaps:""},[source],cutoff);expect(output.items).toHaveLength(1);expect(output.items[0].eventDate).toBe(null);expect(output.gaps).toContain("拦截 1 条");});
  it("同URL复用，转载归组",()=>{expect(mergeNewsSources([source],[source])).toHaveLength(1);const rows=mergeNewsSources([{...source,group:"original"}],[{...source,id:"S2",url:"https://other.example/news"}]);expect(rows[1].group).toBe("original");});
  it("工具权限不能由正文扩展",()=>{expect(toolCommand.safeParse({name:"run_code",query:"delete"}).success).toBe(false);expect(toolCommand.safeParse({name:"search_public_web",query:"x".repeat(181)}).success).toBe(false);});
  it("恢复暂停定时与未完成任务",()=>{expect(JSON.parse(pauseRestoredNews({kind:"newsConfig",payload:JSON.stringify(defaultNewsConfig()),status:"draft"}).payload).enabled).toBe(false);expect(pauseRestoredNews({kind:"newsRun",payload:'{"published":false}',status:"queued"}).status).toBe("failed");});
});
