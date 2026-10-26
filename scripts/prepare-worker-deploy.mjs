import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedEnv = path.join(root, ".open-next/cloudflare/next-env.mjs");
if (!fs.existsSync(generatedEnv)) throw new Error("Build the Cloudflare Worker before deployment");
const values = await import(pathToFileURL(generatedEnv).href);
const modes = ["production", "development", "test"];
// Server configuration comes from Worker vars/secrets, never from local .env fallbacks.
fs.writeFileSync(generatedEnv, modes.map(mode => `export const ${mode} = ${JSON.stringify(Object.fromEntries(Object.entries(values[mode] || {}).filter(([key]) => key.startsWith("NEXT_PUBLIC_"))))};\n`).join(""));
const copiedEnv = path.join(root, ".open-next/server-functions/default/.env");
if (fs.existsSync(copiedEnv)) {
  const privateDirectory = path.join(root, "output/private-worker-build");
  fs.mkdirSync(privateDirectory, { recursive: true });
  fs.renameSync(copiedEnv, path.join(privateDirectory, `${Date.now()}.env`));
}
console.log("Worker prepared: local server environment excluded; Cloudflare vars and secrets retained.");
