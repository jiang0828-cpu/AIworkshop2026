import { getCloudflareContext } from "@opennextjs/cloudflare";
export { isCloudSyncAuthorized } from "./cloud-sync-auth";

export function getCloudSyncConfig() {
  let token = process.env.CLOUD_SYNC_TOKEN;
  let runningOnCloudflare = false;
  try {
    const { env } = getCloudflareContext();
    runningOnCloudflare = Boolean(env.WORKBENCH_DB);
    token ??= env.CLOUD_SYNC_TOKEN;
  } catch {
    // The local Next.js server has no Cloudflare request context.
  }
  return { token: token?.trim() || "", runningOnCloudflare };
}

export function getCloudSyncTarget() {
  return process.env.CLOUD_SYNC_URL?.trim().replace(/\/$/, "") || "";
}
