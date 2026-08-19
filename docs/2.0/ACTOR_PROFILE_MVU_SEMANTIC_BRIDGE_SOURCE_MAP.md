# 人物档案语义前移与 MVU 权威接线来源映射

适用版本：`2.0.0-rc.16` 测试仓候选。状态：自动回归与一次真实首回合冒烟均须绑定当前提交；十二回合正式门禁仍未完成。

## 生产链

1. 生成前继续复用现有 `characterCreationTicket` 和稳定 ActorId。P4 的唯一 next-turn consumer 同时承载本回合票据、上一回合世界事件/可见后果及最多六个相关 durable-ready MVU 档案摘要；不发送全部历史档案。
2. 配套预设 `dist/01_主预设_人物万花筒_可调篇幅_IZUMI0814作者更新_ARGO1.3最小融合候选版.json` 在既有正文、选项、UpdateVariable 和状态块全部结束后输出唯一隐藏 `<人物档案更新>` 语义域。新人物给齐六段 V6 自然叙事档案，已有角色只给变化段。
3. accepted-final 适配器只读取当前最终 assistant 的精确 SourceRef；聊天、message、swipe、generation、content、scope 或 epoch 漂移均零写入。格式先本地宽容修复，再按 ticket/ActorId 逐人物绑定和隔离。
4. 编译器在 working clone 上形成 `/人物档案/byActorId/<ActorId>` 操作，复用既有 MVU WAL、selected-field CAS、持久写、readback 与 touched-path rollback。第一次回读证明内容落地，第二次本地写入 ready 收据；最终操作合并回原消息 UpdateVariable，保留主回复原有变量操作。
5. ActorRegistry 仍是唯一 ActorId/name/aliases 索引。ActorLedger 只保存 profileRef、digest、revision、readiness、ActionAttempt/receipt 和世界字段；完整档案只在 MVU，不再双写稳定/演化副本。
6. P3 与人物档案事务独立启动，冻结启动时已经 durable-ready 的人物集合。缺档人物不参与该批人物行动，结构世界、其他 ready 人物和支线仍继续；人物尝试必须由世界单批裁决。
7. P4 仍只有一个 Doctor-owned exact-once 插槽，注入验证过的世界包、相关 ready 人物摘要和本回合票据。数据库仍只从最终正文独立填表，不参与档案事务、P3 或 P4 收据。
8. 原 Doctor 悬浮面板“人物档案”页从当前楼层 MVU durable 投影 hydrate：默认全折叠、单人展开、列表有界滚动；六段内容分成稳定档案与长期演化，故障分色优先于 busy。折叠偏好只进浏览器 localStorage，不进 MVU 或 Doctor 持久账本。

## T / A / X

### T：直接复用

- `characterCreationTicket` 发行、同票绑定、ActorRef/ActorRegistry 与生成生命周期。
- accepted-final 的 message/swipe/generation/content/scope/epoch 身份和 `GENERATION_ENDED` 后最终读取路径。
- MVU `commitCandidateUnlocked` 的 WAL、selected-field CAS、持久 readback、touched-path rollback 与消息保存入口。
- P3 本地 Recall、ready-only 人物调度、ActionAttempt/WorldAdjudication 分权和结构世界独立推进。
- P4 单一 next-turn consumer、lease、consume proof 和清理语义。
- Doctor repair center 的固定隐私安全码、刷新后终态诊断和按模块人工修复入口。

### A：最小适配

- TavernDB 成熟填表结构只复用“有界目标、working clone、整批提交、回读失败不算成功”的事务形状；没有复制其表格、SQL 或内容权威。
- 糖糖公司成熟多轴人物差异继续由同一 ticket 提供；最新版 Izumi/ARGO 融合预设只增加一个尾部隐藏语义域，不改写作者提示词主结构。
- 既有 `profileV6` 自然叙事六段和锁/人工覆盖规范作为 MVU schema 内容形状；ActorLedger 改为单向 reference-only 投影。
- 既有 P3/P4 注入只增加 MVU readback 摘要投影，不新增并行世界状态机或第二插槽。

### X：必要新写

- `actor-profile-mvu-core.mjs` 的专用尾部块解析、逐人物 quarantine、完整 ticket reservation 校验、锁门、单一档案根编译、消息补丁合并和 runtime fingerprint。旧生产链没有“正文模型语义 → MVU 档案”的适配器。
- accepted-final 两阶段 MVU readback 收据与无前端中间写。原因是直接复用普通变量提交会提前覆盖主回复 UpdateVariable，并使第二次精确目标回读失效。
- 单人物 AI 定向补缺。原因是旧 P1 会重新识别/生成整批人物，不满足“只修坏人物、不重跑正文和好人物”的边界。
- 显式旧 profileV6 → MVU 逐 Actor 迁移按钮。原因是自动破坏性迁移和双向维护都不允许。
- `v2/surface/actor-profile-view.mjs` 的 MVU 投影、状态优先级、紧凑 accordion 与脱敏诊断。旧页面只读取 profileV6，且六段长文会平铺，不能满足当前唯一权威和多人物可读性要求。

## 不变量与失败语义

- 新人物六段完整且一次提交；已有角色仅 delta；坏人物不能留下半档案，也不能拖垮其他人物或结构世界。
- 模型不拥有 revision/version/status/digest/SourceRef/readback/MVU path/JSONPatch。中文业务“状态、版本、摘要”只有在形状和值明确属于技术控制面时才拒绝。
- `emptyOperations`、partial、unverified 和 readback mismatch 都不算完整成功。partial 中已读回的好人物可 ready，坏人物保持 repairable。
- 初次解析、绑定、完整性、持久化、readback、消息 replay、Registry projection 和旧迁移失败均使用固定码；诊断不保存姓名、正文、模型原文或凭据。
- 旧 verified profileV6 可只读；显式迁移失败保留旧副本。成功后 MVU 是权威，旧副本只作兼容备份；来源路径设置可显式回滚。

## 非验收说明

本候选唯一一次完整 Node 套件运行共 602 项，修复前为 596 通过、6 失败；6 项失败均已修复并由对应定向回归覆盖，但依照“完整套件只运行一次”的约束未再次运行整套，因此不能声称 rc.16 完整套件全绿。语法检查、JSON 解析、差异检查和合成 DOM 回归也不证明真实可用。任何后续运行代码或提示词变化都会使旧真实证据失效；正式仓与正式 main 必须等待当前源码指纹下的真实唯一验收协议。
