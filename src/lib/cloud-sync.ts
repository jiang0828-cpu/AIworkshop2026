import { getCloudflareContext } from "@opennextjs/cloudflare";

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

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

export function isCloudSyncAuthorized(provided: string | null, expected: string) {
  return Boolean(provided && expected && constantTimeEqual(provided, expected));
}

export function getCloudSyncTarget() {
  return process.env.CLOUD_SYNC_URL?.trim().replace(/\/$/, "") || "";
}
