"use client";
import { Field, SceneSelect, type Row, type ModuleProps } from "../Shared";
import { RadarFields } from "../RadarCard";
import { focusPresets } from "@/lib/research/radar";
export default function RadarEditor({ draft, setDraft, props, topics }: { draft: Row; setDraft: (value: Row) => void; props: ModuleProps; topics: Row[] }) {
  const p = draft.payload;
  const set = (key: string, value: unknown) => setDraft({ ...draft, payload: { ...p, [key]: value } });
  const field = (key: string, label: string, required = false) => <Field key={key} label={label}><textarea required={required} rows={2} maxLength={12000} value={String(p[key] || "")} onChange={(e) => set(key, e.target.value)} /></Field>;
  const select = (key: string, label: string, values: string[]) => <Field label={label}><select value={p[key]} onChange={(e) => set(key, e.target.value)}>{values.map((s) => <option key={s}>{s}</option>)}</select></Field>;
  const date = (key: string, label: string) => <Field label={label}><input type="date" value={p[key] || ""} onChange={(e) => set(key, e.target.value)} /></Field>;
  return <>
    <Field label="标题"><input required maxLength={300} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
    {["topic", "information", "analysis"].includes(draft.kind) && <div className="grid gap-3 sm:grid-cols-2"><Field label="场景"><SceneSelect view={props.data?.strategy} value={draft.sceneId || ""} onChange={(value) => setDraft({ ...draft, sceneId: value || null })} /></Field>{draft.kind !== "topic" && <Field label="关注主题"><select value={draft.topicId || ""} onChange={(e) => setDraft({ ...draft, topicId: e.target.value || null })}><option value="">未关联主题</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></Field>}</div>}
    {draft.kind === "topic" && <>{field("question", "关注问题", true)}{select("dimension", "信息维度", ["待分类", ...focusPresets.map((x) => x.label)])}{date("reviewDate", "复查日期")}</>}
    {draft.kind === "information" && <>
      {p.observation&&<div className="space-y-3 rounded border border-line p-3"><p className="text-xs">周遭变化：观察与推测分开写，听闻不等于事实。记录默认保存在本地，AI分析需另行预览确认。</p><Field label="信息性质"><select value={p.observation.nature} onChange={e=>set("observation",{...p.observation,nature:e.target.value})}>{["亲眼观察","亲身经历","他人转述","小道消息"].map(v=><option key={v}>{v}</option>)}</select></Field><Field label="发生／听闻日期"><input type="date" value={p.observation.occurredOn} onChange={e=>set("observation",{...p.observation,occurredOn:e.target.value})}/></Field>{[["signal","可能反映什么变化（推测）"],["alternative","还有哪些其他解释"],["nextCheck","下一步核实什么／继续观察什么"]].map(([key,label])=><Field key={key} label={label}><textarea rows={2} maxLength={12000} value={p.observation[key]} onChange={e=>set("observation",{...p.observation,[key]:e.target.value})}/></Field>)}</div>}
      <Field label="来源正文"><textarea required={!p.source.url} rows={5} maxLength={16000} value={p.source.content} onChange={(e) => set("source", { ...p.source, content: e.target.value, quality: "manual" })} placeholder="只记录原文或访谈事实。也可先保存公开网页链接，再选择信息卡提取正文。" /></Field>
      {field("facts", "事实摘录")}{field("notes", "个人备注（与事实分开）")}
      <Field label="来源链接（可选）"><input type="url" value={p.source.url || ""} onChange={(e) => set("source", { ...p.source, url: e.target.value || null })} /></Field>
      <Field label="发布机构／访谈来源"><input maxLength={300} value={p.source.publisher} onChange={(e) => set("source", { ...p.source, publisher: e.target.value })} /></Field>
      <Field label="发布日期（未知留空）"><input type="date" value={p.source.publishedAt || ""} onChange={(e) => set("source", { ...p.source, publishedAt: e.target.value || null })} /></Field>
      {select("verification", "核验状态", ["待核验", "已核验", "存疑"])}<p className="text-xs text-slate-500">修改已保存信息会创建新快照，既有引用不变。相同资料可从列表复用。</p>
    </>}
    {draft.kind === "analysis" && <>
      {([ ["facts", "事实摘要"], ["relevance", "影响分析（推断）"], ["nextStep", "下一步建议"], ["uncertainty", "不确定性与待核实问题"] ] as const).map(([key, label]) => <Field key={key} label={label}><textarea required={key === "facts"} rows={3} maxLength={key === "nextStep" ? 2000 : key === "uncertainty" ? 3000 : 4000} value={p.conclusion[key]} onChange={(e) => set("conclusion", { ...p.conclusion, [key]: e.target.value })} /></Field>)}
      <Field label="证据情况"><select value={p.conclusion.evidence} onChange={(e) => set("conclusion", { ...p.conclusion, evidence: e.target.value })}>{["原始来源支持", "多源一致", "单一来源", "存在分歧", "资料不足"].map((s) => <option key={s}>{s}</option>)}</select></Field>
      <details><summary className="cursor-pointer text-sm text-sage">趋势、置信度、个人影响与观察指标</summary><div className="mt-3"><RadarFields value={p.conclusion.radar} onChange={(radar) => set("conclusion", { ...p.conclusion, radar })} /></div></details>
      <details><summary className="cursor-pointer text-sm text-sage">引用资料与支持摘录</summary><div className="mt-3 space-y-2">{p.sources.map((s: Row) => { const citation = p.conclusion.citations.find((c: Row) => c.sourceId === s.id); return <div key={s.id} className="border-b border-line pb-2 text-xs"><p>{s.title} · {s.publishedAt || "发布日期未知"}</p><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-sans">{s.content}</pre><Field label={`支持摘录：${s.title}`}><textarea maxLength={1200} value={citation?.quote || ""} onChange={(e) => set("conclusion", { ...p.conclusion, citations: [...p.conclusion.citations.filter((c: Row) => c.sourceId !== s.id), ...(e.target.value.trim() ? [{ sourceId: s.id, quote: e.target.value }] : [])] })} /></Field></div>; })}</div></details>
      {field("gaps", "信息缺口")}
    </>}
    {draft.kind === "response" && <>
      <p className="text-xs text-slate-500">{p.purpose === "verify" ? "核实／观察任务，不代表执行应变。" : "正式应变建议须人工确认依据与置信度。"} 保存草稿不会创建执行任务。</p>
      {field("proposal", "建议与依据", true)}
      {p.purpose !== "verify" && <>{select("category", "应变类别", ["方向", "目标", "项目", "资源", "能力", "底线"])}<Field label="转入模块"><select value={p.targetType} onChange={(e) => set("targetType", e.target.value)}><option value="decision">决策</option><option value="action">行动</option></select></Field><details><summary className="cursor-pointer text-xs text-sage">指定调整对象</summary><Field label="对象类型"><select value={p.adjustmentType} onChange={(e) => setDraft({ ...draft, payload: { ...p, adjustmentType: e.target.value, adjustmentId: "" } })}>{[["none", "未指定"], ["goal", "目标"], ["project", "项目"], ["resource", "资源"], ["skill", "能力"]].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></Field>{p.adjustmentType !== "none" && <Field label="调整对象"><select required value={p.adjustmentId} onChange={(e) => set("adjustmentId", e.target.value)}><option value="">请选择</option>{(p.adjustmentType === "skill" ? props.data?.strategy.records.filter((r: Row) => r.kind === "skill") : props.data?.[`${p.adjustmentType}s`] || []).map((r: Row) => <option key={r.id} value={r.id}>{r.title || r.name}</option>)}</select></Field>}</details></>}
      {field("standard", "完成标准")}{field("reversibleStep", "可逆措施")}{field("stopCondition", "停止条件")}{date("dueDate", "可选截止日期")}
    </>}
    {draft.kind === "verification" && <>{field("actual", "实际走势与证据", true)}{select("outcome", "判断是否符合实际", ["符合", "偏离", "尚不能判断"])}{field("reason", "偏差原因：信息不全、分析错误或环境突变")}{select("effectiveness", "应变措施是否有效", ["有效", "无效", "尚未执行", "尚不能判断"])}{field("effectEvidence", "措施效果依据")}{field("adjustment", "下次调整")}{date("nextDate", "下次验证日期")}<p className="text-xs text-slate-500">本次验证关联原判断版本，不覆盖旧判断。</p></>}
    {draft.kind === "rule" && <>{field("content", "研判规则", true)}{field("conditions", "适用条件", true)}{field("exceptions", "例外与限制")}<p className="text-xs text-slate-500">保存为草稿，确认后入库；修改已有规则须再次确认。</p></>}
  </>;
}
