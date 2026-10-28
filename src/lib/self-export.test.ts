import { describe, expect, it } from "vitest";
import { buildSelfExportRows } from "./self-export";
import { selfExcelWorkbook } from "./self-export-excel";

describe("认识自己导出", () => {
  it("保留档案、场景、标签和历史版本", () => {
    const rows = buildSelfExportRows({
      profile: { name: "测试用户", personalityTraits: "谨慎" },
      evidences: [{ id: "e1", ability: "沟通", evidence: "完成访谈" }],
      resources: [{ id: "r1", name: "时间", description: "每周可用" }],
      strategy: {
        scenes: [{ id: "s1", name: "工作", slot: 0, position: 0 }],
        records: [
          { id: "v1", kind: "vision", sceneId: "s1", title: "工作愿景", payload: JSON.stringify({ expected: "稳定产出" }) },
          { id: "tag1", kind: "tag", sceneId: null, title: "场景标签", payload: JSON.stringify({ subjectType: "evidence", subjectId: "e1", sceneIds: ["s1"] }) },
        ],
        versions: [{ id: "ver1", recordId: "v1", snapshot: JSON.stringify({ payload: JSON.stringify({ expected: "旧愿景" }) }), createdAt: "2026-10-28T00:00:00.000Z" }],
      },
    });
    expect(rows.some(row => row.section === "个人档案" && row.field === "性格特征")).toBe(true);
    expect(rows.some(row => row.section === "我的愿景" && row.scene === "工作" && row.value === "稳定产出")).toBe(true);
    expect(rows.some(row => row.section === "我的能力" && row.scene === "工作" && row.title === "沟通")).toBe(true);
    expect(rows.some(row => row.section === "历史版本" && row.value === "旧愿景")).toBe(true);
  });

  it("按板块创建工作表并拆分超长单元格", async () => {
    const workbook = selfExcelWorkbook([{ section: "我的资源", scene: "财务", title: "储备", field: "说明", value: "x".repeat(33000) }]);
    expect(workbook.worksheets.map(sheet => sheet.name)).toContain("我的资源");
    expect(workbook.getWorksheet("我的资源")?.rowCount).toBe(3);
    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });
});
