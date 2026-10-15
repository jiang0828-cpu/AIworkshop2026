import { describe, expect, it } from "vitest";
import { parseVisionModelOutput } from "./vision-plan";
const scenes = ["健康", "财务", "工作", "家庭", "爱好", "其他"].map((name, i) => ({ id: `scene-${i}`, name }));
const rows = () => scenes.map((scene) => ({ sceneId: scene.id, keywords: ["关键词"], reason: "原文依据", payload: { expected: "愿景", metric: "标准", horizon: "", boundary: "" } }));
describe("愿景 AI 格式兼容", () => {
  it("七场景含系统，仍按实际输入校验历史六场景草稿", () => {
    const current = [...scenes, { id: "scene-6", name: "系统" }];
    const output = [...rows(), { ...rows()[0], sceneId: "scene-6" }];
    expect(parseVisionModelOutput(JSON.stringify({ scenes: output }), current).scenes).toHaveLength(7);
    expect(() => parseVisionModelOutput(JSON.stringify({ scenes: rows() }), current)).toThrow("不完整");
    expect(parseVisionModelOutput(JSON.stringify({ scenes: rows() }), scenes).scenes).toHaveLength(6);
  });
  it("关键词超过12个或超过100字不阻断有效草稿", () => {
    const data = rows(); data[2].keywords = Array.from({ length: 20 }, (_, i) => `概念${i}`); data[2].keywords.push("长关键词".repeat(40));
    expect(parseVisionModelOutput(JSON.stringify({ scenes: data }), scenes).scenes[2].keywords).toHaveLength(21);
  });
  it("兼容关键词对象、分组和混合空值，无法展示的标签不阻断正文", () => {
    const data = rows().map((row) => ({ ...row, keywords: [{ keyword: "职业成长", weight: 0.8 }, { name: "独立" }, null, 4, { themes: ["学习", "独立"] }] }));
    const result = parseVisionModelOutput(JSON.stringify({ scenes: data }), scenes);
    expect(result.scenes[2].keywords).toEqual(["职业成长", "独立", "学习"]);
    expect(result.scenes[2].payload.expected).toBe("愿景");
  });
  it("接受标准结构", () => expect(parseVisionModelOutput(JSON.stringify({ scenes: rows() }), scenes).scenes).toHaveLength(6));
  it("兼容空值、文本数组、关键词字符串及精确场景名称", () => {
    const data = scenes.map((scene) => ({ sceneId: scene.name, keywords: "成长、平衡", reason: null, payload: { expected: ["第一点", "第二点"], metric: null, horizon: null, boundary: null } }));
    const result = parseVisionModelOutput('```json\n' + JSON.stringify({ scenes: data }) + '\n```', scenes);
    expect(result.scenes[0]).toMatchObject({ sceneId: "scene-0", keywords: ["成长", "平衡"], payload: { expected: "第一点\n第二点", metric: "" } });
  });
  it("兼容顶层数组和平铺字段", () => expect(parseVisionModelOutput(JSON.stringify(scenes.map((scene) => ({ sceneName: scene.name, expected: "状态" }))), scenes).scenes[0].payload.expected).toBe("状态"));
  it("不接受未知、重复、缺失场景或结构对象", () => {
    const data = rows(); data[0].sceneId = "未知";
    expect(() => parseVisionModelOutput(JSON.stringify({ scenes: data }), scenes)).toThrow();
    data[0].sceneId = data[1].sceneId;
    expect(() => parseVisionModelOutput(JSON.stringify({ scenes: data }), scenes)).toThrow();
    expect(() => parseVisionModelOutput(JSON.stringify({ scenes: rows().slice(1) }), scenes)).toThrow();
    expect(() => parseVisionModelOutput(JSON.stringify({ scenes: rows().map((row) => ({ ...row, payload: { expected: { fact: "无效" } } })) }), scenes)).toThrow();
  });
  it("截断 JSON 提供可理解的错误", () => expect(() => parseVisionModelOutput('{"scenes":', scenes)).toThrow("JSON 不完整"));
});
