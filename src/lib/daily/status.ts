// Keep read-only status helpers separate from the orchestration schemas so the
// edge dashboard can load without initializing unrelated validation modules.
let shanghaiFormatter: Intl.DateTimeFormat | undefined;
export function shanghaiDate(now = new Date()) {
  shanghaiFormatter ??= new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
  return shanghaiFormatter.format(now);
}
export function taskStatus(steps: Array<{ status: string }>) {
  if (!steps.length) return "pending";
  if (steps.every((step) => step.status === "done")) return "done";
  for (const status of ["blocked", "failed", "review", "running", "preparing", "queued", "paused"])
    if (steps.some((step) => step.status === status)) return status;
  return steps.every((step) => ["done", "produced"].includes(step.status)) ? "review" : "pending";
}
