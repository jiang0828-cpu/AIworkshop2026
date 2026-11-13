import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shellPath = path.join(root, process.env.NEXT_DIST_DIR || ".next", "server/app/index.html");
if (!fs.existsSync(shellPath)) throw new Error("Build the Next.js homepage before deployment");
const shell = fs.readFileSync(shellPath, "utf8");
if (!shell.includes("/_next/static/") || !shell.includes("</html>")) throw new Error("Invalid workbench page shell");
fs.writeFileSync(path.join(root, ".open-next/workbench-shell.html"), shell);
const loginShell = fs.readFileSync(path.join(root, process.env.NEXT_DIST_DIR || ".next", "server/app/login.html"), "utf8");
if (!loginShell.includes("/_next/static/") || !loginShell.includes("</html>")) throw new Error("Invalid login page shell");
fs.writeFileSync(path.join(root, ".open-next/workbench-login.html"), loginShell);
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
