"use client";

import { useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import { profileGroups, profileSceneFields, type ProfileSceneFields } from "@/lib/strategy/profile-scenes";
import { sceneProfileGroups, type SceneDetailKey } from "@/lib/strategy/profile-scene-layout";
import { parseSensitiveProfileAiFields, sensitiveProfileAiFields } from "@/lib/schemas";
import type { StrategyView } from "@/lib/strategy/shared";
import { Field } from "./Shared";
import ProfileSceneAI from "./ProfileSceneAI";

type Draft = { fields: ProfileSceneFields; allowed: string[] };
const choices: Record<string, string[]> = {
  employmentStatus: ["全职在职", "自由职业", "创业 / 经营中", "求职 / 转型中", "学习 / 进修中", "休整 / 照护中", "退休 / 半退休", "其他"],
  riskPreference: ["保守，优先确定性", "平衡，接受可控试错", "激进，优先成长空间"],
};

export default function ProfileSceneSections({ profile, view, scene, save, reload }: {
  profile: Record<string, unknown>;
  view?: StrategyView;
  scene: string;
  save: (type: string, payload: Record<string, unknown>, id?: string) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [localScene, setLocalScene] = useState("all");
  const selected = scene === "all" ? localScene : scene;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const dirty = useRef(new Set<string>());
  const formRef = useRef<HTMLFormElement>(null);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const record = view?.records.find(row => row.kind === "profileScene" && row.sceneId === selected && !row.archived);
  const current: Draft = drafts[selected] || {
    fields: profileSceneFields(selected === "all" ? profile : record?.payload || {}),
    allowed: parseSensitiveProfileAiFields(profile.sensitiveAiFields),
  };
  // Refresh saved scopes while keeping edits in every scene, including hidden scenes.
  useEffect(() => {
    setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => dirty.current.has(key))));
  }, [profile, view]);
  function edit(next: Draft) {
    dirty.current.add(selected);
    setDrafts(previous => ({ ...previous, [selected]: next }));
    setFeedback("");
    if (formRef.current) formRef.current.dataset.workbenchDirty = "true";
  }
  const name = selected === "all" ? "全局 / 原有资料" : view?.scenes.find(row => row.id === selected)?.name || "场景";
  const slot = view?.scenes.find(row => row.id === selected)?.slot;
  const groups = slot === undefined ? [] : sceneProfileGroups(slot);
  const hasLegacy = profileGroups.some(group => group.fields.some(([key]) => Boolean(current.fields[key])));
  function editDetail(key: SceneDetailKey, value: string) {
    edit({ ...current, fields: { ...current.fields, sceneDetails: { ...current.fields.sceneDetails, [key]: value } } });
  }
  const legacyGroups = profileGroups.map(group => <details key={`${selected}:legacy:${group.title}`} className="border-t border-line pt-4">
    <summary className="cursor-pointer text-sm font-medium">{group.title}<span className="ml-2 text-xs font-normal text-slate-400">{name}</span></summary>
    <div className="mt-3 space-y-3">
      {group.fields.map(([key, label]) => <div key={key}>
        <Field label={label}>
          {choices[key] ? <select value={current.fields[key]} onChange={event => edit({ ...current, fields: { ...current.fields, [key]: event.target.value } })}>
            <option value="">请选择（可留空）</option>
            {[...new Set([...choices[key], ...(current.fields[key] ? [current.fields[key]] : [])])].map(value => <option key={value}>{value}</option>)}
          </select> : <textarea rows={2} maxLength={5000} value={current.fields[key]} onChange={event => edit({ ...current, fields: { ...current.fields, [key]: event.target.value } })} />}
        </Field>
        {(sensitiveProfileAiFields as readonly string[]).includes(key) && (selected === "all" ? <label className="mt-1 flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" className="!w-auto" checked={current.allowed.includes(key)} onChange={event => edit({ ...current, allowed: event.target.checked ? [...current.allowed, key] : current.allowed.filter(field => field !== key) })} />允许该字段发送给 AI（含各场景）
        </label> : <span className="mt-1 block text-xs text-slate-400">{current.allowed.includes(key) ? "已允许发送给 AI" : "未授权发送给 AI"}</span>)}
      </div>)}
    </div>
  </details>);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setFeedback("");
    try {
      const pending: Record<string, Draft> = dirty.current.size
        ? Object.fromEntries(Object.entries(drafts).filter(([key]) => dirty.current.has(key)))
        : { [selected]: current };
      await save("profileScene", {
        ...(pending.all ? { global: { ...pending.all.fields, sensitiveAiFields: JSON.stringify(pending.all.allowed) } } : {}),
        scenes: Object.entries(pending).filter(([key]) => key !== "all").map(([sceneId, draft]) => ({ sceneId, fields: draft.fields })),
      });
      dirty.current.clear();
      setDrafts({});
      if (formRef.current) delete formRef.current.dataset.workbenchDirty;
      setFeedback("档案修改已保存。");
      window.dispatchEvent(new Event("workbench-saved"));
    } catch (error) { setFeedback(error instanceof Error ? error.message : "保存失败，请重试。"); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <><ProfileSceneAI view={view} reload={reload} /><form ref={formRef} onSubmit={submit} className="mt-5 space-y-4 border-t border-line pt-5">
    <fieldset disabled={saving} className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">场景档案</h3>
        {scene === "all" ? <select aria-label="档案场景" className="!w-auto !max-w-full !text-xs" value={selected} onChange={event => { setLocalScene(event.target.value); setFeedback(""); }}>
          <option value="all">全局 / 原有资料</option>
          {(view?.scenes || []).map(row => <option key={row.id} value={row.id}>{row.name}{dirty.current.has(row.id) ? " · 未保存" : ""}</option>)}
        </select> : <span className="text-xs text-sage">{name}</span>}
      </div>
      {selected === "all" ? legacyGroups : groups.map(group => <details key={`${selected}:${group.title}`} className="border-t border-line pt-4">
        <summary className="cursor-pointer text-sm font-medium">{group.title}<span className="ml-2 text-xs font-normal text-slate-400">{name}</span></summary>
        <div className="mt-3 space-y-3">
          {group.fields.map(({ key, label, placeholder, suggestions }) => <div key={key}>
            <Field label={label}>
              {suggestions ? <>
                <input list={`profile-stage-${selected}`} maxLength={5000} placeholder={placeholder} value={current.fields.sceneDetails?.[key] || ""} onChange={event => editDetail(key, event.target.value)} />
                <datalist id={`profile-stage-${selected}`}>{suggestions.map(value => <option key={value} value={value} />)}</datalist>
              </> : <textarea rows={2} maxLength={5000} placeholder={placeholder} value={current.fields.sceneDetails?.[key] || ""} onChange={event => editDetail(key, event.target.value)} />}
            </Field>
            {(sensitiveProfileAiFields as readonly string[]).includes(key) && <span className="mt-1 block text-xs text-slate-400">{current.allowed.includes(key) ? "已允许发送给 AI" : "未授权发送给 AI"}</span>}
          </div>)}
        </div>
      </details>)}
      {selected !== "all" && hasLegacy && <details className="border-t border-line pt-4"><summary className="cursor-pointer text-xs text-slate-500">原有场景资料</summary><div className="mt-3 space-y-4">{legacyGroups}</div></details>}
      {feedback && <p role="status" className={`text-xs ${feedback.includes("已保存") ? "text-sage" : "text-rose-600"}`}>{feedback}</p>}
      <button type="submit" className="flex items-center gap-2 rounded-md bg-sage px-3 py-2 text-sm text-white disabled:opacity-50" disabled={saving}>
        <Save size={15} />{saving ? "保存中..." : selected === "all" ? "保存全局资料" : "保存场景档案"}
      </button>
    </fieldset>
  </form></>;
}
