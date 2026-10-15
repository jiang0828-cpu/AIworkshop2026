import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AIConfig } from "./provider";

export function dailyAIConfig(): AIConfig {
  let bindings: Record<string, unknown> = {};
  try { bindings = getCloudflareContext().env as unknown as Record<string, unknown>; } catch { /* Local Node runtime. */ }
  const value = (name: string) => typeof bindings[name] === "string" ? bindings[name] as string : process.env[name];
  return { apiKey: value("AI_API_KEY"), baseUrl: value("AI_BASE_URL"), model: value("AI_MODEL") };
}
