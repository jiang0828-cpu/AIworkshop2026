import { describe, expect, it } from "vitest";
import { sceneDefaults } from "../scenes";
import { redact } from "../ai";
import { profileSceneFields, profileSceneSchema, profileScenesSaveSchema } from "./profile-scenes";
import { sceneProfileGroups, validateProfileSceneDetails } from "./profile-scene-layout";

describe("场景档案参数适配", () => {
  it.each(sceneDefaults)("$name 三个板块的字段完整且不重复", ({ slot }) => {
    const groups = sceneProfileGroups(slot);
    expect(groups.map(group => group.title)).toEqual(["当前身份", "人生阶段", "现实情况"]);
    const fields = groups.flatMap(group => group.fields);
    expect(new Set(fields.map(field => field.key)).size).toBe(fields.length);
    expect(fields.every(field => field.label && field.placeholder)).toBe(true);
    const input = Object.fromEntries(fields.map(field => [field.key, "实际填写"]));
    const payload = profileSceneSchema.parse({ sceneDetails: input });
    expect(() => validateProfileSceneDetails(payload.sceneDetails, slot)).not.toThrow();
    expect(groups[1].fields[0].suggestions?.length).toBeGreaterThan(0);
  });
  it("健康、财务、家庭和爱好不展示工作专用字段", () => {
    for (const slot of [3, 1, 2, 5, 4]) {
      const fields = sceneProfileGroups(slot).flatMap(group => group.fields);
      expect(fields.some(field => field.key === "organization" || /行业|职位|岗位/.test(field.label))).toBe(false);
    }
    expect(sceneProfileGroups(3)[1].fields[0].label).toBe("当前健康阶段");
    expect(sceneProfileGroups(1)[1].fields[0].label).toBe("当前财务阶段");
    expect(sceneProfileGroups(0)[1].fields[0].suggestions).toContain("转型与调整");
    expect(sceneProfileGroups(5)[1].fields[0].suggestions).toContain("创作与展示");
  });
  it("旧资料不重命名或推断，自定义阶段与新参数可以共存", () => {
    const old = { industry: "历史行业", stage: "历史阶段", healthEnergy: "原有说明" };
    expect(profileSceneFields(old)).not.toHaveProperty("sceneDetails");
    const updated = profileSceneFields({ ...old, sceneDetails: { role: "个人健康管理", stage: "自定义过渡期" } });
    expect(updated).toMatchObject({ ...old, sceneDetails: { role: "个人健康管理", stage: "自定义过渡期" } });
    expect(profileSceneSchema.safeParse({ sceneDetails: { missingKey: "未知" } }).success).toBe(false);
    expect(() => validateProfileSceneDetails({ organization: "工作组织" }, 3)).toThrow("不匹配");
    expect(() => validateProfileSceneDetails({ stage: "准备" }, undefined)).toThrow("场景类型无效");
    expect(profileScenesSaveSchema.safeParse({ global: { sceneDetails: { role: "不能写入全局数据库列" } }, scenes: [] }).success).toBe(false);
  });
  it("新参数沿用嵌套敏感字段授权，不生成默认事实", () => {
    expect(profileSceneSchema.parse({})).not.toHaveProperty("sceneDetails");
    const input = { sceneDetails: { organization: "私密组织", incomeRange: "私密收入", healthEnergy: "私密状态", familyResponsibilities: "私密责任", role: "可用角色" } };
    expect(redact(input, "姓名和联系方式脱敏", [])).toEqual({ sceneDetails: { role: "可用角色" } });
    expect(redact(input, "姓名和联系方式脱敏", ["healthEnergy"])).toEqual({ sceneDetails: { role: "可用角色", healthEnergy: "私密状态" } });
  });
});
