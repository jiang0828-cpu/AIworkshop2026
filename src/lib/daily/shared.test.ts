import { describe, expect, it, vi, afterEach } from "vitest";
import { compareDailyTasks, computeMetrics, dateSchema, reportIsDue, shanghaiDate, taskDraftSchema, taskStatus, timerSeconds, type MetricTask } from "./shared";
import { callModel, parsePlan, rulePlan, taskInputs } from "./provider";
import { restoredStatus, dailyDataSchema } from "./backup";
import { dependencies, quadrant, readySteps, stepReady, workflowIssues } from "./workflow";
import { orchestrate } from "./provider";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const task = (overrides: Partial<MetricTask> = {}): MetricTask => ({ title: "Test", lane: "A", dueAt: null, completedAt: null,
  steps: [{ status: "pending", assignee: "human", estimatedMinutes: 30, timers: [], runs: [] }], ...overrides });
describe("每日协同编排与统计", () => {
  it("未完成任务按推荐开始时间、重要性和优先级排序，完成后移到末尾", () => {
    const tasks = [
      { id: "completed", priority: 1, schedule: { startsAt: "2026-10-15T07:00:00+08:00" }, steps: [{ status: "done" }] },
      { id: "important-later", priority: 1, orchestration: { importance: 1 }, schedule: { startsAt: "2026-10-15T10:00:00+08:00" }, steps: [{ status: "pending" }] },
      { id: "early-normal", priority: 2, orchestration: { importance: 2 }, schedule: { startsAt: "2026-10-15T09:00:00+08:00" }, steps: [{ status: "pending" }] },
      { id: "early-important", priority: 2, orchestration: { importance: 1 }, schedule: { startsAt: "2026-10-15T01:00:00Z" }, steps: [{ status: "review" }] },
    ];
    const ordered = () => [...tasks].sort(compareDailyTasks).map(task => task.id);
    expect(ordered()).toEqual(["early-important", "early-normal", "important-later", "completed"]);
    tasks[3].steps[0].status = "done";
    expect(ordered()).toEqual(["early-normal", "important-later", "completed", "early-important"]);
    expect(tasks[0].id).toBe("completed");
  });
  it("无推荐时间兼容历史优先级和截止时间，待验收不算完成，同值保持稳定", () => {
    const tasks = [
      { id: "later", priority: 1, dueAt: "2026-10-16T00:00:00Z", steps: [{ status: "pending" }] },
      { id: "earlier", priority: 1, dueAt: "2026-10-15T00:00:00Z", steps: [{ status: "produced" }] },
      { id: "low", priority: 3, steps: [{ status: "running" }] },
      { id: "same", priority: 3, steps: [{ status: "blocked" }] },
    ];
    expect([...tasks].sort(compareDailyTasks).map(task => task.id)).toEqual(["earlier", "later", "low", "same"]);
    expect(compareDailyTasks(tasks[2], tasks[3])).toBe(0);
  });
  const agents = [{ id: "writer", name: "写作", role: "writing", enabled: true, prompt: "写作", model: "", timeoutSeconds: 120 }];
  it("同一任务的资料和产出说明不拆成多个任务，模型日期兼容上海日末", () => {
    const input = "任务：准备访谈\n预期产出：五个问题；一份记录模板\n可用资料：产品方向待确认";
    expect(taskInputs(input)).toHaveLength(1);
    const draft = rulePlan(input, "2026-10-08", agents)[0];
    expect(draft.title).toBe("准备访谈"); expect(draft.orchestration!.output).toContain("记录模板");
    expect(parsePlan(JSON.stringify({ tasks: [{ ...draft, dueAt: "2026-10-08" }] }))[0].dueAt).toBe("2026-10-08T23:59:00+08:00");
    expect(() => parsePlan(JSON.stringify({ tasks: [{ ...draft, dueAt: "2026-02-30" }] }))).toThrow();
  });
  it("有 Agent 时按产出 AI 优先拆解，现实操作保留人工，依据重要紧迫排序", () => {
    const drafts = rulePlan("今天交付核心文稿\n整理参考资料\n与客户沟通付款", "2026-10-08", agents);
    expect(drafts.map((row) => row.lane)).toEqual(["B", "B", "mixed"]);
    expect(drafts[0].priority).toBe(1);
    expect(quadrant(drafts[0].orchestration!)).toBe("重要且紧迫");
    expect(drafts[0].orchestration!.steps.map((step) => step.dependsOn)).toEqual([[], [], [0, 1]]);
    expect(drafts[2].steps[2].assignee).toBe("human");
    drafts.forEach((row) => expect(taskDraftSchema.safeParse(row).success).toBe(true));
  });
  it("依赖无循环，最终交付必须验收，AI不能作现实操作", () => {
    const draft = rulePlan("生成文稿", "2026-10-08", agents)[0];
    const plan = structuredClone(draft.orchestration!);
    plan.steps[0].dependsOn = [2];
    expect(workflowIssues(draft.steps, plan)).toContain("循环");
    plan.steps[0].dependsOn = [];
    plan.steps[2].reviewRequired = false;
    expect(workflowIssues(draft.steps, plan)).toContain("最终成果");
    plan.steps[2].reviewRequired = true; plan.steps[0].kind = "act";
    expect(workflowIssues(draft.steps, plan)).toContain("不能");
  });
  it("并行准备与汇总依赖区别，未经最终验收不统计完成", () => {
    const draft = rulePlan("生成文稿", "2026-10-08", agents)[0];
    const task = { orchestration: draft.orchestration, steps: draft.steps.map((step, position) => ({ ...step, position, status: "pending" })) };
    expect(readySteps(task).map((step) => step.position)).toEqual([0, 1]);
    task.steps[0].status = "produced";
    expect(stepReady(task, 2)).toBe(false);
    task.steps[1].status = "produced";
    expect(stepReady(task, 2)).toBe(true);
    expect(taskStatus(task.steps)).toBe("pending");
    task.steps[2].status = "review";
    expect(taskStatus(task.steps)).toBe("review");
    expect(computeMetrics([taskForMetrics(task.steps)]) .completed).toBe(0);
    expect(dependencies({ steps: task.steps }, 2)).toEqual([0, 1]);
  });
  it("AI生成保留所选原行动和场景，失败回退仍保留完成标准", async () => {
    const source = { id: "action", actionId: "action", title: "完成文稿", purpose: "客户提案", standard: "一份含预算未知项的提案", sceneId: "work", dueAt: null };
    const draft = rulePlan(source.title, "2026-10-08", agents)[0]; draft.actionId = "action";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tasks: [draft] }) } }] }))));
    const result = await orchestrate("", "2026-10-08", agents, { apiKey: "test-only" }, [{ id: "work", slot: 0, name: "工作", position: 0 }], null, { sources: [source] });
    expect(result.source).toBe("AI 编排"); expect(result.tasks[0].sceneId).toBe("work"); expect(result.tasks[0].actionId).toBe("action");
    const fallback = await orchestrate("", "2026-10-08", agents, {}, [], null, { sources: [source] });
    expect(fallback.tasks[0].orchestration!.output).toBe(source.standard);
    expect(fallback.tasks[0].actionId).toBe("action");
  });
  it("分类和步骤执行人一致，混合任务包含人工环节", () => {
    const drafts = rulePlan("打电话确认项目\n编写代码\n整理方案并与客户沟通", "2026-10-01", []);
    expect(drafts.map((item) => item.lane)).toEqual(["A", "B", "mixed"]);
    drafts.forEach((item) => expect(taskDraftSchema.safeParse(item).success).toBe(true));
    expect(taskDraftSchema.safeParse({ ...drafts[0], lane: "B" }).success).toBe(false);
  });
  it("拒绝不存在的日期及 AI 返回的无效结构", () => {
    expect(dateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(() => parsePlan('{"tasks":[]}')).toThrow();
    const valid = rulePlan("亲自运动", "2026-10-01", []);
    expect(parsePlan(`\`\`\`json\n${JSON.stringify({ tasks: valid })}\n\`\`\``)).toEqual(valid);
  });
  it("待验收、失败和空步骤不能算完成", () => {
    expect(taskStatus([{ status: "done" }, { status: "review" }])).toBe("review");
    expect(taskStatus([])).toBe("pending");
    expect(computeMetrics([task({ steps: [{ status: "review", assignee: "ai", estimatedMinutes: 15, timers: [], runs: [] }] })]).completed).toBe(0);
  });
  it("计时按保存的起止时间累计，防止负时长", () => {
    expect(timerSeconds([{ startedAt: "2026-10-01T01:00:00Z", endedAt: "2026-10-01T01:05:00Z" }, { startedAt: "2026-10-01T01:10:00Z", endedAt: null }], new Date("2026-10-01T01:12:00Z"))).toBe(420);
    expect(timerSeconds([{ startedAt: "2026-10-01T01:00:00Z", endedAt: null }], new Date("2026-09-30"))).toBe(0);
  });
  it("无适用项重分配权重，无任务不评分，未来未到期任务不算迟到", () => {
    expect(computeMetrics([]).score).toBe(null);
    expect(computeMetrics([task()]).score).toBe(20);
    const done = task({ completedAt: "2026-10-01T10:00:00Z", steps: [{ status: "done", assignee: "human", estimatedMinutes: 30, timers: [], runs: [] }] });
    expect(computeMetrics([done]).score).toBe(100);
    expect(computeMetrics([task({ dueAt: "2026-10-02T00:00:00Z" })], new Date("2026-10-01T00:00:00Z")).punctualityRate).toBe(null);
    expect(computeMetrics([done, task({ dueAt: "2026-10-01T00:00:00Z" })], new Date("2026-10-01T01:00:00Z")).score).toBe(45);
  });
  it("北京时间22点日报边界及跨日", () => {
    expect(shanghaiDate(new Date("2026-09-30T16:00:00Z"))).toBe("2026-10-01");
    expect(reportIsDue("2026-10-01", new Date("2026-10-01T13:59:59Z"))).toBe(false);
    expect(reportIsDue("2026-10-01", new Date("2026-10-01T14:00:00Z"))).toBe(true);
  });
  it("恢复不会自动重启执行，旧备份可省略协同数据", () => {
    expect(["queued", "running", "preparing"].map(restoredStatus)).toEqual(["paused", "paused", "paused"]);
    expect(restoredStatus("review")).toBe("review");
    expect(dailyDataSchema.optional().parse(undefined)).toBeUndefined();
    expect(dailyDataSchema.parse({ agents: [], plans: [] })).toEqual({ agents: [], assets: [], plans: [] });
  });
});
function taskForMetrics(steps: Array<{ status: string; assignee: string; estimatedMinutes: number }>): MetricTask {
  return { title: "测试", lane: "B", dueAt: null, completedAt: null, steps: steps.map((step) => ({ ...step, timers: [], runs: [] })) };
}
describe("模型调用", () => {
  it("保留实际 token 用量，缺失时为null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "结果" } }] }))));
    const result = await callModel({ apiKey: "test-only", baseUrl: "https://example.invalid" }, "input", "prompt");
    expect(result.output).toBe("结果"); expect(result.promptTokens).toBe(null);
  });
  it("服务错误不泄露响应体和凭证", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("sensitive-provider-diagnostic", { status: 401 })));
    await expect(callModel({ apiKey: "test-only" }, "input", "prompt")).rejects.toThrow("HTTP 401");
  });
  it("空结果失败，不伪造执行成果", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"choices":[]}')));
    await expect(callModel({ apiKey: "test-only" }, "input", "prompt")).rejects.toThrow("空结果");
  });
  it("超时中止请求，返回可重试的错误", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const call = callModel({ apiKey: "test-only" }, "input", "prompt", "", 30);
    const assertion = expect(call).rejects.toThrow("调用超时");
    await vi.advanceTimersByTimeAsync(30000);
    await assertion;
  });
});
