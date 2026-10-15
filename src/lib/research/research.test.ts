import { describe, expect, it, vi, afterEach } from "vitest";
import { dedupeSources, redact, validateAnalysis, type Source } from "./shared";
import { checkPublicUrl, publicAddress, publicUrl, searchSources, tavily } from "./provider";

const source: Source = { id: "S1", title: "原文标题", url: "https://example.org/news", publisher: "example.org", publishedAt: null, collectedAt: "2026-10-02T12:00:00.000Z", content: "报告记录了技能需求的变化。", quality: "snippet", group: "example.org", original: false, note: "" };
const conclusion = { title: "关注技能变化", facts: "技能需求发生变化", relevance: "可能影响学习安排，是推断", nextStep: "核实数据", citations: [{ sourceId: "S1", quote: "技能需求的变化" }], backgroundIds: [], evidence: "单一来源", uncertainty: "仅摘要", change: "新增" };
afterEach(() => vi.unstubAllGlobals());
describe("研判来源与公开网络边界", () => {
  it("伪造编号、虚构摘录、未知背景与模型链接均被拒绝", () => {
    for (const change of [{ citations: [{ sourceId: "S99", quote: "技能" }] }, { citations: [{ sourceId: "S1", quote: "不存在的原文" }] }, { backgroundIds: ["private"] }, { facts: "https://fake.example/news" }]) expect(() => validateAnalysis({ conclusions: [{ ...conclusion, ...change }], gaps: "", changes: "" }, [source], [])).toThrow();
    expect(validateAnalysis({ conclusions: [conclusion], gaps: "", changes: "" }, [source], []).conclusions).toHaveLength(1);
  });
  it("未知日期保持未知；重复转载不能成为多源佐证；分歧可保留", () => {
    const sources = dedupeSources([source, { ...source, id: "S2", url: "https://another.example/news", group: "another.example" }]);
    expect(new Set(sources.map((row) => row.group)).size).toBe(1);
    const result = validateAnalysis({ conclusions: [{ ...conclusion, evidence: "多源一致", citations: [...conclusion.citations, { sourceId: "S2", quote: "技能需求的变化" }] }], gaps: "", changes: "" }, sources, []);
    expect(result.conclusions[0].evidence).toBe("单一来源");
    expect(searchSources({ results: [{ title: "新闻", url: "https://example.org", content: "摘要" }] }, 0)[0]).toMatchObject({ publishedAt: null, quality: "snippet" });
    expect(validateAnalysis({ conclusions: [{ ...conclusion, evidence: "存在分歧", uncertainty: "与另一期资料不同，待核实" }], gaps: "", changes: "" }, [source], []).conclusions[0].evidence).toBe("存在分歧");
  });
  it("没有资料不凑结论，联系方式脱敏", () => {
    expect(() => validateAnalysis({ conclusions: [conclusion], gaps: "", changes: "" }, [], [])).toThrow();
    expect(validateAnalysis({ conclusions: [], gaps: "没有资料", changes: "" }, [], []).conclusions).toEqual([]);
    expect(redact("张三在某某公司，13800138000，me@example.com", ["张三", "某某公司"])).not.toMatch(/张三|某某公司|13800138000|me@example.com/);
  });
  it.each(["http://localhost/a", "http://127.0.0.1", "http://2130706433", "http://0x7f000001", "http://192.168.1.1", "http://[::1]", "file:///etc/passwd", "https://user:pass@example.org", "http://server.local", "https://a.127.0.0.1.nip.io", "https://example.org:8443"])("拒绝非公开链接 %s", (url) => expect(() => publicUrl(url)).toThrow());
  it("DNS指向内网时拒绝，不直接请求目标或追随其重定向", async () => {
    expect(publicUrl("https://36kr.com/news")).toBe("https://36kr.com/news");
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ Answer: [{ type: 1, data: "10.0.0.1" }] })));
    vi.stubGlobal("fetch", fetcher);
    await expect(checkPublicUrl("https://example.org")).rejects.toThrow("非公开地址");
    expect(fetcher.mock.calls.every(([url]) => String(url).startsWith("https://cloudflare-dns.com/"))).toBe(true);
    expect(publicAddress("::ffff:127.0.0.1")).toBe(false); expect(publicAddress("8.8.8.8")).toBe(true);
  });
  it("超时错误与服务商错误体不泄露密钥，响应有大小上限", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret-key request failed")));
    await expect(tavily("search", "secret-key", {})).rejects.toThrow("检索服务连接失败或超时");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(2000001))));
    await expect(tavily("search", "secret-key", {})).rejects.toThrow("过大");
  });
});
