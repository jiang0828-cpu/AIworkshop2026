# Agent、Tool 与 Skill 管理

入口：每日任务协同 → Agent 管理。管理页包含 Agent、Tool、Skill 三类资源，支持搜索、新增、编辑、启停；自定义 Tool / Skill 解除绑定后可删除。

- Agent：配置模型、角色提示、超时和绑定的 Tool / Skill。
- Tool：文本生成调用现有服务端模型；任务资料将当前步骤资料和前置结果送入模型。自定义 Tool 是操作指引，不调用外部接口。联网搜索和代码执行尚未接入每日执行器，不能启用。
- Skill：可复用的流程与交付要求，绑定后进入该 Agent 的执行提示。内置结构化写作、任务拆解、成果检查，可另建自定义流程。

新启动的 AI 步骤必须绑定已启用的文本生成 Tool，所有绑定资源须有效且启用。正在排队或执行的记录保留启动时的资源名称、内容和配置快照，后续编辑、停用或删除不改变已有快照。Skill 不能增加真实工具权限，最终成果仍需人工验收。

完整备份及每日协同 JSON 备份包含目录和绑定配置，云端同步随完整备份传输。旧备份缺少这些字段时恢复默认工具；个人档案备份不包含本模块。

## 数据迁移

本地增量迁移（先自动备份 SQLite，再执行事务，重复运行会跳过）：

```powershell
npm run db:migrate:daily-assets
npx prisma generate
npm run db:generate-model-metadata
```

Windows 上更新 Prisma 客户端前须停止占用客户端的本地服务及调度器，更新后重新启动。

Cloudflare 增量脚本：`cloudflare/migrations/0016_daily_assets.sql`。本次仅准备脚本，不执行远端迁移或生产部署；将来发布时先备份 D1，再执行迁移及两个 Worker 的构建部署。
