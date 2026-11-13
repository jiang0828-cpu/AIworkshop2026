/* eslint-disable @typescript-eslint/no-explicit-any */
import type { D1Database } from "@cloudflare/workers-types";
import { prismaModels } from "./prisma-models";
import { PROFILE_ID } from "./profile-id";
import { resolveScene, sceneDefaults } from "./scenes";
import { shanghaiDate, taskStatus } from "./daily/status";
import { readAffiliation } from "./daily/affiliation";

// Read-only D1 projection for the initial dashboard. Avoid booting Next + Prisma's
// WASM query engine for every page load. Mutations still use the existing API.
type Row = Record<string, any>;
const scalarFields = new Map(prismaModels.map(model => [model.name, model.fields.filter(field => field.kind === "scalar")]));
export function decodeD1Row(model: string, row: Row): Row {
  return Object.fromEntries((scalarFields.get(model) || []).filter(field => field.name in row).map(field => {
    const value = row[field.name];
    return [field.name, value == null ? null : field.type === "DateTime" ? new Date(value).toISOString() : field.type === "Boolean" ? Boolean(value) : value];
  }));
}

const direct = [
  ["profile", "Profile", "", "id"],
  ["experiences", "Experience", 'ORDER BY "createdAt" DESC'],
  ["evidences", "Evidence", 'ORDER BY "createdAt" DESC'],
  ["valueRules", "ValueRule", 'ORDER BY "priority" ASC'],
  ["resources", "Resource", 'ORDER BY "createdAt" DESC'],
  ["constraints", "Constraint", 'ORDER BY "createdAt" DESC'],
  ["assumptions", "Assumption", 'ORDER BY "createdAt" DESC'],
  ["goals", "Goal", 'ORDER BY "createdAt" DESC'],
  ["projects", "Project", 'ORDER BY "createdAt" DESC'],
  ["actions", "Action", 'ORDER BY "dueDate" ASC'],
  ["reviews", "Review", 'ORDER BY "periodEnd" DESC'],
  ["decisions", "Decision", 'ORDER BY "createdAt" DESC'],
  ["aiInstruction", "AIInstruction", ""],
  ["suggestions", "AISuggestion", 'ORDER BY "createdAt" DESC'],
  ["documentVersions", "DocumentVersion", 'ORDER BY "createdAt" DESC LIMIT 50'],
  ["identityCard", "IdentityCard", ""],
  ["identityVersions", "IdentityCardVersion", 'ORDER BY "createdAt" DESC LIMIT 30'],
  ["contextPackages", "ContextPackage", 'ORDER BY "createdAt" DESC LIMIT 30'],
  ["aiTasks", "AITask", 'ORDER BY "updatedAt" DESC LIMIT 50'],
  ["correctionRecords", "CorrectionRecord", 'ORDER BY "updatedAt" DESC LIMIT 100'],
  ["situationAssessment", "SituationAssessment", ""],
  ["situationItems", "SituationItem", 'ORDER BY "updatedAt" DESC'],
  ["scenes", "WorkbenchScene", 'ORDER BY "position" ASC'],
  ["records", "StrategyRecord", 'ORDER BY "updatedAt" DESC'],
  ["versions", "StrategyVersion", 'ORDER BY "createdAt" DESC'],
  ["relations", "GoalRelation", ""],
  ["sources", "RecordSource", ""],
  ["pins", "WorkbenchPin", 'AND "date" = ?2 ORDER BY "position" ASC'],
  ["selfReviews", "SelfActionReview", ""],
] as const;

