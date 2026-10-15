import { describe, expect, it } from "vitest";
import { validateSelfAI } from "./self-ai-shared";

const response = { fields: { description: "整理后的真实经历" }, sceneIds: ["work"], explanation: "依据", questions: ["实际成果是什么？"] };
describe("认识自己 AI 草稿校验", () => {
  it("允许整理经历，不允许修改身份或状态", () => {
    expect(validateSelfAI(response, "experience", "organize", ["work"]).fields.description).toBeTruthy();
    expect(() => validateSelfAI({ ...response, fields: { profileId: "other" } }, "experience", "organize", ["work"])).toThrow();
  });
  it("分类不改正文，思考不改正文和场景", () => {
    expect(validateSelfAI(response, "experience", "classify", ["work"]).fields).toEqual({});
    expect(validateSelfAI(response, "experience", "reflect", ["work"])).toMatchObject({ fields: {}, sceneIds: [] });
  });
  it("拒绝未知或重复场景，愿景只允许一个主场景", () => {
    expect(() => validateSelfAI(response, "experience", "classify", [])).toThrow();
    expect(() => validateSelfAI({ ...response, sceneIds: ["work", "work"] }, "experience", "classify", ["work"])).toThrow();
    expect(() => validateSelfAI({ ...response, fields: {}, sceneIds: ["work", "health"] }, "vision", "classify", ["work", "health"])).toThrow();
  });
  it("能力评分不能由 AI 写入", () => {
    expect(() => validateSelfAI({ ...response, fields: { rating: "5" } }, "skill", "complete", ["work"])).toThrow();
  });
});
