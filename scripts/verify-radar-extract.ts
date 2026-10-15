import { readFileSync, writeFileSync } from "node:fs";
import { checkPublicUrl, tavily } from "../src/lib/research/provider";
async function main() {
  const path = "data/radar-live-verification.json";
  const report = JSON.parse(readFileSync(path, "utf8"));
  const source = report.sources.find((s: { quality: string }) => s.quality === "text");
  const url = await checkPublicUrl(source.url);
  const result = await tavily("extract", process.env.TAVILY_API_KEY, { urls: [url], format: "text", extract_depth: "basic" });
  const extracted = result.results?.find(r => r.url === url);
  if (!extracted?.raw_content) throw new Error("真实正文提取未返回内容");
  report.extract = { url, characters: extracted.raw_content.length, credits: result.usage?.credits ?? null, passed: true };
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.extract));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "提取失败"); process.exitCode = 1; });
