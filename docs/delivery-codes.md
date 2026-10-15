# 项目、任务编号与交付计划

- 保留内部 ID 和所有现有关系，另增只读业务编号 `recordCode`。
- 编号为上海创建日期 + 类型 + 递增序号，例如 `20261015A01`（项目）、`20261015B01`（任务）。同一天超过 99 条时序号继续增长。修改标题、状态、交付日期不改号，删除不复用编号。
- 数据库触发器覆盖手工、AI 确认、原子 SQL、导入等所有创建路径。流水分配与业务写入处于同一事务；失败回滚。
- 项目使用 `deadline`，任务继续使用 `dueDate`。编辑表单要求交付日期；尚未确定日期的历史内容及 AI 草稿保留为空，待人工补齐。
- 迁移只用已记录的最晚里程碑或任务日期补齐历史项目，不推测未知日期。
- 周、月、年计划根据记录的交付日期自动显示同一记录。项目有当期里程碑或任务时也显示其上下文，避免遗漏。日期修改后重新归类，无需复制。
- 列表上的周、月、年入口跳转至交付日所在周期；计划页可选日期，日期保存在 URL，支持刷新和返回。
- 完整备份及同步保留编号、创建时间与交付日期。旧备份没有编号时重新分配，内部 ID 不变；不复原或清空流水表，避免复用已使用编号。

## 本地迁移

运行 `npm run db:migrate:delivery`，脚本先在线备份 SQLite，再增量迁移，可重复执行。随后运行 `npx prisma generate` 和 `node scripts/generate-prisma-models.cjs`，重启本地 Next.js 服务。

## Cloudflare

生产数据库需先应用 `cloudflare/migrations/0014_delivery_codes.sql`，再发布应用。本次不执行远端迁移或部署。SQL 使用 D1 的 SQLite 引擎；参见 [D1 SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/)。
