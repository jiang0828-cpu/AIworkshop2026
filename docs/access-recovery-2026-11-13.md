# 2026-11-13 页面访问修复

用户访问档案页时遇到 Cloudflare 1102。诊断期间同一路径间歇恢复，但已登录首页首次请求约消耗 233ms CPU，原完整数据接口约 115–334ms；不能用一次 HTTP 200 判断问题消失。

## 实现

- `cloudflare/workbench-worker.ts` 为普通页面 GET 提供轻量入口。首页验证现有签名会话后返回同次构建生成的 HTML，登录页返回预生成的公开登录页面。RSC、Basic 验证、登录提交及写操作仍进入现有 Next 中间件和接口。
- `src/lib/workbench-read.ts` 以只读 D1 批量查询返回原数据结构，保持 Profile 隔离、场景继承、历史版本、每日验收状态、日期及布尔字段兼容。
- 首次加载按 main/archive/strategy 分段，完整合并后才交给页面。某一段失败时不显示不完整档案。旧服务及本地服务仍可一次返回完整数据。
- 现有场景已齐全时不再执行初始化写入；上海日期格式器复用；页面请求不提前加载数据读取和编排模块。
- 初始数据读取失败可重新加载或重新登录。云端停止轮询仅供本地使用的同步进度。
- `prepare-worker-deploy.mjs` 从同次 Next 构建复制页面，并继续剔除本地环境变量。部署和预览都调用此脚本，不能直接上传未经处理的 Next 包。

## 验证与备份

- 当前远端 D1 已导出到被 Git 忽略的 `output/access-recovery/cloudflare-before.sql`，约 70MB。本次无数据库迁移、恢复或整库同步。
- 线上数据快照与新的完整/分段读取逐项比对通过；保留原记录和关联。真实数据及会话凭据不写入 Git。
- 测试覆盖完整响应等价、分段合并、分段失败、Profile 隔离、无效/过期会话、密码改变后的旧会话失效、只读初始化及本地兼容；回归上海日期和每日状态，以及旧场景升级和备份兼容。
- 执行 TypeScript、修改文件 ESLint、Next.js 构建和 OpenNext 构建。现有 Next 15.5.24 仍需原有 `--dangerouslyUseUnsupportedNextVersion` 参数；本次未升级依赖。
- 发布后检查登录页、未登录 API 保护、已登录页面和分段数据、线上 JS 哈希，并通过仅监听回环地址的临时只读代理验证真实线上档案页面完整渲染。该代理不接受业务写入，也不用于正式访问。

## 运维

正式地址：<https://ai-workbench.jianghaohan0828.workers.dev/>

构建：`npm run cf:build -- --dangerouslyUseUnsupportedNextVersion`

发布：`npm run cf:deploy`

此次优化聚焦页面访问与首次读取。AI、完整备份、其他写接口仍沿用 Next 实现，仍受 Cloudflare 账户资源额度限制；本次没有更改付费方案。运行日志仅保留路径、状态与耗时，不记录 Cookie 或私人内容。
