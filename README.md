# AI 工作台

一个本地优先的中文个人定义与 AI 协作记录工具。结构化数据保存在 SQLite，五份 Markdown 档案可以随时重新生成、编辑、查看历史和下载。

## 产品与使用文档

- [产品需求文档](docs/产品需求文档.md)：产品定位、模块职责、业务流程、数据规则与验收标准。
- [技术文档](docs/技术文档.md)：架构、数据模型、API、后台队列、环境配置、迁移与部署。
- [使用说明文档](docs/使用说明文档.md)：日常操作、AI 启动、人工验收、计划复盘、备份和常见问题。

以上文档按 2026-10-15 的代码现状整理；历史专项方案与当前实现有差异时，优先核对这三份文档及实际代码。

## 代码与发布

- GitHub：<https://github.com/jiang0828-cpu/AIworkshop2026>
- 线上工作台：<https://ai-workbench.jianghaohan0828.workers.dev>
- 最近发布记录：[2026-10-26](docs/deployment-2026-10-26.md)。网站与后台调度器使用 Cloudflare Workers，线上数据使用 D1，本地数据使用 SQLite。

仓库仅备份程序代码、数据库结构与迁移、测试和技术文档。实际数据库、个人资料、完整导出备份、环境变量与密钥保留在本地或 Cloudflare secrets，不提交到仓库。克隆后按下方说明配置环境并初始化数据库。推送代码不会自动部署；发布仍使用现有 Cloudflare 命令。

## AI 使用中心

导航中的“AI 使用中心”提供一条本地可控的协作流程：个人档案 → 个人 AI 身份卡 → 任务相关上下文包 → AI 任务清单 → 复制或下载提示词 → 任务反馈 → 待确认纠正记录。

- 身份卡生成 `06-个人AI身份卡.md`，可选精简、标准、详细三种长度；每次生成或编辑均保存草稿版本，只有确认后成为当前版本。
- 上下文包生成 `07-AI上下文包.md`，按任务领域选择最小充分的资料，先显示精确隐私预览；支持 Markdown、纯文本与 JSON 下载。上下文条目和引用字段在创建时保存快照。
- 任务清单生成 `08-AI任务清单.md`，按固定八段结构组装，可复制给 ChatGPT、Codex 或其他 AI。L3/L4 仅用于本地工作台后续步骤和提醒，不连接第三方账户或外部执行器。
- 健康、财务、法律、重大决策和高风险任务默认使用 L1/L2。提升到 L3/L4 需要二次确认并说明原因。
- AI 任务反馈只能产生“待确认”的档案纠正建议；确认后保存为纠正记录，不会自动改写 Profile 或既有五份正式档案。

## 每日任务协同

“每日任务协同”支持文本待办编排、A/B/混合任务、人工计时、AI 后台并行、人工验收、检查点与每日复盘。沿用 SQLite/D1；本地运行 `npm run daily:worker` 启动持续后台执行。支持关联已有行动、JSON 备份和 Markdown 日报。操作和最新执行边界见 [使用说明](docs/使用说明文档.md)，早期专项说明见 [每日任务协同](docs/每日任务协同.md)。

## 本地运行

环境要求：Node.js 24+、npm 11+。

```bash
npm install
copy .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

打开 <http://localhost:3000>。数据库默认位于项目根目录 `data/ai-workbench.db`，该目录已加入 `.gitignore`。

## 环境变量

从 `.env.example` 开始配置；其他可选变量及云端配置见 [技术文档](docs/技术文档.md)：

- `DATABASE_URL`：SQLite 文件位置，默认 `file:../data/ai-workbench.db`（相对于 `prisma/schema.prisma`）。
- `AI_API_KEY`：可选的服务端 OpenAI-compatible API key。不会发送到浏览器、数据库或备份文件。
- `AI_BASE_URL`：可选 API 地址，默认 `https://api.openai.com/v1`。
- `AI_MODEL`：可选模型名，默认 `deepseek-reasoner`；DeepSeek 推理模式建议使用该模型。

没有配置 AI key 时，部分功能（如每日编排）可使用规则回退；自我认知等真实模型功能会提示配置或调用错误，不会全部自动改用模板。手动表单、文档和导出仍可使用。

## 数据和导出

个人档案、经历、能力证据、价值规则、资源、约束、假设、目标、项目、里程碑、行动、复盘、决策、AI 偏好、AI 建议、身份卡版本、上下文包、任务、反馈、纠正记录和文档版本均作为结构化记录保存在 Prisma SQLite 数据库中。档案中心提供单文件 Markdown、五文件 ZIP 和完整 JSON 备份下载；AI 使用中心中的三类产物可单独下载。导入会校验 AI 工作台备份格式，并以原子事务恢复所有结构化记录。文档版本与当前生成稿可在 `/documents/compare` 查看逐行差异。

## 开发命令

```bash
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm test             # Vitest
npm run build        # 生产构建
npm run db:migrate   # 从 Prisma schema 初始化本地 SQLite
npm run db:seed      # 创建本地单用户档案和 AI 偏好
npm run db:studio    # Prisma Studio
```

`db:migrate` 对已有 SQLite 先生成快照，再执行 Prisma Client 生成、`db push` 和后续初始化脚本。全新安装可按上述步骤执行；现有数据库升级应先备份并核对相应增量迁移，详见 [技术文档](docs/技术文档.md)。应用运行时仍由 Prisma Client 访问数据库。

## 隐私边界

应用不收集密码、验证码、证件号码或账户凭证。AI 请求会带上页面提示中的数据范围，并按 AI 协作偏好执行姓名、联系方式等字段脱敏。上下文包默认排除收入、公司、家庭和健康内容，并允许逐条排除或脱敏。所有 AI 输出先经过 Zod 结构校验，并作为“待确认建议”保存，不会未经确认覆盖用户资料。医疗、法律、投资等高风险内容仅适合作为整理材料，行动前应请具备资质的专业人士复核。
