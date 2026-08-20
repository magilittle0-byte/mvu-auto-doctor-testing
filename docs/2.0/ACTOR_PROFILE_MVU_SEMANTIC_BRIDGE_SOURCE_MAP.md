# 人物档案语义前移与 MVU 权威接线来源映射

适用版本：`2.0.0-rc.25` 测试仓候选。状态：rc.24 已在唯一测试聊天同一首回合的 direct reroll 中验证终检 V5 把显式无变化回执放到 `</content>` 后、options 前，且人物正常路径额外模型调用为 0；但真实新聊天的空 ActorRegistry 缺少 scopeDigest，使 P3 三次 fresh owner 都被误判为 `world.stale.actor_ledger_changed`。rc.25 只修正 P3 的空/旧 Registry 比较投影，仍须提交、重新加载并在同一聊天同一用户消息继续 reroll；十二回合正式门禁未完成。

## 生产链

1. 生成前继续复用现有 `characterCreationTicket` 和稳定 ActorId。P4 的唯一 next-turn consumer 同时承载本回合票据、上一回合世界事件/可见后果及最多六个相关 durable-ready MVU 档案摘要；不发送全部历史档案。票据载荷把每个实际消费的完整 ticketId 就近绑定到同一 accepted assistant 的隐藏六段回执；未消费任何票据且没有既有人物变化时也必须交回 `<!-- 人物档案无变化 -->`。
2. 配套预设 `dist/01_主预设_人物万花筒_可调篇幅_IZUMI0814作者更新_ARGO1.3最小融合候选版.json` 使用终检 V5，明确取代旧四选项合同中遗漏回执的“唯一顺序”，将唯一隐藏 `<人物档案更新>` 语义域或无变化收据固定为 `</content>` 后的第一个非空内容，再继续论坛/选项/UpdateVariable/吐槽/状态等辅助域。新人物给齐六段 V6 自然叙事档案，已有角色只给变化段；该位置让档案回执不再依赖长回复尾部是否被模型截断，也不会被旧 options 顺序推迟。
3. accepted-final 适配器只读取当前最终 assistant 的精确 SourceRef；聊天、message、swipe、generation、content、scope 或 epoch 漂移均零写入。格式先本地宽容修复，再按 ticket/ActorId 逐人物绑定和隔离。解析器只接受严格 whitespace-only post-content 插槽或旧聊天 legacy tail；仅实际 EOF 的未闭合块可本地补闭合，辅助域前未闭合块 fail-closed。预留 ticket 只是可选池，不等于已消费；完整专用块和无变化收据都缺失时记录 `profile_block_missing + emptyOperations + repairable`，绝不伪装成功。无精确票据的旧聊天仍保留省略兼容。
4. 编译器在 working clone 上形成 `/人物档案/byActorId/<ActorId>` 操作，复用既有 MVU WAL、selected-field CAS、持久写、readback 与 touched-path rollback。第一次回读证明内容落地，第二次本地写入 ready 收据；最终操作合并回原消息 UpdateVariable，保留主回复原有变量操作。
5. ActorRegistry 仍是唯一 ActorId/name/aliases 索引。ActorLedger 只保存 profileRef、digest、revision、readiness、ActionAttempt/receipt 和世界字段；完整档案只在 MVU，不再双写稳定/演化副本。
6. P3 与人物档案事务独立启动，冻结启动时已经 durable-ready 的人物集合。缺档人物不参与该批人物行动，结构世界、其他 ready 人物和支线仍继续；人物尝试必须由世界单批裁决。accepted-final 只在 active P4 consumer 明确携带同 generation 的 `worldPackage` 时等待其清理；ticket-only consumer 即使仍 pending 也不阻断 P3。P1 的 idempotent wake 先原样 join 已有 P3，绝不在 pending owner 链内递归重开；semantic `no_candidates` 会把同一 exact-source coverage proof 作为结构世界准入证明，`not_completed` 不提供人物准入但也不阻断结构世界。所有模型前 stale 都携带 `module=world + zeroWrite=true + worldModelCalls=0` 和固定隐私码；无论初始 owner 在 P1 检查时仍 pending，还是已在前几个微任务中释放，只有第一次唤醒结果满足该证明、不是前台抢占，且重新 fresh-read 后仍是同一 accepted envelope，P1 才取得一次新 owner。已完成世界只返回 duplicate；任何已调用模型、正文/swipe/generation/scope/epoch 漂移都保持零自动重跑。
7. P4 仍只有一个 Doctor-owned exact-once 插槽，注入验证过的世界包、相关 ready 人物摘要和本回合票据。数据库仍只从最终正文独立填表，不参与档案事务、P3 或 P4 收据。
8. 原 Doctor 悬浮面板“人物档案”页从当前楼层 MVU durable 投影 hydrate：默认全折叠、单人展开、列表有界滚动；六段内容分成稳定档案与长期演化，故障分色优先于 busy。即使故障发生在 Actor 绑定前、当前没有卡片，持久 retry receipt 仍会把顶部摘要和空状态显示为红色。折叠偏好只进浏览器 localStorage，不进 MVU 或 Doctor 持久账本。

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
- 糖糖公司成熟多轴人物差异继续由同一 ticket 提供；最新版 Izumi/ARGO 融合预设增加正文后第一隐藏语义域，并只把原“你感到”模板最小修正为客观感官表达与明确的玩家主观感受禁写，不改写作者提示词主结构。终检 V5 只增加最终顺序适配层，明确覆盖旧 options 合同的漏项；未改第三方核心结构、未新建提示词通道。
- 既有 `profileV6` 自然叙事六段和锁/人工覆盖规范作为 MVU schema 内容形状；ActorLedger 改为单向 reference-only 投影。
- 既有 P3/P4 注入只增加 MVU readback 摘要投影，不新增并行世界状态机或第二插槽。

