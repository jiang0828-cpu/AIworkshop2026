import { getCloudflareContext } from "@opennextjs/cloudflare";
import { readStoredAdmin, verifyAdminPassword, type StoredAdmin } from "./admin-auth";

export type AuthConfig = {
  email?: string;
  password?: string;
  passwordHash?: string;
  sessionSecret?: string;
  runningOnCloudflare: boolean;
  storedAdmin?: StoredAdmin | null;
};

export async function getAuthConfig(): Promise<AuthConfig> {
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

  const storedAdmin = await readStoredAdmin();
  if (storedAdmin) return { email: storedAdmin.email, passwordHash: storedAdmin.passwordHash, sessionSecret: storedAdmin.passwordHash, runningOnCloudflare, storedAdmin };
  return { email, password, sessionSecret: password, runningOnCloudflare, storedAdmin: null };
}

export async function verifyConfiguredPassword(candidate: string, config: AuthConfig) {
  if (config.passwordHash) return verifyAdminPassword(candidate, config.passwordHash);
  return Boolean(config.password && candidate === config.password);
}
