import { PROFILE_ID } from "../db";
import { authorizedSensitiveProfileFields, redact } from "../ai";
import type { StrategyDB } from "./service";
import { resolveScene, type SceneRecord } from "../scenes";
import { readResourceLedger } from "./resource-shared";

export async function requirementsContext(db: StrategyDB, ids: string[], instruction: string, allowSensitive: boolean) {
  const [records, resources, evidences, scenes, profile, experiences, constraints, assumptions, goals, projects, actions] = await Promise.all([
    db.strategyRecord.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
    db.resource.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
    db.evidence.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
    db.workbenchScene.findMany({ where: { profileId: PROFILE_ID } }),
    db.profile.findUnique({ where: { id: PROFILE_ID } }),
    db.experience.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
    db.constraint.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
    db.assumption.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
    db.goal.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
    db.project.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
    db.action.findMany({ where: { profileId: PROFILE_ID }, orderBy: { id: "asc" } }),
  ]);
  const visions = records.filter((row) => ids.includes(row.id) && ["vision", "overallVision"].includes(row.kind) && !row.archived);
  if (visions.length !== new Set(ids).size) throw new Error("愿景不存在或不属于当前档案");
  const tags = records.filter((row) => row.kind === "tag").map((row) => JSON.parse(row.payload));
  const tagFor = (type: string, id: string) => tags.find((tag) => tag.subjectType === type && tag.subjectId === id);
  const scrub = (value: unknown) => JSON.stringify(redact(value, "姓名和联系方式脱敏", authorizedSensitiveProfileFields(profile)))
    .replace(/\b1[3-9]\d{9}\b/g, "[手机号已脱敏]").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[邮箱已脱敏]").replace(/\b\d{17}[\dXx]\b/g, "[证件号已脱敏]");
  const source = (type: string, id: string, title: string, content: unknown, sceneIds: string[]) => {
    const serialized = scrub({ title, content });
    const sensitive = scenes.some((scene) => [1, 2, 3].includes(scene.slot) && sceneIds.includes(scene.id)) || /收入|工资|薪资|家庭|孩子|疾病|病史|健康|财务|资产|组织|公司/.test(serialized);
    return { type, id, title: JSON.parse(scrub(title)) as string, content: sensitive && !allowSensitive ? "[敏感资料未授权]" : serialized, blocked: sensitive && !allowSensitive };
  };
  const sources = visions.map((row) => source(row.kind, row.id, row.title, JSON.parse(row.payload), row.sceneId ? [row.sceneId] : []));
  const inventory = [
    ...records.filter((row) => row.kind === "skill" && !row.archived).map((row) => source("skill", row.id, row.title, JSON.parse(row.payload), row.sceneId ? [row.sceneId] : [])),
    ...evidences.map((row) => source("evidence", row.id, row.ability, { evidence: row.evidence }, tagFor("evidence", row.id)?.sceneIds || [])),
    ...resources.map((row) => source("resource", row.id, row.name, { description: row.description, category: row.category, ledger: readResourceLedger(tagFor("resource", row.id)?.ledger, row.category) }, tagFor("resource", row.id)?.sceneIds || [])),
  ];
  const selectedScenes = new Set(visions.flatMap((row) => row.sceneId ? [row.sceneId] : []));
  const related = (sceneId: string | null) => visions.some((row) => row.kind === "overallVision") || !sceneId || selectedScenes.has(sceneId);
  const inheritedScene = (row: SceneRecord) => { const value = resolveScene(row, goals, projects, scenes); return value.sceneSource === "default" ? null : value.effectiveSceneId; };
  const supporting = [
    ...records.filter(row => row.kind === "profileScene" && !row.archived && related(row.sceneId)).map(row => source("profileScene", row.id, `基础档案 · ${scenes.find(scene => scene.id === row.sceneId)?.name || "其他"}`, JSON.parse(row.payload), row.sceneId ? [row.sceneId] : [])),
    ...(profile ? [source("profile", PROFILE_ID, "个人档案与现实条件（自述，时效待核实）", {
      stage: profile.stage, roles: profile.roles, education: profile.education, major: profile.major,
      personalityTraits: profile.personalityTraits, industry: profile.industry, organization: profile.organization,
      employmentStatus: profile.employmentStatus, jobTitle: profile.jobTitle, responsibilities: profile.responsibilities,
      professionalFocus: profile.professionalFocus, stageTransition: profile.stageTransition,
      currentPriorities: profile.currentPriorities, stageNeeds: profile.stageNeeds, currentChallenges: profile.currentChallenges,
      directionOneToThreeYears: profile.directionOneToThreeYears, successDefinition: profile.successDefinition,
      familyResponsibilities: profile.familyResponsibilities, healthEnergy: profile.healthEnergy,
      incomeRange: profile.incomeRange, financialPressure: profile.financialPressure,
      behaviorPatterns: profile.behaviorPatterns, riskPreference: profile.riskPreference,
    }, [])] : []),
    ...experiences.map((row) => source("experience", row.id, row.title, { description: row.description, learning: row.learning, happenedAt: row.happenedAt }, tagFor("experience", row.id)?.sceneIds || [])),
    ...constraints.map((row) => source("constraint", row.id, row.name, { description: row.description }, tagFor("constraint", row.id)?.sceneIds || [])),
    ...assumptions.map((row) => source("assumption", row.id, row.statement, { evidence: row.evidence, status: row.status }, tagFor("assumption", row.id)?.sceneIds || [])),
    ...goals.filter((row) => related(row.sceneId)).map((row) => source("goal", row.id, row.title, { description: row.description, metric: row.metric, horizon: row.horizon, deadline: row.deadline, status: row.status }, row.sceneId ? [row.sceneId] : [])),
    ...projects.filter((row) => related(inheritedScene(row))).map((row) => source("project", row.id, row.name, { goalId: row.goalId, description: row.description, metric: row.metric, boundary: row.boundary, budget: row.budget, status: row.status }, inheritedScene(row) ? [inheritedScene(row)!] : [])),
    ...actions.filter((row) => related(inheritedScene(row))).map((row) => source("action", row.id, row.title, { goalId: row.goalId, projectId: row.projectId, standard: row.standard, purpose: row.purpose, dueDate: row.dueDate, status: row.status }, inheritedScene(row) ? [inheritedScene(row)!] : [])),
  ];
  const instructionBlocked = !allowSensitive && /收入|工资|薪资|家庭|孩子|疾病|病史|健康|财务|资产|组织|公司/.test(instruction);
  const context = { sources, inventory: inventory.filter((row) => !row.blocked), supporting: supporting.filter((row) => !row.blocked), instruction: instructionBlocked ? "[补充说明含敏感内容，需授权]" : scrub(instruction), instructionBlocked };
  const serialized = JSON.stringify(context);
  if (serialized.length > 120000) throw new Error("现有资料过多，请先精简过长的记录后再规划");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { ...context, fingerprint, excluded: inventory.filter((row) => row.blocked).length, excludedSupporting: supporting.filter((row) => row.blocked).length };
}
