# 性格特征

认识自己 → 个人档案 → 基础信息，在“专业背景”下填写可选的“性格特征”，点击“保存基础档案”保存。可结合具体情境描述，不要求填写人格测试类型。

字段 `Profile.personalityTraits` 默认空字符串，旧备份无需此字段；完整备份、个人档案备份、Markdown 和 AI 整理均保留此内容。

本地升级：`node scripts/migrate-personality-traits.mjs`，脚本先备份数据库再执行迁移，可重复运行。更新后运行 `npx prisma generate` 并重启预览与调度进程。

D1 增量文件：`cloudflare/migrations/0009_personality_traits.sql`。本次未执行远端迁移或部署。
