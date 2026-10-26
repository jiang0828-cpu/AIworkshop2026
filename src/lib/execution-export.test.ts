import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { Packer } from "docx";
import { buildExecutionDocument, executionExportFilename, executionMarkdown, exportDate, type ExecutionExportRecord, type ExportSection } from "./execution-export";
import { executionWordDocument } from "./execution-export-word";
import type { TreeFilters } from "./execution-tree";

const scenes = [{ id: "work", name: "工作", slot: 0, position: 0 }, { id: "other", name: "其他", slot: 4, position: 1 }];
const goals: ExecutionExportRecord[] = [
  { id: "g1", title: "长期目标", horizon: "5年", sceneId: "work", metric: "长期成果", description: "完整说明" },
  { id: "g2", parentId: "g1", title: "年度目标", horizon: "1年", sceneId: "work", deadline: "2027-01-01T00:00:00Z", metric: "年度成果" },
  { id: "g3", title: "其他目标", sceneId: "other" },
];
const projects: ExecutionExportRecord[] = [
  { id: "p1", name: "项目一", goalId: "g2", sceneId: "work", recordCode: "20261025A01", description: "交付说明", metric: "可验收成果", budget: "每周 2 小时", boundary: "只做一期", stopCondition: "超出时间停止", risk: "时间不足", milestones: [{ title: "首期交付", status: "进行中", deadline: "2026-11-01T00:00:00Z", metric: "报告一份" }] },
  { id: "p2", parentId: "p1", name: "子项目", goalId: "g2" },
  { id: "p3", name: "独立项目", goalId: "deleted-goal" },
];
const actions: ExecutionExportRecord[] = [
  { id: "a1", title: "父任务", projectId: "p2", goalId: "g2", status: "进行中" },
  { id: "a2", title: "子任务命中", parentId: "a1", projectId: "p2", goalId: "g2", purpose: "验证需求\n保留第二行", recordCode: "20261025B01", dueDate: "2026-10-25T16:00:00Z", recurrence: "weekly", estimatedHours: 1 / 60, standard: "明确交付标准" },
  { id: "a3", title: "目标直属任务", goalId: "g2", status: "已完成", completedAt: "2026-10-24T16:00:00Z" },
  { id: "a4", title: "独立任务", projectId: "deleted-project" },
  { id: "a5", title: "独立项目的任务", projectId: "p3" },
];
const filters: TreeFilters = { scene: "all", horizon: "all", status: "all", query: "", incomplete: false };
const input = { scenes, goals, projects, actions, filters, scope: "all" as const, now: new Date("2026-10-25T08:00:00Z") };
function nodes(sections: ExportSection[]): ExportSection[] { return sections.flatMap(section => [section, ...nodes(section.children)]); }