### X：必要新写

- `actor-profile-mvu-core.mjs` 的专用 post-content/legacy-tail 块解析、逐人物 quarantine、完整 ticket reservation 校验、锁门、单一档案根编译、消息补丁合并和 runtime fingerprint。旧生产链没有“正文模型语义 → MVU 档案”的适配器。
- accepted-final 两阶段 MVU readback 收据与无前端中间写。原因是直接复用普通变量提交会提前覆盖主回复 UpdateVariable，并使第二次精确目标回读失效。
- 单人物 AI 定向补缺。原因是旧 P1 会重新识别/生成整批人物，不满足“只修坏人物、不重跑正文和好人物”的边界。
- 显式旧 profileV6 → MVU 逐 Actor 迁移按钮。原因是自动破坏性迁移和双向维护都不允许。
- `v2/surface/actor-profile-view.mjs` 的 MVU 投影、状态优先级、紧凑 accordion 与脱敏诊断。旧页面只读取 profileV6，且六段长文会平铺，不能满足当前唯一权威和多人物可读性要求。
- P3 模型前 stale 的统一 fixed-code 零写收据与 fresh exact-target 单次接棒。旧分支只有泛 `world.stale`，无法区分可安全接棒的零调用竞态与真实失败。
- 生成前票据的逐票隐藏档案回执及其 runtime fingerprint。rc.20 真实证据证明通用预设合同在长上下文中可能与具体已消费票据脱节；新合同只闭合既有同一载荷，不引入第二识别器或第二档案权威。
- 严格 post-content/legacy-tail 位置判定、票据回合缺失回执 fail-closed、P3 settled-before-wake 单次接棒和 `worldPackage` 屏障判定。rc.21 证明“完全省略等于成功”会掩盖主模型漏交；rc.22 又证明严格尾部会被大型辅助域截断，ticket-only P4 不能代表必须阻塞 P3 的世界包。旧路径没有这些本地证明。
- P3 空/旧 ActorRegistry 的 scoped comparison projection。rc.24 真实新聊天证明：没有任何人物时 Registry 尚未持久化 scopeDigest，直接拿它与已验证 scope 比较会把稳定空账本永久误报成 `actor_ledger_changed`；rc.25 只在只读比较投影中补齐该 scope，真实 chat/scope 冲突仍 fail-closed。

## 不变量与失败语义

- 新人物六段完整且一次提交；已有角色仅 delta；坏人物不能留下半档案，也不能拖垮其他人物或结构世界。
- 模型不拥有 revision/version/status/digest/SourceRef/readback/MVU path/JSONPatch。中文业务“状态、版本、摘要”只有在形状和值明确属于技术控制面时才拒绝。
- `emptyOperations`、partial、unverified 和 readback mismatch 都不算完整成功。partial 中已读回的好人物可 ready，坏人物保持 repairable。
- 初次解析、绑定、完整性、持久化、readback、消息 replay、Registry projection 和旧迁移失败均使用固定码；诊断不保存姓名、正文、模型原文或凭据。
- 旧 verified profileV6 可只读；显式迁移失败保留旧副本。成功后 MVU 是权威，旧副本只作兼容备份；来源路径设置可显式回滚。

## 非验收说明

rc.24 的提交、loaded hash 与 runtime fingerprint 均匹配，真实 swipe 6 证明 V5 回执顺序、正文/选项和隐藏隔离正确；P1 以 durable no-candidates 零写终态结束，额外人物模型调用为 0。随后 P3 因空 Registry scope 未投影而三次零模型 stale，未产生 world/P4。rc.25 已补该局部根因；定向 P3 100/100、accepted-final/P1→P3 53/53 与唯一一次有效完整套件 614/614 通过。当前自动和旧真实证据都不能替代 rc.25 重新加载后的同聊天 reroll。正式仓与正式 main 仍须等待完整十二回合协议。