export type WorkbenchPart = "main" | "archive" | "strategy";
const archiveKeys = ["documentVersions", "identityCard", "identityVersions", "contextPackages", "aiTasks", "correctionRecords", "items", "references", "feedbacks", "taskContexts"];
const strategyKeys = ["records", "versions", "relations", "sources", "pins", "selfReviews"];
export async function readWorkbenchData(db: D1Database, aiConfigured: boolean, profileId = PROFILE_ID, part?: WorkbenchPart) {
  const queries: Array<{ key: string; model: string; sql: string; values: string[] }> = direct.map(([key, model, order, ...rest]) => ({
    key, model, sql: `SELECT * FROM "${model}" WHERE "${rest[0] || "profileId"}" = ?1 ${order}`,
    values: key === "pins" && (!part || part === "strategy") ? [profileId, shanghaiDate()] : [profileId],
  }));
  const add = (key: string, model: string, sql: string) => queries.push({ key, model, sql, values: [profileId] });
  const selectedPackages = 'SELECT "id" FROM "ContextPackage" WHERE "profileId"=?1 ORDER BY "createdAt" DESC LIMIT 30';
  const selectedTasks = 'SELECT "id" FROM "AITask" WHERE "profileId"=?1 ORDER BY "updatedAt" DESC LIMIT 50';
  add("milestones", "Milestone", 'SELECT * FROM "Milestone" WHERE "projectId" IN (SELECT "id" FROM "Project" WHERE "profileId"=?1)');
  add("options", "DecisionOption", 'SELECT * FROM "DecisionOption" WHERE "decisionId" IN (SELECT "id" FROM "Decision" WHERE "profileId"=?1)');
  add("items", "ContextPackageItem", `SELECT * FROM "ContextPackageItem" WHERE "contextPackageId" IN (${selectedPackages}) ORDER BY "priority" DESC`);
  add("references", "ContextSourceReference", `SELECT * FROM "ContextSourceReference" WHERE "contextPackageId" IN (${selectedPackages})`);
  add("feedbacks", "AITaskFeedback", `SELECT * FROM "AITaskFeedback" WHERE "taskId" IN (${selectedTasks}) ORDER BY "createdAt" DESC`);
  add("taskContexts", "ContextPackage", `SELECT * FROM "ContextPackage" WHERE "profileId"=?1 AND "id" IN (SELECT "contextPackageId" FROM "AITask" WHERE "id" IN (${selectedTasks}))`);
  add("dailyTasks", "DailyTask", 'SELECT t."id", t."title", t."actionId", t."sceneId", t."completedAt", t."syncedAt", t."result", t."orchestration", p."date" AS "planDate" FROM "DailyTask" t JOIN "DailyPlan" p ON p."id"=t."planId" WHERE p."profileId"=?1 ORDER BY t.rowid');
  add("dailySteps", "DailyStep", 'SELECT s."taskId",s."status",s."assignee" FROM "DailyStep" s JOIN "DailyTask" t ON t."id"=s."taskId" JOIN "DailyPlan" p ON p."id"=t."planId" WHERE p."profileId"=?1');
  const selected = queries.filter(({ key }) => !part || ["profile", "scenes"].includes(key) || (part === "archive" ? archiveKeys.includes(key) : part === "strategy" ? strategyKeys.includes(key) || ["dailyTasks", "dailySteps"].includes(key) : !archiveKeys.includes(key) && !strategyKeys.includes(key)));
  const results = await db.batch<Row>(selected.map(query => db.prepare(query.sql).bind(...query.values)));
  const rows: Record<string, Row[]> = Object.fromEntries(queries.map(query => [query.key, []]));
  selected.forEach((query, index) => {
    if (!results[index].success) throw new Error("工作台读取失败，请重试");
    rows[query.key] = results[index].results.map(row => ({ ...decodeD1Row(query.model, row), ...(query.key === "dailyTasks" ? { plan: { date: row.planDate } } : {}) }));
  });
  const profile = rows.profile[0];
  // Let the normal initialization path handle a new or pre-migration workspace.
  if (!profile || !sceneDefaults.every(scene => rows.scenes.some(row => row.slot === scene.slot))) return null;
  const grouped = (list: Row[], key: string) => {
    const result = new Map<string, Row[]>();
    for (const row of list) { const group = result.get(row[key]) || []; group.push(row); result.set(row[key], group); }
    return (id: string) => result.get(id) || [];
  };
  const milestones = grouped(rows.milestones, "projectId"), options = grouped(rows.options, "decisionId");
  const items = grouped(rows.items, "contextPackageId"), references = grouped(rows.references, "contextPackageId");
  const feedbacks = grouped(rows.feedbacks, "taskId"), steps = grouped(rows.dailySteps, "taskId");
  const dailyByAction = grouped(rows.dailyTasks, "actionId");
  for (const [key] of direct) if (!["profile", "identityVersions", "scenes", "records", "versions", "relations", "sources", "pins", "selfReviews"].includes(key)) profile[key] = rows[key];
  profile.aiInstruction = rows.aiInstruction[0] || null;
  profile.identityCard = rows.identityCard[0] ? { ...rows.identityCard[0], versions: rows.identityVersions.filter(row => row.cardId === rows.identityCard[0].id) } : null;
  profile.situationAssessment = rows.situationAssessment[0] || null;
  const withScene = (row: Row) => ({ ...row, ...resolveScene(row as { id: string }, rows.goals as any, rows.projects as any, rows.scenes as any) });
  profile.goals = rows.goals.map(withScene);
  profile.projects = rows.projects.map(row => withScene({ ...row, milestones: milestones(row.id) }));
  profile.actions = rows.actions.map(row => withScene({ ...row, dailyTasks: dailyByAction(row.id).map(task => ({ completedAt: task.completedAt, plan: task.plan })) }));
  profile.decisions = rows.decisions.map(row => ({ ...row, options: options(row.id) }));
  profile.contextPackages = rows.contextPackages.map(row => ({ ...row, items: items(row.id), references: references(row.id) }));
  const contexts = new Map(rows.taskContexts.map(row => [row.id, row]));
  profile.aiTasks = rows.aiTasks.map(row => ({ ...row, feedbacks: feedbacks(row.id), contextPackage: contexts.get(row.contextPackageId) || null }));
  if (part === "archive") return Object.fromEntries(["documentVersions", "identityCard", "contextPackages", "aiTasks", "correctionRecords"].map(key => [key, profile[key]]));
  if (part !== "main") profile.strategy = {
    scenes: rows.scenes, records: rows.records.map(row => ({ ...row, payload: JSON.parse(row.payload) })),
    versions: rows.versions, relations: rows.relations, sources: rows.sources, pins: rows.pins,
    selfReviews: rows.selfReviews.map(row => ({ ...row, applied: JSON.parse(row.applied) })),
    selfDailyResults: rows.dailyTasks.filter(row => row.actionId !== null).map(row => ({
      id: row.id, actionId: row.actionId, title: row.title, result: row.result, syncedAt: row.syncedAt,
      status: taskStatus(steps(row.id) as any), hasAI: steps(row.id).some(step => step.assignee === "ai"),
    })),
  };
  if (part === "strategy") return { strategy: profile.strategy };
  const actions = new Map(rows.actions.map(row => [row.id, row]));
  profile.dailyReviewTasks = rows.dailyTasks.filter(row => row.completedAt && steps(row.id).length && steps(row.id).every(step => step.status === "done")).sort((a, b) => a.completedAt.localeCompare(b.completedAt)).map(row => {
    const action = actions.get(row.actionId), affiliation = readAffiliation(row.orchestration);
    const projectId = action ? action.projectId : affiliation?.projectId;
    const links = { projectId, goalId: (action ? action.goalId : affiliation?.goalId) || rows.projects.find(project => project.id === projectId)?.goalId };
    const task = { id: row.id, title: row.title, actionId: row.actionId, sceneId: row.sceneId, completedAt: row.completedAt, result: row.result.slice(0, 4000), plan: row.plan };
    return { ...task, ...links, ...resolveScene((action || { ...task, ...links }) as any, rows.goals as any, rows.projects as any, rows.scenes as any) };
  });
  const complete = { ...profile, aiConfigured };
  if (part === "main") return Object.fromEntries(Object.entries(complete).filter(([key]) => !archiveKeys.includes(key) && key !== "strategy"));
  return complete;
}
