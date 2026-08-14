# 世界论坛外部来源旧桥清理来源映射

## 边界

本次只删除旧版本遗留的外部论坛来源桥：外部扩展 DOM 探测、来源选择、跳转按钮、双来源提示、自动刷新暂停分支及对应样式。医生内置论坛仍是唯一论坛实现。

没有修改人物档案、世界连续性推进、变量修复、数据库、宿主生命周期或模型路由。

## 实际控制流判断

| 当前能力 | 实际入口与状态所有者 | 处理 |
| --- | --- | --- |
| 内置帖子生成 | `runForumTarget` → `buildForumMessages` → `extractForumUpdate` → `applyForumUpdate` | 保留；仍由 Doctor 独立模型请求生成 |
| 论坛持久化 | `namespace.forum` / `namespace.forumCheckpoint` → `writeChatNamespace` | 保留；聊天隔离与重抽恢复语义不变 |
| 世界公开信号 | `publicContinuityRecordsForForum` / `constrainForumCausalSignals` | 保留；论坛不能自行制造世界因果 |
| 外部来源桥 | 旧 `forumProvider`、外部 DOM 探测和跳转 | 删除；它不读写 Doctor 论坛数据，也不属于当前世界连续性合同 |
| 旧设置升级 | `getSettings` 的论坛设置迁移 | 最小适配；删除持久旧 selector，避免旧值继续暂停内置论坛 |

## 删除后的不变量

- 世界论坛只有一个明确所有者：Doctor 内置论坛。
- 手动/自动刷新、刷新间隔、帖子和评论质量门、聊天隔离、checkpoint、因果约束继续生效。
- 论坛仍不写 MVU、数据库、人物档案或世界账本；只有通过公开连续性记录形成的信号可被世界侧读取。
- 删除外部桥后不会因为其他扩展是否存在而改变 Doctor 论坛运行状态。

## 非验收检查

`tests/forum-external-legacy-removal.test.mjs` 防止外部来源 DOM、按钮、状态分支或旧样式再次进入生产代码，并确认内置刷新、论坛持久化和公开因果边界仍存在。该检查不是酒馆真实验收证据。

## 其余遗留审计

| 优先级 | 项目 | 结论 | 本次处理 |
| --- | --- | --- | --- |
| P1 | `buildForumMessages` 最坏可携带约 30K 旧帖摘要及大段世界材料，同时在提示中重复严格 JSON 语法 | 是当前性能/格式债，但仍参与真实论坛生成，不属于无关联遗留 | 不越界修改；应在统一提示词精简任务中改成目标帖子、最小字段形状和脚本宽容解析 |
| P2 | `forumContextMessages` 默认设置 | 生产代码只有声明、没有读取，是已确认的死设置 | 本次不扩大范围；后续可连同设置迁移单独删除 |
| P2 | `forumAutoRefresh` 与 `forumRefreshMode` 双写 | 前者只用于旧值回迁和兼容镜像，当前所有控制流读取后者 | 仍有升级兼容用途，不冒充完全无关；可在明确停止旧版本直升支持后删除 |
| P2 | `buildForumMessages` 的 `context`、`captured` 入参 | 函数体不读取，是已确认的死参数 | 不影响运行；后续机械清理即可 |
| P3 | 两层论坛 CSS（基础层和“世界论坛 v2”覆盖层） | 名称看似历史叠层，但基础层仍提供大量 v2 未覆盖的布局、焦点和交互规则，不能整体判死 | 保留；如要压缩需先做真实窄屏/桌面逐选择器覆盖审计 |

以下并非旧遗留，不能删除：`forumCheckpoint`（重抽/刷新恢复）、`lastSource`（逻辑楼层身份）、`publicContinuityRecordsForForum` 与 `constrainForumCausalSignals`（公开因果边界）、`forum-rumor` provenance（导演账本来源分类）。
