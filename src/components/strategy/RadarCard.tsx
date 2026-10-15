"use client";
import { canRespond, radarSchema, readRadar, type Radar, type Verification } from "@/lib/research/radar";
import { Field } from "./Shared";

const selects = [["dimension", "信息维度"], ["category", "机会与威胁"], ["confidence", "置信度"], ["trend", "趋势性质"], ["window", "响应时间窗"], ["responseType", "应变方向"]] as const;
const texts = [["direction", "方向判断", "增长、收缩、鼓励或收紧？依据是什么？"], ["stage", "阶段位置", "早期、成长或成熟？不确定可留空"], ["fit", "个人适配", "与自己的愿景、D端／B端／C端路径是否一致？"], ["opportunity", "机会点", "能利用什么，需要什么前提？"], ["threat", "威胁点", "可能损失什么？"], ["energy", "能量影响", "精力、时间要增加、减少还是保持？"], ["material", "物质影响", "资金、设备与安全池的影响"], ["information", "信息影响", "还需学什么、核实什么？"], ["bottomLine", "底线风险", "是否影响合规红线或安全池？未知请明确写未知"], ["trigger", "触发条件", "什么可观察事实出现时需立即人工应对？"], ["reversibleStep", "可逆的小动作", "先验证什么，何时停止，如何撤回？"]] as const;

export function RadarFields({ value, onChange }: { value: unknown; onChange: (value: Radar) => void }) {
  const radar = readRadar(value);
  const set = (key: keyof Radar, value: string) => onChange({ ...radar, [key]: value });
  return <div className="space-y-3">
    <p className="text-xs text-slate-500">先判断相关性和置信度，再决定应变。低置信度先观察核实；底线疑点优先核实，不自动执行。</p>
    <div className="grid gap-3 sm:grid-cols-2">{selects.map(([key, label]) => <Field key={key} label={label}><select value={radar[key]} onChange={(e) => set(key, e.target.value)}>{radarSchema.shape[key]._def.innerType.options.map((option: string) => <option key={option}>{option}</option>)}</select></Field>)}</div>
    <Field label="置信度依据"><textarea rows={2} maxLength={3000} value={radar.confidenceReason} onChange={(e) => set("confidenceReason", e.target.value)} placeholder="证据是否直接、独立、近期？哪些地方仍有不确定性？" /></Field>
    <details><summary className="cursor-pointer text-sm text-sage">趋势、个人影响与底线（按需填写）</summary><div className="mt-3 space-y-3">{texts.map(([key, label, placeholder]) => <Field key={key} label={label}><textarea rows={2} maxLength={3000} value={radar[key]} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} /></Field>)}</div></details>
    <Field label="观察指标"><input maxLength={3000} value={radar.indicator} onChange={(e) => set("indicator", e.target.value)} placeholder="例如：原始政策是否正式发布、客户预算是否确认" /></Field>
    <Field label="预期走势／验证标准"><input maxLength={3000} value={radar.expected} onChange={(e) => set("expected", e.target.value)} placeholder="写下未来可对照的预期，避免事后改写判断" /></Field>
    <Field label="下次验证日期"><input type="date" value={radar.reviewDate} onChange={(e) => set("reviewDate", e.target.value)} /></Field>
  </div>;
}
export function RadarRead({ value, feedback = [] }: { value: unknown; feedback?: Verification[] }) {
  const radar = readRadar(value);
  return <div className="space-y-2 text-xs">
    <p className="text-sage">{radar.dimension} · {radar.category} · 置信度{radar.confidence} · {radar.window}</p>
    {!canRespond(radar) && <p className="text-amber-800">先观察核实，补足置信度依据后再提出应变决策。</p>}
    {radar.bottomLine && <p className="rounded bg-amber-50 p-2">底线：{radar.bottomLine} {radar.trigger && `／触发条件：${radar.trigger}`}（人工核实与确认）</p>}
    <details><summary className="cursor-pointer text-sage">研判卡与验证记录</summary><div className="mt-2 space-y-2 whitespace-pre-wrap break-words"><p>置信度依据：{radar.confidenceReason || "待补充"}；趋势：{radar.trend}；应变方向：{radar.responseType}</p>{texts.filter(([key]) => radar[key]).map(([key, label]) => <p key={key}>{label}：{radar[key]}</p>)}<p>观察指标：{radar.indicator || "待填写"}；预期：{radar.expected || "待填写"}；验证日期：{radar.reviewDate || "未设置"}</p>{feedback.map((v) => <div key={v.id} className="border-l-2 border-line pl-3"><p>{new Date(v.at).toLocaleDateString("zh-CN")} · {v.outcome}：{v.actual}</p><p>偏差原因：{v.reason || "未填写"}；下次调整：{v.adjustment || "未填写"}</p>{v.rule && <p>经验规则（人工记录）：{v.rule}</p>}</div>)}</div></details>
  </div>;
}
export function VerificationFields({ value, onChange }: { value: Omit<Verification, "at">; onChange: (value: Omit<Verification, "at">) => void }) {
  return <><p className="text-xs text-slate-500">对照原来的指标和预期记录结果。保留原判断，修正判断请新建一轮。</p><Field label="实际走势与证据"><textarea required maxLength={3000} rows={3} value={value.actual} onChange={(e) => onChange({ ...value, actual: e.target.value })} /></Field><Field label="与原判断对照"><select value={value.outcome} onChange={(e) => onChange({ ...value, outcome: e.target.value as Verification["outcome"] })}>{["符合", "偏离", "尚不能判断"].map((v) => <option key={v}>{v}</option>)}</select></Field>{([["reason", "原因：信息不全、分析有误或环境突变"], ["adjustment", "判断／决策效果与下次调整"], ["rule", "可复用的研判规则（可选，写明适用条件）"]] as const).map(([key, label]) => <Field key={key} label={label}><textarea rows={2} maxLength={3000} value={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.value })} /></Field>)}</>;
}
