# 工作台备份与发布 2026年10月26日

网站：<https://ai-workbench.jianghaohan0828.workers.dev>。

本次发布完整备份入口、目标项目任务的 Markdown 和 Word 导出、任务拖动调整项目归属、管理员设置及相关说明。保留本地 SQLite、线上 D1 各自的数据，不进行覆盖同步。

## 备份

本机目录：`data/releases/2026-10-26T01-24-28-948Z/`，未上传 GitHub 或 Worker 静态目录。

- `local.sqlite`：使用 `VACUUM INTO` 生成的一致性快照，完整性检查通过。
- `local-backup.json`：完整应用 JSON 备份，格式校验通过。
- `source.zip`：发布前代码快照，排除数据库、环境变量、依赖及构建目录。
- `cloudflare-before.sql`：发布前 D1 完整导出，已在内存 SQLite 中恢复，完整性及外键检查通过。
- `manifest.json`：备份文件大小和 SHA-256。
- `online-verification.json`：线上访问及本次程序文件哈希检查。

发布前云端迁移列表无待执行项，`0018_admin_accounts.sql` 已存在。未重建业务库、初始化示例数据或导入本地档案。

## 版本

- 网站代码版本：`45d57506-fae1-4236-b0b2-a2843db4642e`。
- 补齐网页 Worker 搜索 secret 后生效版本：`a4931691-849c-4e5d-afff-d656442f8a9b`。
- 发布前网站版本：`4d919042-de86-4d53-8b48-6b6580b5689b`。
- 后台调度器版本：`d55892e0-b988-4d07-a055-7c49841153e6`，保留每分钟触发。

已有 AI、同步和登录 secrets 未覆盖；网页 Worker 新增缺少的搜索 secret。发布前修正管理员 PBKDF2 次数为 Worker 生产支持的 100,000，管理员表为空，不涉及已有密码迁移。移除界面写死的邮箱。

OpenNext 会复制本地 `.env` 并生成环境回退模块。新增 `scripts/prepare-worker-deploy.mjs`，在 `npm run cf:deploy` 发布前只保留 `NEXT_PUBLIC_` 变量，将复制的本地配置移到忽略的 `output/`，服务端改用 Worker vars/secrets。清理后检查 1,442 个部署文件，未发现本地密钥值。

## 验证

- 全量测试降低并发后：39 个文件通过，452 项通过、1 项可选恢复演练跳过。首轮并行执行的超时和测试库锁冲突未复现。
- 新增管理员密码测试 2 项通过；Worker 本地运行时密码派生验证通过。
- Next.js 编译、ESLint、TypeScript 和页面生成通过；Cloudflare 网站及后台 Worker 打包和发布通过。
- 当前工具对 Next.js 15.5.24 提示支持期限警告，网站构建使用 `--dangerouslyUseUnsupportedNextVersion` 完成兼容打包；本次未升级框架。
- 线上根页面跳转登录页，登录页 HTTP 200；未登录数据及备份接口 401，错误凭据登录 401。
- 线上主页面 JavaScript 与本次构建 SHA-256 相同。
- 本地及局域网预览 HTTP 200，浏览器确认新导出入口可打开；线上浏览器确认登录页可用。未使用真实线上凭据登录、提交业务记录或触发模型付费测试。
- D1 发布前业务数量：1 份档案、13 个目标、10 个项目、22 个任务、1 份复盘；本地为 1 份档案、9 个目标、7 个项目、9 个任务。

## 后续发布

本地备份运行 `node scripts/backup-release.cjs`，随后使用 Wrangler 将 D1 导出到同一私有目录。保存应用完整 JSON 后，运行 `node scripts/verify-release-backup.cjs <备份目录>` 验证并更新清单。

发布使用 `npm run cf:deploy`，不要跳过环境清理步骤。运行 `node scripts/verify-deployment.cjs <线上地址> <检查结果文件>` 检查访问控制和应用文件。提交前运行 `node scripts/check-release-files.cjs` 检查暂存文件；备份和 secrets 留在本机或 Cloudflare。

回退代码前先检查数据和正在执行的任务；恢复数据库是独立操作，不能随代码回退覆盖现有资料。
