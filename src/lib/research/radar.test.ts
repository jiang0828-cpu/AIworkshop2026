import { describe, it, expect } from "vitest";
import { canRespond, radarSchema, radarReport, verificationSchema } from "./radar";
import { conclusionSchema, validateAnalysis } from "./shared";
import { signalSchema } from "../strategy/shared";

describe("外部环境雷达", () => {
  it("旧卡片兼容但不能伪造置信度，新卡片默认观察", () => {
    expect(signalSchema.parse({ type: "event", observedAt: "2026-10-04", verification: "待核验" }).radar).toBeUndefined();
    expect(conclusionSchema.parse({ title: "旧结论", facts: "事实", relevance: "", nextStep: "", backgroundIds: [], citations: [], evidence: "资料不足", uncertainty: "" }).radar).toBeUndefined();
    expect(canRespond(undefined)).toBe(false);
    expect(canRespond({ confidence: "低", confidenceReason: "仅有传闻" })).toBe(false);
    expect(canRespond({ confidence: "高" })).toBe(false);
    expect(canRespond({ confidence: "中", confidenceReason: "原始报告直接支持" })).toBe(true);
    expect(canRespond({ confidence: "高", confidenceReason: "报告", category: "噪声" })).toBe(false);
  });
  it("验证必须包含实际结果，日期和选项受校验", () => {
    expect(verificationSchema.safeParse({ id: crypto.randomUUID(), at: new Date().toISOString(), actual: " ", outcome: "符合" }).success).toBe(false);
    expect(radarSchema.safeParse({ reviewDate: "2026-02-31" }).success).toBe(false);
    expect(radarSchema.safeParse({ confidence: "100%" }).success).toBe(false);
  });
  it("月报只汇总已保存的事实和人工验证，反馈证据链接可备份", () => {
    const feedback = verificationSchema.parse({ id: crypto.randomUUID(), at: "2026-10-04T00:00:00.000Z", actual: "已核对 https://example.org/report", outcome: "偏离", reason: "样本不足", adjustment: "补充样本", rule: "先检查样本范围" });
    const conclusion = conclusionSchema.parse({ title: "观察", facts: "用户记录", relevance: "推断", nextStep: "核实", backgroundIds: [], citations: [], evidence: "资料不足", uncertainty: "", feedback: [feedback] });
    expect(() => validateAnalysis({ conclusions: [conclusion], gaps: "", changes: "" }, [{ id: "M1", title: "记录", url: null, publisher: "手动", publishedAt: null, collectedAt: feedback.at, content: "用户记录", quality: "manual", group: "manual", original: false, note: "" }], [])).not.toThrow();
    const report = radarReport("2026-10", [{ title: "观察", facts: "用户记录", judgement: "推断", response: "核实", feedback: [feedback], sources: ["手动记录"] }]);
    expect(report).toContain("置信度：待评估"); expect(report).toContain("先检查样本范围"); expect(report).toContain("偏离");
    expect(radarReport("2026-10", [])).toContain("没有已保存");
  });
});
