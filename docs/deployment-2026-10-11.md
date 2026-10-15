# 工作台备份与部署记录（2026-10-11）

## 备份

- 完整工作台 JSON：`data/ai-workbench-backup-2026-10-11.json`
- Cloudflare D1 SQL：`data/ai-workbench-d1-backup-2026-10-11.sql`

备份文件不包含环境变量文件、API key 或密码。恢复前应先保留当前数据库副本；恢复运行中的业务数据前，先停止写入并确认目标环境。

## 数据库迁移

远端 D1 数据库 `ai-workbench-data` 已执行增量迁移 0003 至 0012，复查结果为 `No migrations to apply!`。迁移命令：

```powershell
npx wrangler d1 migrations apply ai-workbench-data --remote
```

## Cloudflare 部署

Web Worker：

- 地址：<https://ai-workbench.jianghaohan0828.workers.dev>
- 当前版本：`45fed894-fa20-406b-9949-c880b2479015`
- 根页面已验证 HTTP 200，API 继续使用现有认证保护。

每日调度 Worker：

- 地址：<https://ai-workbench-daily-scheduler.jianghaohan0828.workers.dev>
- 当前版本：`6b31f68b-b49b-469d-97b5-2549e5f23989`
- 调度频率：每分钟一次（`* * * * *`）。

Web Worker 与每日调度 Worker 均已配置所需的服务端 secrets；密钥值不写入文档、浏览器或任务日志。

## 本地与局域网访问

本地服务监听 `0.0.0.0:3012`，当前局域网地址：

<http://10.5.2.31:3012/>

已验证首页 HTTP 200。局域网其他设备需要与主机处于同一网络，并允许 Windows 防火墙放行 TCP 3012。

## 验证

- `npm test`：26 个测试文件、323 项测试通过。
- `npm run typecheck`：通过。
- 相关 ESLint 检查：通过。
- Cloudflare/OpenNext 构建与每日 Worker dry-run：通过。
- 远端 D1 迁移复查：无待执行迁移。

## 后续发布

```powershell
npm run cf:build
npx wrangler deploy --config wrangler.jsonc
npx wrangler deploy --config cloudflare/daily-wrangler.jsonc
```

发布前先执行备份，并确认环境变量和 Worker secrets 已在目标环境配置。生产 API 调用需要使用现有登录认证，不应在客户端写入密钥。
