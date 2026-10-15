import { aiResponseSchema, parseSensitiveProfileAiFields, sensitiveProfileAiFields } from "./schemas";

export type AIRequest = { kind: "questions" | "analysis" | "extraction" | "suggestion"; context: unknown; scope: string[] };
export type AIResult = { configured: boolean; source: string; items: Array<{ title: string; content: string; category?: string }>; sentScope: string[]; error?: string };

function parseStructuredResponse(content: string, kind: AIRequest["kind"]) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("AI 响应不是 JSON 对象");
  // The requested operation determines the record type; compatible providers may use a different label.
  return aiResponseSchema.parse({ ...parsed, kind });
}

function fallback(request: AIRequest, configured = false): AIResult {
  const base = request.kind === "questions" ? [
    { title: "最近什么事情最值得继续？", content: "请描述具体事实、你的判断，以及你希望保留的部分。", category: "事实" },
    { title: "当前最重要的取舍是什么？", content: "请列出两个互相冲突的选择，并说明你愿意承担的代价。", category: "偏好" },
    { title: "有什么判断还缺少证据？", content: "把你目前相信但尚未验证的想法写下来，并注明验证方式。", category: "待验证假设" },
    { title: "下一周最小可完成的一步是什么？", content: "只写一个可以在 2 小时内完成、且能产生证据的动作。", category: "行动" },
  ] : [{ title: "规则模式建议", content: "当前未配置 AI 服务。请先通过表单补充事实，再用一周行动验证关键假设。", category: "待确认" }];
  return { configured, source: "规则模板", items: base, sentScope: request.scope };
}

export async function runAI(request: AIRequest): Promise<AIResult> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return fallback(request);
  const baseUrl = process.env.AI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.AI_MODEL || "deepseek-reasoner";
  const prompt = `你是 AI 工作台的结构化访谈助手。只根据输入，不替用户合理化；区分事实、判断、偏好、约束、推断、待验证假设。生成 3 至 5 条建议，不得超过 5 条。输出严格 JSON：{"kind":"${request.kind}","items":[{"title":"","content":"","category":""}]}。发送范围：${request.scope.join("、")}。输入：${JSON.stringify(request.context)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }), signal: controller.signal });
    if (!response.ok) return { ...fallback(request, true), error: `AI 服务返回 ${response.status}，已切换为规则模式。` };
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = parseStructuredResponse(json.choices?.[0]?.message?.content || "{}", request.kind);
    return { configured: true, source: model, items: parsed.items.slice(0, 5), sentScope: request.scope };
  } catch (error) {
    const message = error instanceof DOMException && error.name === "AbortError" ? "AI 请求超时，已切换为规则模式。" : "AI 返回无法通过结构化校验，已切换为规则模式。";
    return { ...fallback(request, true), error: message };
  } finally {
    clearTimeout(timeout);
  }
}

export function redact(value: unknown, options: string, authorizedProfileFields: string[] = []) {
  const enabled = /脱敏/.test(options) && !/不脱敏|关闭|无脱敏/.test(options);
  const sensitive = /^(name|phone|mobile|email|contact|address|idNumber|姓名|电话|手机号|邮箱|联系方式|住址|地址|证件号码)$/i;
  const authorized = new Set(authorizedProfileFields);
  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(Object.entries(input as Record<string, unknown>).flatMap(([key, child]) => {
      if ((sensitiveProfileAiFields as readonly string[]).includes(key) && !authorized.has(key)) return [];
      return [[key, enabled && sensitive.test(key) ? "[已脱敏]" : walk(child)]];
    }));
  };
  return walk(value);
}

export function authorizedSensitiveProfileFields(profile: unknown) {
  const row = profile && typeof profile === "object" ? profile as Record<string, unknown> : {};
  return parseSensitiveProfileAiFields(row.sensitiveAiFields);
}
