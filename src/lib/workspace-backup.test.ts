import { describe, expect, it } from "vitest";
import { backupDownloadSchema, readWorkspaceBackup, workspaceBackupFilename } from "./workspace-backup";

describe("完整工作台备份", () => {
  it("文件名按北京时间跨日，避免覆盖不同时间的备份", () => {
    expect(workspaceBackupFilename(new Date("2026-10-16T15:59:59Z"))).toBe("ai-workbench-backup-20261016-235959.json");
    expect(workspaceBackupFilename(new Date("2026-10-16T16:00:00Z"))).toBe("ai-workbench-backup-20261017-000000.json");
  });
  it("兼容旧完整备份，保留未识别的新增字段供恢复端校验", () => {
    const old = { format: "ai-workbench-backup", version: 1, data: { name: "", goals: [], actions: [] } };
    expect(readWorkspaceBackup(old)).toEqual(old);
    const current = { ...old, exportedAt: "2026-10-16T01:02:03Z", data: { ...old.data, strategy: { scenes: [] }, dailyCollaboration: {} } };
    expect(readWorkspaceBackup(current)).toEqual(current);
  });
  it("拒绝模块备份、错误版本和损坏内容，避免误导用户恢复", () => {
    for (const value of [null, [], "<html>login</html>", { format: "daily-collaboration-backup", version: 1, data: {} },
      { format: "ai-workbench-backup", version: 2, data: {} }, { format: "ai-workbench-backup", version: 1, data: null }]) {
      expect(() => readWorkspaceBackup(value)).toThrow("完整工作台备份");
    }
  });
  it("无效的浏览器导出记录不显示为成功备份", () => {
    expect(backupDownloadSchema.safeParse({ exportedAt: "invalid", bytes: 1, filename: "file.json" }).success).toBe(false);
    expect(backupDownloadSchema.safeParse({ exportedAt: "2026-10-16T01:02:03Z", bytes: 0, filename: "file.json" }).success).toBe(false);
  });
});
