import { PROFILE_ID } from "../db";
import type { StrategyDB } from "../strategy/service";
import { requirementsContext } from "../strategy/requirements-context";
import { authorizedSensitiveProfileFields, redact } from "../ai";
import { inputSchema, type Context, type PlanInput, type Source } from "./shared";

export async function digest(value: unknown) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function planningContext(db: StrategyDB, input: PlanInput): Promise<Context> {
  input = inputSchema.parse(input);
  const [profile, records, values, constraints, goals, projects, actions, resources, evidences, scenes, signals] = await Promise.all([
    db.profile.findUniqueOrThrow({ where: { id: PROFILE_ID } }),
    db.strategyRecord.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
    db.valueRule.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
    db.constraint.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
    db.goal.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
    db.project.findMany({ where: { profileId: PROFILE_ID }, include: { milestones: true }, orderBy: { id: "asc" } }),
    db.action.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
    db.resource.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
    db.evidence.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
    db.workbenchScene.findMany({ where: { profileId: PROFILE_ID }, orderBy: { position: "asc" } }),
    db.radarRecord.findMany({ where: { profileId: PROFILE_ID, id: { in: input.signalIds }, kind: "judgementVersion", status: "confirmed" }, orderBy: { id: "asc" } }),
  ]);
  if (signals.length !== new Set(input.signalIds).size) throw new Error("研判须为当前档案已确认的判断版本");
  const visions = records.filter(row => ["vision", "overallVision"].includes(row.kind) && !row.archived);
  if (!visions.length) throw new Error("请先填写至少一份愿景");
  const context = await requirementsContext(db, visions.map(row => row.id), input.instruction, input.allowSensitive);
  if (context.instructionBlocked) throw new Error("补充说明含敏感内容，请先明确授权");
  const sources: Source[] = [...context.sources, ...context.inventory, ...context.supporting].map(row => ({ id: `${row.type}:${row.id}`, type: row.type, recordId: row.id, title: row.title, content: row.content, blocked: row.blocked }));
  const scrub = (value: unknown) => JSON.stringify(redact(value, "姓名和联系方式脱敏", authorizedSensitiveProfileFields(profile))).replace(/\b1[3-9]\d{9}\b/g, "[手机号已脱敏]").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[邮箱已脱敏]").replace(/\b\d{17}[\dXx]\b/g, "[证件号已脱敏]");
  if (!input.allowSensitive && /收入|工资|薪资|家庭|孩子|疾病|病史|健康|财务|资产|组织|公司/.test(input.capacity.budgetNote)) throw new Error("投入说明含敏感内容，请先明确授权");
  const sentInput = { ...input, instruction: JSON.parse(scrub(input.instruction)) as string, capacity: { ...input.capacity, budgetNote: JSON.parse(scrub(input.capacity.budgetNote)) as string } };
  for (const source of sources) {
    if (source.blocked) continue;
    const row = source.type === "goal" ? goals.find(row => row.id === source.recordId) : source.type === "project" ? projects.find(row => row.id === source.recordId) : source.type === "action" ? actions.find(row => row.id === source.recordId) : null;
    if (row) {
      const fields = source.type === "goal" ? ["title", "description", "metric", "horizon", "deadline", "sceneId", "visionId", "parentId", "status"] : source.type === "project" ? ["name", "description", "metric", "budget", "boundary", "risk", "stopCondition", "sceneId", "visionId", "goalId", "status", "milestones"] : ["title", "purpose", "standard", "dueDate", "estimatedHours", "sceneId", "goalId", "projectId", "status"];
      source.content = scrub(Object.fromEntries(fields.map(field => [field, (row as unknown as Record<string, unknown>)[field]])));
    }
  }
  for (const row of [...values.map(row => ({ type: "valueRule", id: row.id, title: row.value, content: { value: row.value, priority: row.priority, rule: row.rule, conflict: row.conflict } })), ...signals.map(row => ({ type: "judgementVersion", id: row.id, title: row.title, content: JSON.parse(row.payload) }))]) {
    const content = scrub(row.content);
    const blocked = !input.allowSensitive && /家庭|孩子|健康|财务|收入|资产|组织|公司/.test(content);
    sources.push({ id: `${row.type}:${row.id}`, type: row.type, recordId: row.id, title: JSON.parse(scrub(row.title)), content: blocked ? "[敏感资料未授权]" : content, blocked });
  }
  const missing = scenes.filter(scene => !visions.some(vision => vision.kind === "vision" && vision.sceneId === scene.id)).map(scene => `${scene.name}场景愿景未填写`);
  if (!visions.some(row => row.kind === "overallVision")) missing.push("总愿景未填写");
  for (const field of ["stage", "roles", "currentPriorities", "currentChallenges"] as const) if (!profile[field]) missing.push(`档案字段 ${field} 未填写`);
  if (input.capacity.weeklyHours === null) missing.push("每周可用时间未知");
  if (!input.capacity.weekdays.length) missing.push("可安排日期未知");
  if (input.capacity.budget === null) missing.push("投入金额上限未知");
  if (sources.some(row => row.blocked)) missing.push("部分敏感资料未授权，不能推断其内容");
  if (context.excluded || context.excludedSupporting) missing.push(`另有${context.excluded + context.excludedSupporting}条能力、资源或关联资料未授权，未进入发送内容`);
  return { sources, scenes: scenes.map(({ id, name, slot }) => ({ id, name, slot })), missing, sentInput,
    fingerprint: await digest({ input, profile, records, values, constraints, goals, projects, actions, resources, evidences, scenes, signals, sanitized: context.fingerprint }) };
}