describe("目标项目任务层级导出", () => {
  it("完整保留多级归属、直属任务、独立记录及里程碑，所有记录恰好出现一次且不修改业务内容", () => {
    const before = JSON.stringify(input), document = buildExecutionDocument(input), all = nodes(document.sections);
    expect(document.counts).toEqual({ goals: 3, projects: 3, actions: 5, context: 0 });
    const hierarchy = document.sections[0].children[0].children[0];
    expect(hierarchy.id).toBe("g2");
    expect(hierarchy.children[0].id).toBe("p1");
    expect(hierarchy.children[0].children[0].children[0].children[0].id).toBe("a2");
    expect(new Set(all.filter(row => row.id).map(row => row.id)).size).toBe(11);
    const md = executionMarkdown(document);
    for (const value of ["每周 2 小时", "只做一期", "超出时间停止", "时间不足", "首期交付", "报告一份", "20261025B01", "验证需求", "保留第二行", "1 分钟", "每周", "2026-10-26", "2026-10-25", "未关联目标的项目", "未关联项目的独立任务", "目标直属任务"]) expect(md).toContain(value);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("当前筛选仅包含命中记录及其上级路径，不包含折叠状态和无关兄弟任务", () => {
    const document = buildExecutionDocument({ ...input, scope: "filtered", filters: { ...filters, scene: "work", query: "子任务命中" } });
    expect(document.counts).toEqual({ goals: 2, projects: 2, actions: 2, context: 5 });
    const all = nodes(document.sections);
    expect(all.filter(row => row.id).map(row => row.id)).toEqual(["g1", "g2", "p1", "p2", "a1", "a2"]);
    expect(all.find(row => row.id === "a1")?.metadata).toContain("上级路径");
    expect(all.find(row => row.id === "a2")?.metadata).not.toContain("上级路径");
  });
  it("勾选目标导出其全部下级，不带入无关目标且不受列表筛选限制", () => {
    const document = buildExecutionDocument({ ...input, scope: "selected", selected: ["g2"], filters: { ...filters, query: "不存在" } });
    expect(nodes(document.sections).filter(row => row.id).map(row => row.id)).toEqual(["g2", "p1", "p2", "a1", "a2", "a3"]);
    expect(document.counts).toEqual({ goals: 1, projects: 2, actions: 3, context: 0 });
    expect(buildExecutionDocument({ ...input, scope: "selected", selected: ["missing"] }).sections).toEqual([]);
  });
  it("兼容遗留循环和丢失关联，不重复或遗漏记录", () => {
    const broken = buildExecutionDocument({ ...input, goals: [{ id: "c1", parentId: "c2" }, { id: "c2", parentId: "c1" }],
      projects: [{ id: "p1", parentId: "p2", goalId: "c1" }, { id: "p2", parentId: "p1", goalId: "c1" }],
      actions: [{ id: "a1", parentId: "a2", projectId: "p1" }, { id: "a2", parentId: "a1", projectId: "p1" }, { id: "a3", projectId: "deleted", goalId: "deleted" }] });
    expect(broken.counts).toMatchObject({ goals: 2, projects: 2, actions: 3 });
    expect(new Set(nodes(broken.sections).filter(row => row.id).map(row => row.id)).size).toBe(7);
  });
  it("空筛选不伪造内容，未知场景不丢失，日期和文件名使用北京时间", () => {
    expect(buildExecutionDocument({ ...input, scope: "filtered", filters: { ...filters, query: "不存在" } }).sections).toEqual([]);
    const unknown = buildExecutionDocument({ ...input, scenes: [], goals: [{ id: "unknown", sceneId: "missing", title: "未知场景内容" }], projects: [], actions: [] });
    expect(executionMarkdown(unknown)).toContain("未知场景内容");
    expect(exportDate("2026-10-25T16:00:00Z")).toBe("2026-10-26");
    expect(exportDate(null)).toBe("未设置");
    expect(executionExportFilename(new Date("2026-10-25T16:00:00Z"), "md")).toBe("目标与执行-20261026-000000.md");
    expect(executionExportFilename(new Date("2026-10-25T16:00:00Z"), "docx")).toBe("目标与执行-20261026-000000.docx");
  });
  it("Markdown 转义用户标题及文本，Word 生成真实可编辑的 DOCX 并保留标题层级和特殊字符", async () => {
    const document = buildExecutionDocument({ ...input, goals: [{ id: "g1", title: "测试 <script> & **内容**", sceneId: "work", description: "保留中文\n第二行 & <xml>" }], projects: [], actions: [] });
    const md = executionMarkdown(document);
    expect(md).toContain("\\<script\\> & \\*\\*内容\\*\\*");
    const zip = await JSZip.loadAsync(await Packer.toBuffer(executionWordDocument(document)));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("&lt;script&gt; &amp; **内容**");
    expect(xml).toContain("第二行 &amp; &lt;xml&gt;");
    expect(xml).toContain('w:pStyle w:val="Title"');
    expect(xml).toContain('w:pStyle w:val="Heading2"');
    expect(xml).toContain('w:w="12240"');
    expect(await zip.file("word/styles.xml")!.async("string")).toContain('w:outlineLvl w:val="8"');
    expect(zip.file("word/footer1.xml")).not.toBeNull();
  });
});
