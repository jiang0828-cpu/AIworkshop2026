"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { shanghaiDate } from "@/lib/daily/shared";
import { statuses, type Background, type Conclusion, type ResearchView } from "@/lib/research/shared";
import { canRespond, focusPresets, readRadar, type Verification } from "@/lib/research/radar";
import { RadarFields, RadarRead, VerificationFields } from "./RadarCard";
import RadarOverview from "./RadarOverview";
import { Button, DetailPane, EditDialog, Empty, Field, Heading, Link, matchesScene, SceneSelect, type ModuleProps } from "./Shared";

type State = { batches: ResearchView[]; options: Background[]; searchConfigured: boolean; aiConfigured: boolean; heartbeat: string | null };
type Manual = { title: string; url: string; content: string; publishedAt: string | null };
type Draft = { requestId: string; sceneId: string | null; question: string; queries: string; days: number; online: boolean; previousId: string | null; selected: Array<{ type: string; id: string }>; allowSensitive: boolean; manual: Manual[] };
type Edit = { batch: ResearchView; index: number; conclusion: Conclusion; type: "save-conclusion" | "decision" | "action"; title: string; content: string; standard: string; dueDate: string };
const emptyManual = (): Manual => ({ title: "", url: "", content: "", publishedAt: null });
const uuid = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(c) / 4).toString(16));
export default function ResearchPanel({ props, onManual }: { props: ModuleProps; onManual: () => void }) {
  const [state, setState] = useState<State | null>(null), [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null), [preview, setPreview] = useState<{ background: Background[]; queries: string[]; question: string } | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null), [supplement, setSupplement] = useState<{ batch: ResearchView; sourceId: string; content: string } | null>(null);
  const [follow, setFollow] = useState<{ batch: ResearchView; date: string } | null>(null);
  const [verification, setVerification] = useState<{ batch: ResearchView; index: number; value: Omit<Verification, "at"> } | null>(null);
  const [working, setWorking] = useState(false), busy = useRef(false);
  const filter = props.target.scene || "all";
  const scene = draft ? draft.sceneId : ["all", "unclassified"].includes(filter) ? null : filter;
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/situation?scene=${encodeURIComponent(scene || "")}`, { cache: "no-store" });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "读取失败");
      setState(result); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "读取失败"); }
  }, [scene]);
  useEffect(() => { void refresh(); const interval = setInterval(() => void refresh(), 5000); const focus = () => void refresh(); window.addEventListener("focus", focus); return () => { clearInterval(interval); window.removeEventListener("focus", focus); }; }, [refresh]);
  const post = async (action: string, data: unknown) => {
    if (busy.current) return null; busy.current = true; setWorking(true);
    try {
      const response = await fetch("/api/situation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "操作失败");
      if (action !== "preview") {
        const form = document.querySelector<HTMLFormElement>('form[role="dialog"][data-workbench-dirty="true"]');
        if (form) delete form.dataset.workbenchDirty;
        await refresh(); await props.reload(); window.dispatchEvent(new Event("workbench-saved"));
      }
      return result;
    } catch (error) { props.notify(error instanceof Error ? error.message : "操作失败"); return null; }
    finally { busy.current = false; setWorking(false); }
  };
  const start = (manual = false, previous?: ResearchView) => {
    setPreview(null);
    setDraft({ requestId: uuid(), sceneId: previous?.sceneId ?? scene, question: previous?.question || "", queries: previous?.queries.join("\n") || "", days: previous?.days ?? 30, online: !manual, previousId: previous?.id || null, selected: (previous?.background || state?.options || []).slice(0, 20).map(({ type, id }) => ({ type, id })), allowSensitive: false, manual: manual ? [emptyManual()] : [] });
  };
  const update = (patch: Partial<Draft>) => { setDraft((draft) => draft ? { ...draft, ...patch } : draft); setPreview(null); };
  const openBatch = (id: string | undefined) => props.navigate({ section: "situation", tab: "overview", scene: filter, recordId: id });
  const batches = state?.batches.filter((batch) => matchesScene(batch.sceneId, filter) || batch.id === props.target.recordId) || [];
  const due = batches.filter((batch) => batch.followUpDate && batch.followUpDate <= shanghaiDate() && !state?.batches.some((next) => next.previousId === batch.id));
  const beginEdit = (batch: ResearchView, index: number, type: Edit["type"]) => {
    if (type !== "save-conclusion" && !canRespond(batch.conclusions[index].radar)) { props.notify("请先编辑研判卡，补充置信度与依据；低置信度先观察核实。"); return; }
    const conclusion = batch.conclusions[index], radar = readRadar(conclusion.radar);
    const context = `${conclusion.facts}\n\n${conclusion.relevance}\n\n${conclusion.nextStep}\n\n应变方向：${radar.responseType}；时间窗：${radar.window}\n置信度：${radar.confidence}，依据：${radar.confidenceReason}\n底线：${radar.bottomLine || "待核实"}；触发条件：${radar.trigger || "待填写"}\n可逆验证：${radar.reversibleStep || "待填写"}\n观察指标：${radar.indicator || "待填写"}；预期：${radar.expected || "待填写"}`;
    if (type !== "save-conclusion" && context.length > 10000) props.notify("草稿已截取前10000字，完整依据仍保留在原研判卡，请核对后保存。");
    setEdit({ batch, index, type, conclusion: { ...conclusion }, title: conclusion.title, content: context.slice(0, 10000), standard: radar.expected, dueDate: "" });
  };
  return <section className="mb-6 min-w-0">
    <Heading title="形势研判" action={<div className="flex flex-wrap gap-2"><Button primary onClick={() => start()} disabled={!state}><Search size={15} />收集并研判</Button><Button onClick={() => start(true)} disabled={!state}><Plus size={15} />补充资料</Button></div>} />
    <p className="mb-3 text-sm text-slate-500">外部发生了什么？对我是机会还是威胁？需要调整什么？收集事实 → 形成判断 → 确认应变 → 验证修正。</p>
    <details className="mb-3 text-xs text-slate-500"><summary className="cursor-pointer">如何使用与运行节奏</summary><p className="mt-2">日常只记有来源的事实；每周筛选变化；每月检查观察指标并导出汇总；季度和年度制定目标、复盘时，对照研判卡校准方向。重大底线疑点当天核实。这里提出建议，目标、项目、资源和执行仍在原模块确认调整。</p></details>
    {error && <div role="alert" className="mb-3 text-sm text-red-700">{error} <Button onClick={() => void refresh()}>重试</Button></div>}
    {!state && !error && <p className="py-4 text-sm text-slate-400">正在读取研判…</p>}
    {state && <p className="mb-4 text-xs text-slate-400">{!state.searchConfigured && "未配置 Tavily，联网收集暂不可用；可以粘贴正文。 "}{!state.aiConfigured && "未配置 AI，资料仍可保存并手动研判。 "}调度器最近运行：{state.heartbeat ? new Date(state.heartbeat).toLocaleString("zh-CN") : "尚未启动"}</p>}
    {due.length > 0 && <div className="mb-4 rounded-md bg-amber-50 p-3 text-sm"><span>到期跟进：</span>{due.map((batch) => <button key={batch.id} className="mx-2 text-sage underline" onClick={() => openBatch(batch.id)}>{batch.question}</button>)}</div>}
    {state && <RadarOverview batches={batches} props={props} />}
    {!!batches.length && <div className="divide-y divide-line border-y border-line">{batches.map((batch) => <article key={batch.id} className="py-4" data-record-id={batch.id}>
      <button type="button" className="w-full text-left" onClick={() => openBatch(props.target.recordId === batch.id ? undefined : batch.id)}><span className="block break-words text-sm font-semibold">{batch.question}</span><span className="mt-1 block text-xs text-slate-500">{statuses[batch.status]} · {new Date(batch.createdAt).toLocaleString("zh-CN")} · {batch.sources.length} 条资料{batch.followUpDate ? ` · 下次关注 ${batch.followUpDate}` : ""}</span></button>
      {props.target.recordId === batch.id && <DetailPane enabled title={batch.question} onClose={() => openBatch(undefined)}><div className="mt-4 space-y-4">
        {batch.error && <p role="alert" className="text-sm text-red-700">{batch.error}</p>}
        {["queued", "collecting", "analyzing"].includes(batch.status) && <p className="text-sm text-slate-500">{statuses[batch.status]}，关闭页面后仍由后台继续。已完成 {batch.phase} 个检索词，取得 {batch.sources.length} 条资料。</p>}
        {batch.changes && <p className="rounded-md bg-mist p-3 text-sm whitespace-pre-wrap">本轮变化：{batch.changes}</p>}
        {batch.gaps && <p className="text-sm text-amber-800 whitespace-pre-wrap">信息缺口：{batch.gaps}</p>}
        {batch.status === "review" && !batch.conclusions.length && <Empty>现有资料不足以形成值得关注的结论。</Empty>}
        {batch.conclusions.map((conclusion, index) => <div key={index} className="space-y-3 border-b border-line pb-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{conclusion.title}</h3><span className="text-xs text-slate-400">{conclusion.change} · {conclusion.evidence}（非人工核验）</span></div>
          <p className="whitespace-pre-wrap break-words"><strong>发生了什么：</strong>{conclusion.facts} <span className="text-xs text-sage">{conclusion.citations.map((citation) => `[${citation.sourceId}]`).join(" ")}</span></p>
          <p className="whitespace-pre-wrap break-words"><strong>与我有什么关系：</strong>{conclusion.relevance}</p><p className="whitespace-pre-wrap break-words"><strong>下一步做什么：</strong>{conclusion.nextStep}</p>
          <RadarRead value={conclusion.radar} feedback={conclusion.feedback} />
          <Button onClick={() => setVerification({ batch, index, value: { id: uuid(), actual: "", outcome: "尚不能判断", reason: "", adjustment: "", rule: "" } })}>记录反馈验证</Button>
          <details><summary className="cursor-pointer text-xs text-sage">查看依据与不确定性</summary><p className="my-2 text-xs text-slate-500 whitespace-pre-wrap">{conclusion.uncertainty || "请核对原始来源后再决定。"}</p>{conclusion.citations.map((citation, n) => { const source = batch.sources.find((source) => source.id === citation.sourceId); return <div key={n} className="my-2 text-xs"><p>[{citation.sourceId}] {source?.title}</p><blockquote className="my-1 border-l-2 border-line pl-3">{citation.quote}</blockquote>{source?.url && <a className="text-sage underline break-all" href={source.url} target="_blank" rel="noopener noreferrer">打开原文</a>}</div>; })}</details>
          <div className="flex flex-wrap gap-2"><Button onClick={() => beginEdit(batch, index, "save-conclusion")}>编辑结论</Button>{(["decision", "action"] as const).map((type) => { const link = props.data?.strategy?.sources?.find((row: { sourceType: string; sourceId: string; targetType: string }) => row.sourceType === "research" && row.sourceId === `${batch.id}:${index}` && row.targetType === type); return link ? <Button key={type} onClick={() => props.navigate({ section: type === "decision" ? "decisions" : "actions", tab: type === "decision" ? "decisions" : undefined, recordId: link.targetId })}>打开已创建{type === "decision" ? "决策" : "行动"}</Button> : <Button key={type} onClick={() => beginEdit(batch, index, type)}>转为{type === "decision" ? "决策" : "行动"}</Button>; })}</div>
        </div>)}
        <details><summary className="cursor-pointer text-sm text-sage">来源资料（{batch.sources.length}）</summary>{batch.sources.map((source) => <div key={source.id} className="mt-3 space-y-1 border-b border-line pb-3 text-xs"><p className="font-medium">[{source.id}] {source.title}</p><p>{source.publisher} · 发布日期：{source.publishedAt || "未知"} · 采集：{new Date(source.collectedAt).toLocaleString("zh-CN")}</p><p>{source.quality === "snippet" ? "仅摘要" : source.quality === "text" ? "已提取正文" : source.quality === "manual" ? "手动正文，待核验" : source.quality === "pending" ? "等待提取" : "提取失败"} · {source.note}</p>{source.url && <a className="block break-all text-sage underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.url}</a>}<pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words bg-mist p-2 font-sans">{source.content || "尚无可用正文"}</pre>{batch.status === "failed" && <Button onClick={() => setSupplement({ batch, sourceId: source.id, content: source.content })}>补充正文</Button>}</div>)}</details>
        <details><summary className="cursor-pointer text-xs text-slate-500">发送背景与调用记录</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{batch.background.map((row) => `${row.title}\n${row.content}`).join("\n\n")}<br />检索词：{batch.queries.join("；")}</pre>{batch.calls.map((call, index) => <p key={index} className="mt-1 text-xs text-slate-500">{call.stage}：{call.status === "done" ? "完成" : call.status === "failed" ? "失败／中断" : "请求中"} · {call.durationMs === undefined ? "耗时未知" : `${(call.durationMs / 1000).toFixed(1)}秒`} · {call.stage === "分析" ? `Token ${call.promptTokens ?? "未知"} / ${call.completionTokens ?? "未知"}` : `额度 ${call.credits ?? "未知"}`}</p>)}</details>
        {!["queued", "collecting", "analyzing"].includes(batch.status) && <div className="flex flex-wrap gap-2">{batch.status === "failed" && <Button primary disabled={working} onClick={() => { if (window.confirm("将复用已保存的资料。上次中断的请求可能已计费，确认重试未完成阶段？")) void post("retry", { id: batch.id, version: batch.version }); }}>重试未完成阶段</Button>}<Button onClick={() => start(!batch.online, batch)}>更新这一方向</Button><Button onClick={() => setFollow({ batch, date: batch.followUpDate || "" })}>设置下次关注</Button><Button onClick={onManual}>手动填写研判</Button></div>}
      </div></DetailPane>}
    </article>)}</div>}
    {!batches.length && state && <p className="mb-4 py-3 text-sm text-slate-400">从一个关注问题开始，先选背景，再预览本次发送内容。</p>}
    <div className="mt-4"><Link onClick={onManual}>手动填写研判记录</Link></div>
    {draft && <EditDialog title={draft.previousId ? "更新关注方向" : draft.online ? "收集并研判" : "补充资料并研判"} working={working} onClose={() => { setDraft(null); setPreview(null); }} saveLabel={preview ? "确认发送并入队" : "预览发送内容"} onSave={async () => {
      const data = { ...draft, queries: draft.online ? draft.queries.split("\n").map((text) => text.trim()).filter(Boolean) : [] };
      if (!preview) { const result = await post("preview", data); if (result) setPreview(result); }
      else { const result = await post("collect", { ...data, preview: JSON.stringify(preview) }); if (result) { setDraft(null); setPreview(null); openBatch(result.id); props.notify("已加入后台队列"); } }
    }}>
      <Field label="关注场景"><SceneSelect view={props.data?.strategy} value={draft.sceneId || ""} onChange={(value) => update({ sceneId: value || null, selected: [] })} /></Field>
      <details><summary className="cursor-pointer text-sm text-sage">医疗行业关注模板（可选，不覆盖已有输入）</summary><div className="mt-2 flex flex-wrap gap-2">{focusPresets.map((preset) => <Button key={preset.label} onClick={() => { if ((draft.question || draft.queries) && !window.confirm("用该模板替换当前问题和公开检索词？")) return; update({ question: preset.question, queries: preset.queries }); }}>{preset.label}</Button>)}</div><p className="mt-2 text-xs text-slate-500">检索词只是查找方向，不代表政策或事实已获验证。优先政策原文、论文与临床注册、公告及财报；访谈和客户反馈可手动补充。</p></details>
      <Field label="想弄清楚什么？"><textarea required maxLength={1000} rows={2} value={draft.question} onChange={(event) => update({ question: event.target.value })} placeholder="例如：哪些行业变化会影响我下一步的能力学习？" /></Field>
      <div><p className="mb-2 text-xs text-slate-500">建议参考的个人资料（可取消，不要求填完整）</p>{state?.options.map((option) => <label key={`${option.type}:${option.id}`} className="mb-2 flex items-start gap-2 text-sm"><input type="checkbox" className="!w-auto" checked={draft.selected.some((row) => row.id === option.id && row.type === option.type)} onChange={(event) => update({ selected: event.target.checked ? [...draft.selected, { type: option.type, id: option.id }].slice(0, 20) : draft.selected.filter((row) => row.id !== option.id || row.type !== option.type) })} />{option.title}{option.sensitive ? "（敏感）" : ""}</label>)}{!state?.options.length && <p className="text-xs text-slate-400">本场景暂无个人资料，也可以直接填写问题。</p>}</div>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="!w-auto" checked={draft.allowSensitive} onChange={(event) => update({ allowSensitive: event.target.checked })} />本次允许向模型发送选中的敏感资料；检索服务只收到下方公开检索词。</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="!w-auto" checked={draft.online} onChange={(event) => update({ online: event.target.checked })} />联网收集{!state?.searchConfigured ? "（尚未配置 Tavily）" : ""}</label>
      {draft.online && <><Field label="公开检索词，每行一个，最多3个（请勿填写私人信息）"><textarea required rows={3} maxLength={540} value={draft.queries} onChange={(event) => update({ queries: event.target.value })} placeholder="行业关键词 + 趋势／政策／原始报告；默认中文，可自行加入英文词" /></Field><Field label="检索时间范围"><select value={draft.days} onChange={(event) => update({ days: Number(event.target.value) })}>{[[7, "近7天"], [30, "近30天"], [90, "近90天"], [0, "不限时间"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></>}
      {draft.manual.map((manual, index) => <div key={index} className="space-y-2 rounded-md border border-line p-3"><Field label={`资料 ${index + 1} 标题`}><input required value={manual.title} maxLength={300} onChange={(event) => update({ manual: draft.manual.map((row, n) => n === index ? { ...row, title: event.target.value } : row) })} /></Field><Field label="公开网页链接（可选）"><input type="url" value={manual.url} onChange={(event) => update({ manual: draft.manual.map((row, n) => n === index ? { ...row, url: event.target.value } : row) })} /></Field><Field label="正文（提取失败可直接粘贴）"><textarea rows={4} maxLength={16000} value={manual.content} onChange={(event) => update({ manual: draft.manual.map((row, n) => n === index ? { ...row, content: event.target.value } : row) })} /></Field><Field label="发布日期（不知道请留空）"><input type="date" value={manual.publishedAt || ""} onChange={(event) => update({ manual: draft.manual.map((row, n) => n === index ? { ...row, publishedAt: event.target.value || null } : row) })} /></Field><Button onClick={() => update({ manual: draft.manual.filter((_, n) => n !== index) })}>移除此资料</Button></div>)}
      <Button disabled={draft.manual.length >= 15} onClick={() => update({ manual: [...draft.manual, emptyManual()] })}>添加链接或正文</Button>
      {preview && <div className="space-y-2 rounded-md bg-mist p-3 text-xs"><strong>本次发送预览</strong><p>模型收到的问题：{preview.question}</p><p>检索服务仅收到：{preview.queries.join("；") || "不联网"}</p>{preview.background.map((row) => <div key={`${row.type}:${row.id}`}><p>{row.title}</p><pre className="whitespace-pre-wrap break-words font-sans">{row.content}</pre></div>)}<p>已填写的 {draft.manual.length} 条资料正文也将发送给模型。确认后由后台执行。</p></div>}
    </EditDialog>}
    {edit && <EditDialog title={edit.type === "save-conclusion" ? "编辑研判结论" : `确认${edit.type === "decision" ? "决策" : "行动"}草稿`} working={working} onClose={() => setEdit(null)} saveLabel="确认保存" onSave={async () => {
      const data = edit.type === "save-conclusion" ? { id: edit.batch.id, version: edit.batch.version, index: edit.index, conclusion: edit.conclusion } : { id: edit.batch.id, version: edit.batch.version, index: edit.index, type: edit.type, title: edit.title, content: edit.content, standard: edit.standard, dueDate: edit.dueDate || null };
      if (await post(edit.type === "save-conclusion" ? "save-conclusion" : "convert", data)) setEdit(null);
    }}>
      {edit.type === "save-conclusion" && <details><summary className="cursor-pointer text-sm text-sage">研判卡：分类、置信度与观察指标</summary><div className="mt-3"><RadarFields value={edit.conclusion.radar} onChange={(radar) => setEdit({ ...edit, conclusion: { ...edit.conclusion, radar } })} /></div></details>}
      {edit.type === "save-conclusion" ? <>{([ ["title", "标题"], ["facts", "发生了什么"], ["relevance", "与我有什么关系"], ["nextStep", "下一步做什么"], ["uncertainty", "不确定性"] ] as const).map(([key, label]) => <Field key={key} label={label}><textarea required={key === "title" || key === "facts"} rows={key === "title" ? 1 : 3} value={edit.conclusion[key]} onChange={(event) => setEdit({ ...edit, conclusion: { ...edit.conclusion, [key]: event.target.value } })} /></Field>)}<p className="text-xs text-slate-400">保留原始来源和支持摘录，编辑后仍是待确认研判。</p></> : <><Field label="名称"><input required maxLength={300} value={edit.title} onChange={(event) => setEdit({ ...edit, title: event.target.value })} /></Field><Field label="背景与下一步"><textarea rows={6} value={edit.content} onChange={(event) => setEdit({ ...edit, content: event.target.value })} /></Field>{edit.type === "action" && <><Field label="完成标准"><input value={edit.standard} onChange={(event) => setEdit({ ...edit, standard: event.target.value })} /></Field><Field label="可选日期"><input type="date" value={edit.dueDate} onChange={(event) => setEdit({ ...edit, dueDate: event.target.value })} /></Field></>}<p className="text-xs text-slate-500">确认后创建，并保留本轮结论和来源关联。</p></>}
    </EditDialog>}
    {verification && <EditDialog title="反馈验证" working={working} onClose={() => setVerification(null)} onSave={async () => { if (await post("verify", { id: verification.batch.id, version: verification.batch.version, index: verification.index, verification: verification.value })) setVerification(null); }}><p className="text-sm">原判断：{verification.batch.conclusions[verification.index].relevance}</p><p className="text-xs text-slate-500">观察：{readRadar(verification.batch.conclusions[verification.index].radar).indicator || "尚未填写"}；预期：{readRadar(verification.batch.conclusions[verification.index].radar).expected || "尚未填写"}</p><VerificationFields value={verification.value} onChange={(value) => setVerification({ ...verification, value })} /></EditDialog>}
    {supplement && <EditDialog title="补充正文" working={working} onClose={() => setSupplement(null)} onSave={async () => { if (await post("supplement", { id: supplement.batch.id, version: supplement.batch.version, sourceId: supplement.sourceId, content: supplement.content })) setSupplement(null); }}><Field label="正文"><textarea required rows={10} maxLength={16000} value={supplement.content} onChange={(event) => setSupplement({ ...supplement, content: event.target.value })} /></Field><p className="text-xs text-slate-500">保存后可点击“重试未完成阶段”。</p></EditDialog>}
    {follow && <EditDialog title="下次关注" working={working} onClose={() => setFollow(null)} onSave={async () => { if (await post("follow-up", { id: follow.batch.id, version: follow.batch.version, date: follow.date || null })) setFollow(null); }}><Field label="日期（留空取消）"><input type="date" value={follow.date} onChange={(event) => setFollow({ ...follow, date: event.target.value })} /></Field><p className="text-xs text-slate-500">到期在页面显示，不会自动检索或推送。</p></EditDialog>}
  </section>;
}
