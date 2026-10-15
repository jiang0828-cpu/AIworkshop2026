"use client";
import { useState } from "react";
import VisionContent from "./VisionContent";
import { Button, EditDialog, Field, Link, useStrategy, type ModuleProps } from "./Shared";

export default function OverallVision({ props, readOnly = false }: { props: ModuleProps; readOnly?: boolean }) {
  const { view, working, post } = useStrategy(props);
  const record = view.records.find((row) => row.kind === "overallVision");
  const [draft, setDraft] = useState<{ expected: string; boundary: string } | null>(null);
  return <section className="mb-6 rounded-md border border-line bg-mist p-4" data-record-id={record?.id}>
    <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">总愿景</h2>{readOnly ? <Link onClick={() => props.navigate({ section: "self", tab: "values", recordId: record?.id })}>编辑总愿景</Link> : <Button onClick={() => setDraft({ expected: String(record?.payload.expected || ""), boundary: String(record?.payload.boundary || "") })}>{record ? "编辑总愿景" : "填写总愿景"}</Button>}</div>
    <VisionContent title="总愿景全文" preview={String(record?.payload.expected || "我希望过怎样的生活？先写一个总体方向，再从下面的场景开始。")} focused={Boolean(record && props.target.recordId === record.id)}>
    <p className="mt-3 whitespace-pre-wrap break-words text-sm">{String(record?.payload.expected || "我希望过怎样的生活？先写一个总体方向，再从下面的场景开始。")}</p>
    {Boolean(record?.payload.boundary) && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-500">重要底线：{String(record?.payload.boundary)}</p>}
    {record && <details className="mt-3"><summary className="cursor-pointer text-xs text-slate-500">总愿景历史</summary>{view.versions.filter((row) => row.recordId === record.id).map((version) => { const payload = JSON.parse(version.snapshot).payload; return <div key={version.id} className="mt-3 border-t border-line pt-2 text-xs"><p className="text-slate-400">{new Date(version.createdAt).toLocaleString("zh-CN")}</p><p className="mt-1 whitespace-pre-wrap break-words">{payload.expected || "未填写"}</p><p className="mt-1 whitespace-pre-wrap break-words">底线：{payload.boundary || "未填写"}</p></div>; })}</details>}
    </VisionContent>
    {draft && <EditDialog title="编辑总愿景" working={working} onClose={() => setDraft(null)} onSave={async () => { if (await post("record", { id: record?.id, kind: "overallVision", title: "总愿景", sceneId: null, payload: draft })) setDraft(null); }}>
      <Field label="总体期望"><textarea rows={4} value={draft.expected} placeholder="例如：保持健康，有稳定收入，留出陪伴家人和发展爱好的时间。" onChange={(event) => setDraft({ ...draft, expected: event.target.value })} /></Field>
      <Field label="重要底线"><textarea rows={2} value={draft.boundary} placeholder="例如：不长期透支健康，不牺牲基本家庭陪伴。" onChange={(event) => setDraft({ ...draft, boundary: event.target.value })} /></Field>
    </EditDialog>}
  </section>;
}
