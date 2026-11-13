// Partitioned reads bound each Worker invocation's CPU cost. Local/legacy
// servers may return the complete response, so they only receive one request.
export async function loadWorkbench(fetcher: typeof fetch = fetch) {
  async function read(part: string) {
    const response = await fetcher(`/api/data?part=${part}`, { cache: "no-store" });
    if (response.status === 401) throw new Error("登录已过期，请重新登录。");
    if (!response.ok) throw new Error("服务暂时无法读取数据，请稍后重试。");
    return { response, data: await response.json() };
  }
  const main = await read("main");
  if (main.response.headers.get("x-workbench-part") !== "main") return main.data;
  const [archive, strategy] = await Promise.all([read("archive"), read("strategy")]);
  if (archive.response.headers.get("x-workbench-part") !== "archive" || strategy.response.headers.get("x-workbench-part") !== "strategy") throw new Error("服务正在更新，请重新加载。");
  return { ...main.data, ...archive.data, ...strategy.data };
}
