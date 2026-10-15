import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sourceSchema, type Source } from "./shared";

export function tavilyKey() {
  try { return (getCloudflareContext().env as unknown as Record<string, string>).TAVILY_API_KEY || process.env.TAVILY_API_KEY; }
  catch { return process.env.TAVILY_API_KEY; }
}
// No user URL is ever fetched by this application. Extraction is delegated to the
// fixed public Tavily endpoint; redirects cannot reach this host's private network.
export function publicUrl(input: string) {
  const url = new URL(input);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port && !["80", "443"].includes(url.port) || !host.includes(".") || host.includes(":") || /^(?:\d+\.){3}\d+$/.test(host) || /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host) || /\.(nip\.io|sslip\.io|localtest\.me)$/.test(host)) throw new Error("仅接受公开 HTTP(S) 网页域名地址");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  return url.toString();
}
export function publicAddress(address: string) {
  if (address.includes(":")) return /^2[0-9a-f]{3}:/i.test(address) && !/^2001:(db8|0):/i.test(address);
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19, 51].includes(b) || a === 203 && b === 0);
}
export async function checkPublicUrl(input: string) {
  const url = publicUrl(input), host = new URL(url).hostname;
  const addresses: string[] = [];
  for (const type of ["A", "AAAA"]) {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { Accept: "application/dns-json" }, redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("无法核实网页地址，请粘贴正文");
    const data = await response.json() as { Answer?: Array<{ type: number; data: string }> };
    addresses.push(...(data.Answer || []).filter((row) => [1, 28].includes(row.type)).map((row) => row.data));
  }
  if (!addresses.length || addresses.some((address) => !publicAddress(address))) throw new Error("网页指向非公开地址，请粘贴正文");
  return url;
}
type TavilyResponse = { results?: Array<{ title?: string; url: string; content?: string; raw_content?: string; published_date?: string }>; usage?: { credits?: number } };
export async function tavily(endpoint: "search" | "extract", key: string | undefined, body: object): Promise<TavilyResponse> {
  if (!key) throw new Error("未配置 TAVILY_API_KEY；可改用粘贴正文");
  try {
    const response = await fetch(`https://api.tavily.com/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ ...body, include_usage: true }), redirect: "error", signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`检索服务 HTTP ${response.status}`);
    const reader = response.body?.getReader(); if (!reader) throw new Error("检索服务返回空内容");
    let size = 0, text = ""; const decoder = new TextDecoder();
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2000000) { await reader.cancel(); throw new Error("检索响应过大，请缩小范围"); } text += decoder.decode(value, { stream: true }); }
    return JSON.parse(text + decoder.decode());
  } catch (error) { if (error instanceof Error && /^检索/.test(error.message)) throw error; throw new Error("检索服务连接失败或超时；请确认用量后手动重试"); }
}
export function searchSources(data: TavilyResponse, offset: number): Source[] {
  return (data.results || []).slice(0, 5).flatMap((row, index) => {
    try {
      const url = publicUrl(row.url), host = new URL(url).hostname;
      const parsedDate = row.published_date ? new Date(row.published_date) : null;
      return [sourceSchema.parse({ id: `S${offset + index + 1}`, title: (row.title || host).slice(0, 500), url, publisher: host, publishedAt: parsedDate && !Number.isNaN(+parsedDate) ? parsedDate.toISOString().slice(0, 10) : null, collectedAt: new Date().toISOString(), content: (row.raw_content || row.content || "").replace(/<[^>]*>/g, " ").slice(0, 16000), quality: row.raw_content ? "text" : "snippet", group: host.replace(/^www\./, ""), original: /\.gov(\.cn)?$/.test(host) })];
    } catch { return []; }
  });
}
