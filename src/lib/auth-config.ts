import { getCloudflareContext } from "@opennextjs/cloudflare";

export function getAuthConfig() {
  let email = process.env.APP_AUTH_EMAIL;
  let password = process.env.APP_AUTH_PASSWORD;
  let runningOnCloudflare = false;

  try {
    const { env } = getCloudflareContext();
    runningOnCloudflare = Boolean(env.WORKBENCH_DB);
    email ??= env.APP_AUTH_EMAIL;
    password ??= env.APP_AUTH_PASSWORD;
  } catch {
    // The local Next.js server has no Cloudflare bindings.
  }

  return { email, password, runningOnCloudflare };
}
