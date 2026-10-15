# 规划与决策整合

2026-10-05：目标与执行保留三个主页签：目标 → 项目 → 任务、规划与决策、全部任务。

规划与决策使用一份场景筛选，集中显示：

- 规划依据：总愿景只读引用，六场景愿景按场景顺序显示，逐条展开主要目标、标准、时间及底线；可打开关联目标，或预填新的目标草稿。
- 场景研判、应变建议：跳转保留当前场景。
- 我的决策：保留新建、编辑、选项比较、来源与结果关联，以及确认选择后的目标／项目草稿。
- 目标协同关系、对齐检查：折叠展示，保留编辑关系、AI预览和直达问题记录。

旧 `goals&tab=basis` 以及 `decisions` 下的 decisions、visions、matrix、alignment 链接继续可用；旧协同／对齐链接展开对应内容。刷新、浏览器返回和记录ID保留原有行为。

目标的衡量指标编辑改为多行输入，避免从愿景预填时换行丢失。本轮不迁移数据库、不改写档案或业务记录。

## 验证

- TypeScript、修改文件ESLint通过。
- Next.js生产构建通过；未执行生产部署。
- Vitest相关84项通过（strategy 81、profile-patch 3）。
- 浏览器38项检查通过：统一入口、场景筛选、草稿预填、取消无写入、研判跳转、刷新返回、旧链接、决策详情、协同弹窗、问题定位、桌面与390px／320px无横向溢出。
- 浏览验证前后对比档案与目标、项目、决策、行动、策略数据，均未变化。
- 本地预览运行中；局域网页面HTTP 200。

浏览验证脚本：`output/playwright/planning-merge-check.js`。
截图：`output/playwright/planning-merged-1280.png`、`planning-merged-390.png`、`planning-merged-320.png`。

访问：<http://localhost:3012/?section=goals&tab=planning>；局域网：<http://10.5.2.31:3012/?section=goals&tab=planning>。
