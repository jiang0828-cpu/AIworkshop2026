import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });
const config = [...compat.extends("next/core-web-vitals", "next/typescript"), { ignores: [".next/**", ".next-*/**", ".open-next/**", "**/.wrangler/**", ".playwright-cli/**", "output/playwright/**", "src/generated/**", "generated/**", "node_modules/**", "next-env.d.ts", "scripts/init-db.cjs"] }];
export default config;
