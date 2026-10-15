import { z } from "zod";
import { sourceSchema } from "../research/shared";
export const columns = [
  ["politics", "最新时政", "国内与国际分别覆盖政治发展、经济金融、社会民生保障、产业行业、文化体育"],
  ["economy", "经济资讯", "社会经济、金融投资、商业产业、生产要素（第一二三产业）、商业发展"],
  ["industry", "产业发展", "国际国内农业、工业、服务业，从政策、经济、需求、技术、企业等层面收集具体新闻"],
  ["science", "科学技术", "自然科学（物理、化学、生物）、军事科技、工业制造、能源、新材料、医药和日常生活应用的研究与应用进展"],
  ["agi", "AGI工具", "国际国内AI、人工智能、大语言模型、硬件、软件、数据库；政策、资本、基础设施、场景应用和行业活动"],
  ["health", "行业前沿", "国际国内健康医疗、医药、慢病诊疗、精准医学、药物与器械；监管、临床诊疗、研究、技术、产品服务"],
  ["track1", "赛道1 · 精准诊疗", "精准诊疗及科研业务：政策监管、经济投资、科学研究、技术突破、上下游进展、竞品产品服务"],
  ["track2", "赛道2 · 全案科研", "生命科学与医学全案科研服务平台：国家政策、行业资讯、科学进展、科研服务、职业发展"],
  ["b", "B端 · 企业经营", "精准医疗企业高层管理人员，市场营销与医学事务：政策监管、商业动态、客户需求、业务运营、营销推广"],
  ["c", "C端 · 患者与家属", "糖尿病及肿瘤患者与家属：诊疗进展、新药、就医路径、医保政策、日常护理、患友交流、指南、病理解析"],
  ["d", "D端 · 医生与科研", "肿瘤科医生与科研工作者：医学会议、科研进展、门诊排班、院内治疗、患者接待、绩效、医疗政策和医患关系；不得虚构个人排班"],
] as const;
export const columnId = z.enum(["politics","economy","industry","science","agi","health","track1","track2","b","c","d"]);
export const columnConfig = z.object({ id: columnId, enabled: z.boolean(), prompt: z.string().trim().min(10).max(6000) });
export const newsConfigSchema = z.object({ enabled: z.boolean(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), columns: z.array(columnConfig).length(11) }).refine(v => new Set(v.columns.map(c=>c.id)).size===11,"栏目不可重复");
export const defaultNewsConfig = () => newsConfigSchema.parse({ enabled:true,time:"05:00",columns:columns.map(([id,,scope])=>({id,enabled:true,prompt:`{date}最新资讯：${scope}。列举有来源的最新消息，逐条解读影响与意义，优先热点与重大变化。`})) });
export const newsSourceSchema = sourceSchema.extend({ publishedTime: z.string().nullable().default(null) });
export type NewsSource = z.infer<typeof newsSourceSchema>;
export const toolCommand = z.discriminatedUnion("name", [z.object({ name:z.literal("search_public_web"),query:z.string().trim().min(2).max(180) }),z.object({ name:z.literal("extract_public_page"),sourceId:z.string().min(1).max(300) })]);
export const newsItemSchema = z.object({ title:z.string().min(1).max(300),facts:z.string().min(1).max(2000),impact:z.string().max(2000),reason:z.string().max(1000),section:z.string().max(100),eventDate:z.string().date().nullable().default(null),uncertainty:z.string().max(2000),citations:z.array(z.object({sourceId:z.string(),quote:z.string().min(1).max(1200)})).min(1).max(5) });
export const newsOutputSchema = z.object({ items:z.array(newsItemSchema).max(20),gaps:z.string().max(8000) });
export const newsRunSchema = z.object({ batchId:z.string(),column:columnId,date:z.string().date(),cutoff:z.string().datetime(),prompt:z.string(),stage:z.enum(["plan","search","check","extract","final","done"]).default("plan"),mode:z.enum(["native","structured"]).default("native"),modelCount:z.number().int().min(0).max(3).default(0),searchCount:z.number().int().min(0).max(10).default(0),pending:z.array(toolCommand).max(12).default([]),sources:z.array(newsSourceSchema).max(100).default([]),items:z.array(newsItemSchema.extend({timeliness:z.enum(["current","unknown","background"])})).max(20).default([]),gaps:z.string().max(8000).default(""),published:z.boolean().default(false),automaticRetries:z.number().int().min(0).max(1).default(0),retryAt:z.string().datetime().nullable().default(null) });
export const limits={search:80,extract:20,model:36} as const;
export const newsUsageSchema=z.object({ date:z.string().date(),search:z.number().int().min(0).max(limits.search),extract:z.number().int().min(0).max(limits.extract),model:z.number().int().min(0).max(limits.model) });
export function recoverableNewsError(error:string) {
  return /^AI 服务返回 HTTP (429|502|503|504)$/.test(error)||error==="AI 调用超时，请确认服务状态后重试";
}
export function canRetryNews(error:string,p:z.infer<typeof newsRunSchema>) {
  return recoverableNewsError(error)&&!p.published&&p.automaticRetries<1&&p.modelCount<3&&["plan","check","final"].includes(p.stage)&&(p.stage!=="plan"||p.modelCount<2);
}
// Editorial ordering only: observable metadata, never a popularity or truth score.
export function newsScore(item:{timeliness:string;citations:Array<{sourceId:string}>},sources:NewsSource[]) {
  const cited=sources.filter(s=>item.citations.some(c=>c.sourceId===s.id));
  const freshness=item.timeliness==="current"?40:item.timeliness==="unknown"?0:10;
  const traceable=cited.some(s=>s.url)?30:0;
  const body=cited.some(s=>s.quality==="text")?20:0;
  const dated=cited.some(s=>s.publishedTime||s.publishedAt)?10:0;
  return {total:freshness+traceable+body+dated,freshness,traceable,body,dated};
}
export function timeliness(source:NewsSource,cutoff:string) {
  if(!source.publishedTime||!/[T:]|GMT|UTC/.test(source.publishedTime))return "unknown" as const;
  const t=Date.parse(source.publishedTime),end=Date.parse(cutoff);
  if(!Number.isFinite(t)||t>end)return "unknown" as const;
  return t>=end-86400000 ? "current" as const : "background" as const;
}
export function validateNews(output:unknown,sources:NewsSource[],cutoff:string) {
  const parsed=newsOutputSchema.parse(output),normalize=(s:string)=>s.replace(/\s+/g,"").toLowerCase();
  return {...parsed,items:parsed.items.map(item=>{
    const cited=item.citations.map(c=>{const s=sources.find(s=>s.id===c.sourceId);if(!s||!normalize(s.content).includes(normalize(c.quote)))throw Error("资讯来源或支持摘录无法核对");return s;});
    if(/https?:\/\//i.test(JSON.stringify({...item,citations:[]})))throw Error("资讯不得自行生成链接");
    const oldEvent=item.eventDate&&item.eventDate<new Date(Date.parse(cutoff)-86400000).toLocaleDateString("en-CA",{timeZone:"Asia/Shanghai"});
    return {...item,timeliness:oldEvent?"background" as const:cited.some(s=>timeliness(s,cutoff)==="current")?"current" as const:cited.some(s=>timeliness(s,cutoff)==="unknown")?"unknown" as const:"background" as const};
  })};
}
export function scheduledToday(now:Date,time:string) { return new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hour12:false}).format(now)>=time; }

export function publishableNews(output:unknown,sources:NewsSource[],cutoff:string){
  const parsed=z.object({items:z.array(z.unknown()).max(20),gaps:z.string().max(8000)}).parse(output),items:ReturnType<typeof validateNews>["items"]=[];let rejected=0;
  for(const candidate of parsed.items){
    const checked=newsItemSchema.safeParse(candidate);if(!checked.success){rejected++;continue;}const item=checked.data;
    const citations=item.citations.map(c=>{const alias=/^S([1-9]\d*)$/.exec(c.sourceId);return {...c,sourceId:alias?sources[Number(alias[1])-1]?.id||c.sourceId:c.sourceId};});
    try{items.push(...validateNews({items:[{...item,citations}],gaps:""},sources,cutoff).items);}catch{rejected++;}
  }
  return {items,gaps:(parsed.gaps+(rejected?` 已拦截 ${rejected} 条字段、来源或摘录无法核对的候选资讯。`:"")).slice(0,8000)};
}
