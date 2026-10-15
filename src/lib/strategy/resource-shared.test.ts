import { describe, it, expect } from "vitest";
import { compareResources, readResourceLedger, resourceClasses, resourceDue, resourceLedgerSchema } from "./resource-shared";
import { resourceDemandSchema } from "./capability-plan";
import { shanghaiDate } from "../daily/shared";

describe("资源六类与排序", () => {
  it("六类决定要素，旧记录保留原要素和实际结果", () => {
    for (const item of resourceClasses) expect(resourceLedgerSchema.parse({ capitalClass: item.name, element: "待分类" }).element).toBe(item.element);
    expect(readResourceLedger({ element: "信息", actualReturn: "原成果" })).toMatchObject({ capitalClass: "待分类", element: "信息", actualReturn: "原成果", availability: "待确认", importance: "待确认" });
    expect(readResourceLedger({}, "待获取需求").availability).toBe("待获取");
    expect(() => resourceLedgerSchema.parse({ capitalClass: "能力" })).toThrow();
  });
  it("上海当天即为到期，非法日期拒绝", () => {
    const date = shanghaiDate(new Date("2026-10-05T16:00:00Z")); expect(date).toBe("2026-10-06");
    expect(resourceDue(resourceLedgerSchema.parse({ nextCheckDate: "2026-10-06" }), date)).toBe(true);
    expect(resourceDue(resourceLedgerSchema.parse({ nextCheckDate: "2026-10-07" }), date)).toBe(false);
    expect(resourceDue(resourceLedgerSchema.parse({}), date)).toBe(false);
    expect(() => resourceLedgerSchema.parse({ nextCheckDate: "2026-02-30" })).toThrow();
  });
  it("到期优先，再待获取不可用，再重要性与名称", () => {
    const rows = [
      { name: "普通", ledger: resourceLedgerSchema.parse({ importance: "关键", availability: "可用" }) },
      { name: "获取", ledger: resourceLedgerSchema.parse({ importance: "一般", availability: "待获取" }) },
      { name: "到期", ledger: resourceLedgerSchema.parse({ importance: "一般", nextCheckDate: "2026-10-06" }) },
      { name: "不可用", ledger: resourceLedgerSchema.parse({ importance: "关键", availability: "不可用" }) },
    ];
    expect(rows.sort((a, b) => compareResources(a, b, "2026-10-06")).map((row) => row.name)).toEqual(["到期", "不可用", "获取", "普通"]);
  });
  it("旧待选草稿无需重生成，六类可手动补充", () => {
    const old = { title: "时间", visionId: "vision", reason: "作品", requirements: "待确认", importance: "关键", element: "能量", allocation: "", boundary: "", expectedReturn: "", nextStep: "" };
    expect(resourceDemandSchema.parse(old).capitalClass).toBe("待分类");
    expect(resourceDemandSchema.parse({ ...old, capitalClass: "关系" }).element).toBe("信息");
  });
});
