import { z } from "zod";
import { priorityFor } from "./workflow";
import { dateSchema, shanghaiDate, taskDraftSchema, type AgentView, type TaskDraft } from "./shared";
import { otherSceneId, type SceneRow } from "../scenes";

export type AIConfig = { apiKey?: string; baseUrl?: string; model?: string };
export async function callModel(config: AIConfig, input: string, prompt: string, model = "", timeoutSeconds = 120, structured = false) {
  if (!config.apiKey) throw new Error("未配置服务端 AI_API_KEY");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const started = Date.now();
  try {
    const response = await fetch(`${(config.baseUrl || "https://api.deepseek.com/v1").replace(/\/$/, "")}/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: model || config.model || "deepseek-reasoner", messages: [{ role: "system", content: prompt }, { role: "user", content: input }],
        ...(structured ? { response_format: { type: "json_object" } } : {}) }), signal: controller.signal,
    });
    if (!response.ok) throw new Error(`AI 服务返回 HTTP ${response.status}`);
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const output = json.choices?.[0]?.message?.content;
    if (!output?.trim()) throw new Error("AI 返回空结果");
    if (output.length > 200000) throw new Error("AI 输出过长，请拆分任务后重试");
    const tokens = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
    return { output, durationMs: Date.now() - started, promptTokens: tokens(json.usage?.prompt_tokens), completionTokens: tokens(json.usage?.completion_tokens) };
  } catch (error) {
    // Never return provider bodies, headers or connection diagnostics containing credentials.
    if (controller.signal.aborted) throw new Error("AI 调用超时，请确认服务状态后重试");
    if (error instanceof Error && /^AI /.test(error.message)) throw error;
    throw new Error("AI 服务连接失败，请检查服务端配置");
  } finally { clearTimeout(timer); }
}

export function taskInputs(input: string) {
  const structured = /(?:预期产出|完成标准|可用资料)[：:]/.test(input);
  return input.split(structured ? /\n(?=\s*(?:任务[：:]|\d+[.、)]))/ : /\n|[；;]/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, "").trim()).filter(Boolean).slice(0, 20);
}
export function rulePlan(input: string, date: string, agents: AgentView[]): TaskDraft[] {
  return taskInputs(input).map((material) => {
    const title = material.split(/\n|(?:预期产出|完成标准|可用资料)[：:]/)[0].replace(/^任务[：:]\s*/, "").trim().slice(0, 300) || "完善任务与产出";
    const human = /电话|沟通|会面|运动|就医|签字|面谈|拜访|支付|采购|亲自|付款|发送|发布|部署|联系|开会|会议|直播|面试|办理|执行代码|修改文件/.test(title);
    const ai = /写|稿|整理|总结|分析|代码|编程|方案|搜索|检索|资料/.test(title);
    const lane = human && ai ? "mixed" : ai ? "B" : "A";
    const role = /代码|编程|开发/.test(title) ? "coding" : /稿|写|文章/.test(title) ? "writing" : "research";
    const agent = agents.find((agent) => agent.enabled && agent.role === role) || agents.find((agent) => agent.enabled);
    const assignees: Array<"human" | "ai"> = lane === "A" ? ["human", "human", "human"] : lane === "B" ? ["ai", "ai", "ai"] : ["ai", "human", "human"];
    if (agent) {
      const importance = /重要|核心|关键|交付|收入|健康|目标/.test(title) ? 1 : 2;
      const urgency = /紧急|尽快|今天|今日|逾期|马上/.test(title) ? 1 : /本周|明天|近期/.test(title) ? 2 : 3;
      const dueAt = /今天|今日/.test(title) ? `${date}T23:59:00+08:00` : null;
      const output = material.match(/(?:预期产出|完成标准)[：:]\s*([^\n]+)/)?.[1].slice(0, 4000) || (human ? `完成“${title}”的准备材料与操作建议，由本人决定并执行现实操作，记录实际结果。` : `交付“${title}”的可用文本成果，明确依据、限制和待确认事项。`);
      return taskDraftSchema.parse({ title: title.slice(0, 300), lane: human ? "mixed" : "B", priority: priorityFor(importance, urgency), dueAt, actionId: null, sceneId: null, notes: material.slice(0, 20000),
        orchestration: { importance, urgency, reason: `规则判断：${importance === 1 ? "含核心目标或交付线索" : "未明确重要程度，待确认"}；${urgency === 1 ? "含今日或紧急要求" : "未明确紧迫期限，待确认"}。`, output,
          steps: [
            { dependsOn: [], kind: "suggest", reviewRequired: false, standard: "列出完成标准、必要条件、缺失资料和待决策点" },
            { dependsOn: [], kind: "produce", reviewRequired: false, standard: human ? "提供现实操作前所需的清单、话术或准备材料；未知事实标明待核实" : "提供可使用的初稿或代码建议；未知资料不得编造" },
            { dependsOn: [0, 1], kind: human ? "act" : "produce", reviewRequired: true, standard: output },
          ] },
        steps: [
          { title: `分析“${title}”的产出标准与阻塞条件`.slice(0, 300), assignee: "ai", agentId: agent.id, estimatedMinutes: 10, notes: title },
          { title: `准备“${title}”的初稿或操作材料`.slice(0, 300), assignee: "ai", agentId: agent.id, estimatedMinutes: 15, notes: title },
          { title: human ? `本人确认并完成“${title}”的现实操作`.slice(0, 300) : `整合“${title}”为最终交付稿`.slice(0, 300), assignee: human ? "human" : "ai", agentId: human ? null : agent.id, estimatedMinutes: human ? 30 : 15, notes: output },
        ], checkpoints: [],
      });
    }
    return { title: title.slice(0, 300), lane, priority: 2, dueAt: null, actionId: null, sceneId: null, notes: "",
      steps: ["明确目标和完成标准", "完成主要工作", "检查成果并记录结论"].map((step, index) => ({ title: step, assignee: assignees[index], agentId: null, estimatedMinutes: index === 1 ? 30 : 10, notes: "" })),
      checkpoints: [{ title: "检查任务进度与阻塞", dueAt: `${date}T16:00:00+08:00` }],
    };
  });
}
export function parsePlan(output: string) {
  const modelTask = z.preprocess((input) => {
    if (input && typeof input === "object" && "dueAt" in input && typeof input.dueAt === "string" && dateSchema.safeParse(input.dueAt).success)
      return { ...input, dueAt: `${input.dueAt}T23:59:00+08:00` };
    return input;
  }, taskDraftSchema);
  return z.object({ tasks: z.array(modelTask).min(1).max(20) }).parse(JSON.parse(output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""))).tasks;
}
export type PlanningContext = { sources?: Array<{ id: string; title: string; purpose: string; standard: string; dueAt: string | null; sceneId: string; actionId: string | null; goalTitle?: string; projectName?: string; estimatedHours?: number }>; results?: Array<{ title: string; result: string }>; planningBasis?: { goal: string; project: string } };
export async function orchestrate(input: string, date: string, agents: AgentView[], config: AIConfig, scenes: SceneRow[] = [], sceneId: string | null = null, context: PlanningContext = {}) {
  const fallback = () => ({ tasks: (context.sources?.length ? context.sources.map((source) => {
    const task = rulePlan(source.title.replace(/[\n；;]/g, " "), date, agents)[0];
    task.title = source.title; task.actionId = source.actionId; task.sceneId = source.sceneId;
    task.notes = `${source.purpose}\n完成标准：${source.standard || "待确认"}`;
    task.dueAt = source.dueAt;
    task.steps = task.steps.map((step) => ({ ...step, notes: task.notes, ...(source.estimatedHours !== undefined && step.assignee === "human" ? { estimatedMinutes: Math.max(1, Math.min(1440, Math.round(source.estimatedHours * 60 / task.steps.filter((row) => row.assignee === "human").length))) } : {}) }));
    if (task.orchestration && source.standard) { task.orchestration.output = source.standard; task.orchestration.steps[task.steps.length - 1].standard = source.standard; }
    if (task.orchestration && source.dueAt) {
      task.orchestration.urgency = shanghaiDate(new Date(source.dueAt)) <= date ? 1 : 2;
      task.orchestration.reason += "已结合原任务截止时间。";
      task.priority = priorityFor(task.orchestration.importance, task.orchestration.urgency);
    }
    return task;
  }) : rulePlan(input, date, agents)).map((task) => ({ ...task, sceneId: task.actionId ? task.sceneId : sceneId || task.sceneId || (scenes.length ? otherSceneId(scenes) : null) })), source: "规则编排" });
  if (!config.apiKey) return fallback();
  try {
    const response = await callModel(config, JSON.stringify({ input, taskInputs: taskInputs(input), date, ...context, scenes: scenes.map(({ id, name }) => ({ id, name })), selectedSceneId: sceneId, sceneInstruction: "每项任务返回sceneId，优先使用selectedSceneId，否则仅从提供的scenes选择，未知返回null。", agents: agents.filter((agent) => agent.enabled).map(({ id, name, role }) => ({ id, name, role })) }),
      `你是每日执行编排助手。以每项任务的预期产出和完成标准为起点，将输入拆成最多20项可执行任务，每项3至5步。充分利用AI做资料整理、分析、写作、代码建议、初稿和最终文本交付；人只承担必要决策、现实操作、授权和验收。未提供的资料、预算、工具权限不能假定具备。
只输出JSON {"tasks":[{"title":"","sceneId":null,"lane":"A|B|mixed","priority":2,"dueAt":null,"actionId":null,"notes":"","orchestration":{"importance":1,"urgency":2,"reason":"重要与紧迫判断的具体依据及未知条件","output":"明确可验收产出","steps":[{"dependsOn":[],"kind":"produce|suggest|decide|act","reviewRequired":false,"standard":"此步骤交付标准"}]},"steps":[{"title":"","assignee":"human|ai","agentId":null,"estimatedMinutes":15,"notes":"执行该步骤必需的资料"}],"checkpoints":[]}]}。
每个taskInputs对应恰好一个任务；同一交付物的组成（问题、模板、清单等）应拆为同一任务内的步骤，不得拆为多个需要互相引用结果的业务任务。本系统只支持任务内依赖，禁止仅在备注写“依赖任务X”。若sources非空则按sources，忽略taskInputs数量。尽可能把纯文本整理、汇总、版本标记全部交给AI；不得为了复制文本、记录决策、人工验收而额外安排重复人工步骤。纯文本任务可全部AI，最终交付使用reviewRequired=true由用户验收。
importance/urgency均为1高2中3低，结合日期和明确的截止要求、目标影响与阻塞程度判断，理由有事实依据，未知需人工确认，不能所有任务都高。priority按重要且紧迫=1，重要或紧迫=2，其余=3。
orchestration.steps与steps按位置一一对应，dependsOn为从0开始的前置步骤索引，不允许循环。没有真实依赖的AI步骤独立并行，不得人为串行；需要前一步产出的步骤必须依赖，建议最多两到三个独立准备步骤，再汇总交付。最终步骤以及所有没有后续步骤的成果必须reviewRequired=true，中间AI产出可false并自动继续；人工步骤必须true且kind=decide或act。AI步骤kind=produce或suggest，不代替人作最终决策。
A全部人工，B全部AI，mixed包含两者。AI只能直接产出文本、代码建议或整理所提供资料；对于联网、实际编码执行、外部沟通、付款、发布、运动等，只能提供建议或材料，最终现实操作需人工，不能伪装已执行。agentId仅使用提供的启用ID。既有results可作为参考但不是新任务已完成的证明；只使用当前输入和所选资料。
若sources不为空，按每个source分别返回恰好一项任务，actionId严格保留其原关联，场景沿用，不拆成多条业务任务、不遗漏、不重复。截止未知则null，不虚构日期；若输入明确今日截止，dueAt必须为如2026-10-08T23:59:00+08:00的完整ISO时间，不可只写日期。当前时区Asia/Shanghai。`, "", 120, true);
    const tasks = parsePlan(response.output);
    for (const task of tasks) {
      if (!task.orchestration) throw new Error("AI 未提供产出与编排依据");
      if (!context.sources?.length) task.actionId = null;
      else if (!context.sources.some((source) => source.actionId === task.actionId)) throw new Error("行动关联无效");
      if (task.sceneId && !scenes.some((scene) => scene.id === task.sceneId)) throw new Error("场景无效");
      task.sceneId = sceneId || task.sceneId || (scenes.length ? otherSceneId(scenes) : null);
      const source = context.sources?.find((source) => source.actionId === task.actionId);
      if (source) { task.sceneId = source.sceneId; task.dueAt = source.dueAt; }
      task.priority = priorityFor(task.orchestration.importance, task.orchestration.urgency);
      for (const step of task.steps) if (step.assignee === "ai" && !agents.some((agent) => agent.enabled && agent.id === step.agentId)) throw new Error("Agent 无效");
    }
    if (context.sources?.length && tasks.length !== context.sources.length) throw new Error("编排必须保留所有所选任务");
    if (!context.sources?.length && tasks.length !== taskInputs(input).length) throw new Error("AI 未按输入任务保留交付物与内部依赖");
    return { tasks, source: config.model || "AI 编排" };
  } catch (error) {
    const detail = error instanceof z.ZodError ? error.issues.slice(0, 2).map((issue) => `${issue.path.join(".")}：${issue.code}`).join("；") : error instanceof Error && (/^AI /.test(error.message) || ["Agent 无效", "场景无效", "AI 未提供产出与编排依据", "行动关联无效", "编排必须保留所有所选任务"].includes(error.message)) ? error.message : "返回内容格式无效";
    return { ...fallback(), warning: `AI 编排未通过校验或服务暂不可用（${detail}），已使用规则编排。` };
  }
}
