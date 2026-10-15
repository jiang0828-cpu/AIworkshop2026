"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Sparkles, Trash2 } from "lucide-react";
import type { ScenePlanDraft } from "@/lib/strategy/profile-scene-plan";
import { sceneProfileGroups } from "@/lib/strategy/profile-scene-layout";
import type { StrategyView } from "@/lib/strategy/shared";
import { Button, Field } from "./Shared";

export default function ProfileSceneAI({ view, reload }: { view?: StrategyView; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState<ScenePlanDraft | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ context: unknown; withheld: number } | null>(null);
  const [allowSensitive, setAllowSensitive] = useState(false);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [message, setMessage] = useState("");
  const busyRef = useRef(false), formRef = useRef<HTMLFormElement>(null);
  function adopt(next: ScenePlanDraft | null) { setDraft(next); setSelected(next?.items.map(row => row.sceneId) || []); }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/profile-scene-plan", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("场景档案草稿读取失败，请刷新重试");
      const data = await response.json();
      if (!controller.signal.aborted) adopt(data.draft);
    }).catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "草稿读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  async function call(action: "preview" | "generate" | "save" | "discard") {
    if (busyRef.current) return;
    if (action !== "discard" && Array.from(document.querySelectorAll<HTMLFormElement>('form[data-workbench-dirty="true"]')).some(form => form !== formRef.current)) {
      setMessage("请先保存基础信息及场景档案的手动修改，再使用 AI 草稿。"); return;
    }
    busyRef.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/profile-scene-plan", { method: action === "discard" ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "discard" ? { requestId: draft?.requestId } : { action, allowSensitive, ...(action === "save" ? { requestId: draft?.requestId, items: draft?.items.filter(row => selected.includes(row.sceneId)) } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "操作失败，请重试");
      if (action === "preview") setPreview(data);
      else if (action === "generate") { adopt(data); setPreview(null); }
      else {
        adopt(null); setPreview(null);
        if (formRef.current) delete formRef.current.dataset.workbenchDirty;
        if (action === "save") {
          setMessage(`已确认保存 ${data.saved} 个场景，可在下方继续修改。`);
          await reload();
          window.dispatchEvent(new Event("workbench-saved"));
          try { const synced = await fetch("/api/sync", { method: "POST" }); if (!synced.ok) setMessage(`已保存 ${data.saved} 个场景；同步未完成，请稍后重试。`); }
          catch { setMessage(`已保存 ${data.saved} 个场景；同步未完成，请稍后重试。`); }
        } else setMessage("草稿已放弃，正式档案保留。");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败，输入已保留。"); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <section className="mt-5 min-w-0 border-t border-line pt-5" data-testid="profile-scene-ai">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-medium">AI 填充场景档案</h3>
      {!draft && <Button disabled={busy || loading} onClick={() => void call("preview")}><Sparkles size={15} />{loading ? "读取草稿…" : "根据基础信息填充"}</Button>}
    </div>
    {!draft && <label className="mt-3 flex items-start gap-2 text-xs text-slate-500"><input type="checkbox" className="!w-auto shrink-0" checked={allowSensitive} disabled={busy} onChange={event => { setAllowSensitive(event.target.checked); setPreview(null); }} />本次允许参考总愿景及健康、财务、家庭场景资料（敏感字段仍遵循档案授权）</label>}
    {preview && !draft && <div className="mt-3 space-y-3">
      {preview.withheld > 0 && <p className="text-xs text-amber-700">本次已排除 {preview.withheld} 份未授权资料，缺少依据的内容将列为待确认。</p>}
      <details><summary className="cursor-pointer text-xs text-slate-500">查看本次发送资料</summary><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words bg-mist p-3 text-xs">{JSON.stringify(preview.context, null, 2)}</pre></details>
      <Button primary disabled={busy} onClick={() => void call("generate")}><Sparkles size={15} />{busy ? "AI 正在整理全部场景…" : "确认发送并生成草稿"}</Button>
    </div>}
    {draft && <form ref={formRef} className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); void call("save"); }}>
      <p className="text-xs text-slate-500">{draft.source} · 待确认草稿</p>
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        {draft.items.map(item => {
          const scene = view?.scenes.find(row => row.id === item.sceneId);
          if (!scene) return <p key={item.sceneId} className="text-xs text-rose-600">场景已变化，请刷新后重新生成。</p>;
          const existing = view?.records.find(row => row.kind === "profileScene" && row.sceneId === item.sceneId);
          return <details key={item.sceneId} className="border-t border-line pt-3">
            <summary className="cursor-pointer text-sm font-medium">{scene.name}<span className="ml-2 text-xs font-normal text-slate-400">{selected.includes(item.sceneId) ? "已选择" : "未选择"}</span></summary>
            <div className="mt-3 space-y-3">
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="!w-auto" checked={selected.includes(item.sceneId)} onChange={event => { setSelected(previous => event.target.checked ? [...previous, item.sceneId] : previous.filter(id => id !== item.sceneId)); if (formRef.current) formRef.current.dataset.workbenchDirty = "true"; }} />确认更新此场景{existing ? "（将更新下列同名字段，原有资料保留）" : ""}</label>
              <p className="whitespace-pre-wrap break-words text-xs text-slate-500">{item.explanation}</p>
              {item.questions.length > 0 && <p className="whitespace-pre-wrap break-words text-xs text-amber-700">待确认：{item.questions.join("；")}</p>}
              {sceneProfileGroups(scene.slot).map(group => <details key={group.title} className="border-t border-line pt-3"><summary className="cursor-pointer text-xs font-medium">{group.title}</summary><div className="mt-3 space-y-3">{group.fields.map(field => <div key={field.key}>
                <Field label={field.label}><textarea rows={3} maxLength={5000} value={item.sceneDetails[field.key] || ""} onChange={event => {
                  setDraft(previous => previous && ({ ...previous, items: previous.items.map(row => row.sceneId === item.sceneId ? { ...row, sceneDetails: { ...row.sceneDetails, [field.key]: event.target.value } } : row) }));
                  if (formRef.current) formRef.current.dataset.workbenchDirty = "true";
                }} /></Field>
                {Boolean(existing?.payload.sceneDetails && typeof existing.payload.sceneDetails === "object" && (existing.payload.sceneDetails as Record<string, string>)[field.key]) && <details className="mt-1"><summary className="cursor-pointer text-xs text-slate-400">当前已保存内容</summary><p className="whitespace-pre-wrap break-words text-xs text-slate-500">{(existing!.payload.sceneDetails as Record<string, string>)[field.key]}</p></details>}
              </div>)}</div></details>)}
            </div>
          </details>;
        })}
        <div className="flex flex-wrap gap-2"><Button type="submit" primary disabled={busy || !selected.length}><Check size={15} />{busy ? "处理中…" : `确认保存 ${selected.length} 个场景`}</Button><Button disabled={busy} onClick={() => void call("discard")}><Trash2 size={15} />放弃草稿</Button></div>
      </fieldset>
    </form>}
    {message && <p role="status" className="mt-3 whitespace-pre-wrap break-words text-xs text-slate-600">{message}</p>}
  </section>;
}
