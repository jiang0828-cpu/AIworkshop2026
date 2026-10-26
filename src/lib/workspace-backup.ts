import { z } from "zod";

// Keep the envelope compatible with old backups; the restore API validates all records.
export const workspaceBackupSchema = z.object({
  format: z.literal("ai-workbench-backup"),
  version: z.literal(1),
  exportedAt: z.string().datetime({ offset: true }).optional(),
  data: z.record(z.unknown()),
}).passthrough();

export const backupDownloadSchema = z.object({
  exportedAt: z.string().datetime({ offset: true }),
  filename: z.string().min(1),
  bytes: z.number().int().positive(),
});
export type BackupDownload = z.infer<typeof backupDownloadSchema>;

export function workspaceBackupFilename(date: Date) {
  const stamp = new Date(date.getTime() + 8 * 60 * 60 * 1000)
    .toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `ai-workbench-backup-${stamp}.json`;
}

export function readWorkspaceBackup(value: unknown) {
  const result = workspaceBackupSchema.safeParse(value);
  if (!result.success) throw new Error("请选择完整工作台备份 JSON 文件，模块导出文件不能用于完整恢复。");
  return result.data;
}
