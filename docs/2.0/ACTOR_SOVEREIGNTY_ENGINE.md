# 人物主权世界引擎：参考架构冻结合同

适用版本：`2.0.0-rc.14` 及本次七阶段参考架构重构

状态：`阶段1完成／架构冻结／生产行为尚未修改`

冻结日期：2026-08-10

审计来源任务：`019fe7aa-aaa8-7150-80f5-459e7a511448`

原始讨论任务：`019fe2c6-53da-7b70-bf8f-ee238927b38e`

## 0. 文档权威性与阶段边界

本文是本次七阶段参考架构重构的权威人物合同。它把已经完成的参考审计转换为可直接实施、可逐项验收的映射，不是新的泛泛设计。

本次“阶段1—7”与仓库既有 `PHASE_ROADMAP.md` 中的历史阶段编号不是同一套编号；后文一律称为“本次重构阶段”。发生冲突时：

- 人物发现、登记、档案基线、动态状态、人物行动与世界裁决，以本文为准。
- 通用持久化、分支隔离和事务恢复仍以 `DATA_TRANSACTION_PROTOCOL.md` 为准。
- 产品体验和医生职责仍以 `PRODUCT_SPEC.md` 为准。
- 真实发布门仍以 `RELEASE_CHECKLIST.md` 为准。

阶段1只冻结合同并复核生产调用链。没有修改人物生成、模型调用、持久化或世界推进代码，也没有运行真实模型、SillyTavern、Tauri、数据库宿主或发布构建。

## 1. 冻结结论

### 1.1 唯一目标数据流

后续实现不得增设额外审核层，也不得发明多轮复杂输出协议。唯一目标流为：

```text
生成前 characterCreationTicket
  -> 已接受正文 acceptedNarrative
  -> ActorCandidate
  -> ActorRegistry 中的稳定 ActorRef
  -> 一次完整 ProfileInsertCandidate
  -> 本地格式修复
  -> Schema 完整验证与事实优先级归并
  -> 原子保存 ActorProfileBaseline
  -> 宿主持久层回读并校验 ActorRef + Schema 版本 + 内容摘要
  -> ActorDynamicState 进入行动就绪
  -> 人物提出 ActionAttempt
  -> 世界独立产生 WorldAdjudicationResult
```

硬性顺序：

1. 骰票在正文生成前产生；正文与医生使用同一张票，医生不得事后重掷。
2. 只有已接受正文能触发人物发现；未接受草稿、缝合怪计划和模型猜测不能直接建正式人物。
3. `ActorCandidate` 必须先绑定或建立稳定 `ActorRef`，才能申请档案。
4. 模型每次返回的是一张完整候选表；本地修复只修格式和类型，不替模型创造大段语义。
5. 任一必填字段、事实冲突、ActorRef、Schema、保存或回读失败，都不得留下半张档案，也不得进入行动就绪。
6. 人物只提出尝试；世界才结算成功、失败、时间、成本、风险和可观察后果。

### 1.2 四层数据职责

不新增“审核对象”“二次审批档案”或其他持久层。现有结构按下表收敛为四层：

| 层 | 唯一职责 | 现有结构映射 | 禁止承载 |
| --- | --- | --- | --- |
| `ActorCandidate` | 记录从已接受正文、已知 MVU 名称或权威资料发现的待绑定人物事实与 `SourceRef`；生命周期短 | `discoverActorsFromTurnSources()` 的发现结果、`selectActorProfileCompletionCandidates()` 的输入适配 | 行动权、完整档案、世界结果、长期动态 |
| `ActorRegistry` | 在聊天隔离域内保存稳定 `ActorRef`、别名、身份揭示/异变谱系和生命周期 | `actor-ref-core.mjs` 的 `actorRefFrom()` / `normalizeActorRefs()`；`actor-ledger-core.mjs` 中 actor 的 `id/name/aliases/status/lineage` | 人格正文、即时情绪、行动结果；阶段3才完成物理拆分 |
| `ActorProfileBaseline` | 一次完整、可读、可追溯的长期基线；包含身份、人格、长期关系规律、长期目标、知识边界、能力资源基线和可选生理基线 | `profileV6.modules.identity/personality/relationships/goals/knowledge/resourcesCapabilities/physiology` 与 `fieldSources` | 当前地点、即时情绪、临时伤势、当前计划执行态、行动回执 |
| `ActorDynamicState` | 保存会随回合变化的地点、在场状态、当前目标/计划、近期情绪、关系偏移、资源可用量、已获知识、行动史和回执 | actor 的 `location/currentGoals/plan/stateFacts/knowledge/resources/actionHistory/actionReceipts` 与 `profileV6.modules.dynamicState/actionHistory` | 永久改写基线、未裁决成功、玩家行动/感受 |

阶段2只实现完整基线提交并以适配器维持现有 `actorLedger/profileV6` 可读；阶段3再把候选、登记与稳定身份状态机物理固定。阶段2不得提前重写 ActorRef 算法。

### 1.3 事实优先级

人物字段的固定优先级是：

```text
数据库／角色卡／原著明确事实
  > 已接受正文
  > 缝合怪已经明确给出的该人物事实
  > 已确认旧档案
  > 当前 characterCreationTicket
  > AI 补空
```

玩家当前明确指令和玩家自主权不是这张“人物事实表”的一层，而是所有层之上的权限边界：任何来源都不能据此代写玩家行动、同意、感受、动机或关系结论。

冲突必须按轴处理：

- 先把每个候选值标为具体字段或骰轴，例如年龄、身份、价值取向、说话节奏、压力反应。
- 高层与低层只在同一字段或同一骰轴冲突时，丢弃低层对应值。
- 不得因一个骰轴冲突而丢掉整张骰票，也不得折中生成第三种设定。
- 非冲突低层值可以继续补足其他空轴。
- 事实的“明确程度”和来源级别必须分别记录；AI 补空只能记为 `designed_seed` 或可修订推断，不能冒充正文证据。

## 2. 审计证据快照与复用边界

本节固定本次审计使用的实际版本，避免后续把更新后的上游行为倒灌成本次结论。

| 来源 | 固定证据 | 许可证证据 | 本项目采用边界 |
| --- | --- | --- | --- |
| caikis 数据库模板 | `数据库模板-super自定义7.12总版-caikis.json`，SHA-256 `219E60B9327D8CF28E18ABC3EABE675996CCF4F03F872A2A8CE424F6A7179742` | 文件内未发现可授权复制源码/长提示词的标准许可证 | 以 `first_npc -> second_npc -> tracking_character_sheet/tracking_character_dynamic` 的生命周期、完整列约束和回读注入为母版；独立实现，不复制长提示词 |
| 糖糖公司 | `【MoM】糖糖公司 V3.2正式版 (2).json`，SHA-256 `9F630BCFD609B173FD0514EB1220B73118A797D1756162FA493E882A3BCBBDFA` | 名为“授权协议”的提示条目是剧情规则，不是软件/文本再授权许可证 | 采用多轴组合、反刻板化、展示而非标签、人物自主；不复制提示词、示例或专有表述 |
| SP·数据库 VII / shujuku | `AlbusKen/shujuku@main`：`json-sanitizer.ts` `68bc1fd...`、`table-edit-parser.ts` `9ad4d82...`、`sqlite-template-validation.ts` `039e164...`、`sql-table-service.ts` `4e083f9...`、`update-orchestrator.ts` `07c49d3...` | 根目录 `LICENSE` 与 `README.md` 在审计 ref 未找到；`package.json` 标记 `private: true` 且无 license 字段 | 独立实现等价的本地修复、Schema 真实执行/验证、批量事务、失败分类和回滚；不复制源码 |
| npc_tracker | `Rosa9527/npc_tracker@main`：`profile.js` `e8fd59d...`、`state.js` `2c516f9...`、`registry.js` `f3eabc3...`、`host.js` `3cb183c...` | 根目录 Apache License 2.0，SHA `261eeb9...` | 可在保留许可证和 NOTICE 要求的前提下复用代码；本次优先复用逐人物任务、取消/失败隔离、聊天持久化这些机制 |
| World | `DlSNlGHT/World@master`：`world-engine-evolution.js` `d857fe5...`、`core.js` `1a6a385...`、`ledger.js` `b706cbc...`、`inject.js` `7b935d1...`、`store.js` `04a758f...` | 审计 ref 未找到根目录 `LICENSE` 或 `README.md` | 只实现稳定 ID、阶段推进、稀疏增量、回滚和条件注入等不变量；不得继续复制实现或参数 |
| Story Oracle | 本地只读镜像 `namelessone88/story-oracle@661f9f89446de473ace70a590897ca5065bc2efe`，manifest `1.35.4` | 仓库根目录未发现 `LICENSE/COPYING/NOTICE` | 仅使用公开 `window.StoryOracleAPI` v1 兼容接口；不嵌入、不补丁内部、不使用 `unsafe.eval` |

### 2.1 当前 World 重合代码的处置

`continuity-core.mjs:947-950` 的四组风声衰减参数与 World `world-engine-evolution.js:23-28` 高度重合：其中 `report`、`rumor`、`sentiment` 三行数值相同，`notice` 仅把上游的 `announcement` 改名而数值相同；`decayWorldClocks()` 的概率公式也与上游 `decayWinds()` 同构。由于未找到许可证，后续不得把这部分称为“可原样复用”。阶段5只保留对外语义，阶段6必须以本项目测试和产品目标独立重写/重新标定，或取得明确许可后补齐归属。

## 3. 母版逐项映射

表中“原样保留”指现有本项目行为或经许可证允许的机制可以保持；不表示可以复制无许可证上游源码。

### 3.1 caikis + SP：发现、晋升、整表、校验、修复、事务与回读母版

| 参考步骤／不变量 | 当前文件和函数 | 原样保留 | 最小接口适配 | 必须删除／替换 | 无法直接采用的证据 |
| --- | --- | --- | --- | --- | --- |
| `first_npc` 先收所有具名互动人物，不能直接成为追踪人物 | `actor-ledger-core.mjs:1065 discoverActorsFromTurnSources()` 当前直接把发现写进 actor ledger | 保留仅从已接受正文和已知来源发现、排除玩家/系统/组织名的解析 | 阶段3把发现结果显式投影为 `ActorCandidate`，再由注册状态机接收 | 删除“发现即正式 actor 且可继续补档”的隐式语义 | caikis 用姓名和前端 `archive_status`；本项目必须使用聊天域稳定 ActorRef，不能照搬姓名主键 |
| `first_npc.archive_status` 是唯一晋升门；AI 不能自己晋升 | 当前没有等价的候选→正式登记门；`prepareActorLedgerProfilesV6()` 会直接准备新 actor | 保留身份揭示、异变谱系和生命周期本地协调 | 阶段3增加确定性晋升条件和 Registry 写权限；阶段2只消费现有 actorId | 替换所有未绑定 ActorRef 就建完整基线或行动的路径 | caikis 的按钮分类和 S/N 标签是数据库 UI 协议，不适合原样成为医生状态机 |
| `second_npc` INSERT 一次给出全列；DDL 用 `NOT NULL/CHECK/UNIQUE` 拒绝残表 | `buildActorProfileCompletionMessages()` 已列完整字段；`actorProfileCompletionMissingFields()` 只做手写缺列检查 | 保留字段含义、自然中文、空白字段由 AI 合理补全、成人模式全字段 | 阶段2引入单个 `ProfileInsertCandidate` Schema；完整候选验证后才替换基线 | 删除自由输出拼接成 patch、把旧字段与新 patch 混在一起凑“完整”的语义 | caikis 的 SQL `INSERT ... SELECT` 协议不能照搬；当前 SP `materializeSystemRowIdsForSqlInserts_ACU()` 明确拒绝 `INSERT SELECT`，只接受显式列 `VALUES` |
| `tracking_character_sheet` 建档即锁定；动态偏移另表维护 | `profileV6.modules` 已有 baseline 候选模块，但 goals/relationships/dynamicState 混杂；actor 本体也有动态字段 | 保留 `fieldSources`、锁定、覆盖、版本历史和可选 physiology | 阶段2只把稳定字段编译为 `ActorProfileBaseline`；当前计划、情绪、位置等投影回 `ActorDynamicState` | 替换把当轮情绪、衣着、伤势或计划写成终身基线的路径 | caikis 以多张 SQL 表连接；本项目使用单聊天命名空间，需对象适配而非复制表结构 |
| 当前表格数据先注入再填表，模型只能在已知行上更新/补全 | `actorProfilePromptContext()`、`buildActorProfileEvidenceBank()`、`completeActorProfilesForTurn()` 已注入锚点、正文和上下文 | 保留已确认锚点与可编辑草稿分区，保留当前 accepted narrative | 输入改为四层来源包和固定事实优先级；只对目标 ActorRef 生成一张表 | 禁止把宏连续性输出的 `parsed.raw.actorProfiles` 当第二写入口 | caikis 的 `{[sql ...]}` 宏属于数据库模板宿主，本项目没有同一运行接口 |
| 格式错误主要本地修复：引号、控制符、尾逗号、数字键、松散对象 | 当前 `firstJsonObject()` 只做严格 JSON/平衡括号；`parseLooseProfileTable()` 支持键值/标题；格式失败会调用第二次模型 | 保留现有字段别名、代码围栏/前后废话提取和安全长度上限 | 阶段2按 SP 管线独立实现：标准化引号→转义/控制字符→尾逗号→括号/分隔符→字段别名→类型归一 | 删除 `buildActorProfileRepairMessages()` 生产调用和“第二次模型修 JSON” | SP 无可复制许可证；只能独立实现等价小型修复器，且不能引入其整套 tableEdit/SQL 协议 |
| Schema 必须在真实目标结构上验证，不以“能 parse”代替 | 当前 `actorProfileCompletionMissingFields()` 会把 candidate/旧档案与 patch 合并后检查 | 保留 `actorProfileReadyForAction()` 作为下游门，但改为读取提交回执 | 阶段2用候选自身做完整 Schema、类型、最小内容、来源与 ActorRef 校验；完成后再物化 V6 | 删除“旧值 + 第一次输出 + 第二次输出”共同通过验证 | SP 的 `hydrateTableDataStrict_ACU()` 用临时 SQLite 真执行；本项目是对象 Schema，应复现验证强度而非引入 SQLite |
| 一批编辑先在工作副本执行，失败整体回滚；成功后统一提交 | `performChatNamespaceWrite()` 已有字段 revision、串行写队列、durable saver、内存回滚；最终循环在 `index.js:11964` 保存 | 原样保留聊天 ID 隔离、字段 revision、串行写、durable saver 和失败回滚 | 阶段2在人物行动调度前，针对 `actorLedger` 做 profile 事务；并发生成、串行提交 | 替换先改内存 ledger、跑人物/世界、最后才保存的顺序 | SP 的事务包围 SQLite `runBatch`；本项目应复用现有 namespace 事务，不引入第二持久化系统 |
| 保存成功必须回读，且回读的是内容而非仅“调用成功” | `readPersistedChatNamespace()` + `verifyPersistedChatNamespace()` 当前只比 chatId、总 revision 和 field revision | 保留宿主直读、3 次短退避和 mismatch 回滚 | 阶段2增加 profile 专用回读：ActorRef、profile schema/version、baseline digest 和 commitId 必须一致 | 替换“readback 不支持也当 verified”和只比 revision 就允许行动的 profile 语义 | 通用 namespace 仍可兼容无回读宿主；但新人物档案不得在无真实回读证据时行动就绪 |
| 模型失败、格式失败、Schema 失败、提交失败分别分类 | 当前 profile 将多数错误压成字符串；模型修复和内容补填混成同一次调用 | 保留逐人物 failures 列表、可重试任务和技术失败不污染人物语义 | 阶段2使用本文第6节稳定失败码；只有语义缺失可请求“完整替换表”重试 | 删除把格式修复称为内容恢复、以及失败后留半张档案 | SP 错误反馈可参考，但其 5 秒固定等待和 SQL 文案不适合直接移植 |

### 3.2 糖糖公司 + caikis：原创人物塑形母版

| 参考步骤／不变量 | 当前文件和函数 | 原样保留 | 最小接口适配 | 必须删除／替换 | 无法直接采用的证据 |
| --- | --- | --- | --- | --- | --- |
| 人格不能只由单一类型决定；类型偏好不等于能力上限 | `rollActorProfileDiversity()` 已掷价值、气质、社交、决策、语言、幽默、权威、关系距离、摩擦、压力恢复、日常和独立人生 12 轴 | 保留 12 轴本地确定性选择和反黑暗化合同 | 阶段4把骰票移动到正文生成前；阶段2只读取现有 `designRolls` | 删除 `actorProfilePromptContext()` 在缺票时以 `legacy-profile` 现场重掷的生产依赖 | 糖糖的 MBTI/九型/依恋表可证明多轴组合方向，但无许可证且单轴标签不足以作为本项目最终 Schema |
| 性格必须内化为可观察行为，不在正文输出标签 | `ACTOR_SOVEREIGNTY_DIVERSITY_CONTRACT`、档案 prompt 的衍生行为和声部字段 | 原样保留“展示而非标签”、日常纹理、反模板化和不同声部 | `ProfileInsertCandidate` 保存自然句子与行为触发条件；骰轴只留内部来源 | 替换只写“温和/冷静/疯癫”等形容词就算完整的验证 | 糖糖提示词和示例文本无复制授权；只复现可验收行为 |
| caikis 调色盘把主色、底色、点缀及其衍生整表提交 | `identity` 内已有 `primary/base/accent` 和 derivatives/sentences | 保留字段与已有 UI 投影兼容 | 阶段2将这些字段固定进 baseline Schema，并要求每组至少 2 条具体衍生 | 删除 partial patch 借旧字段补齐每组的路径 | caikis 的长提示词不复制；字段兼容是本项目既有接口延续 |
| 人物有主角之外的人生目标，即使不在场也能行动 | `PERSONAL_GOAL_SEEDS`、`scheduleActorTurns()`、actor shard | 保留独立长期目标与逐人物调度 | 基线只存长期方向；当前计划进 DynamicState；阶段5才接世界裁决 | 删除把剧情线程 `nextBeat` 直接写进人物目标、或把玩家决定当人物计划前提 | 糖糖“人物自主”是创作约束，不是结果裁决器；不能直接宣告行动已成功 |
| 已有原著/卡/数据库人物不得被随机改写 | `confirmedAnchors`、`fieldSources`、locks | 原样保留 confirmed 与人工锁 | 编译器逐轴丢弃冲突骰值，未冲突轴继续补空 | 删除整张骰票覆盖硬设定或因一轴冲突整票作废 | 多来源事实需要本项目来源元数据，参考作品没有可直接移植的统一 ActorRef 来源协议 |

### 3.3 npc_tracker：逐人物独立任务与持久化母版

| 参考步骤／不变量 | 当前文件和函数 | 原样保留 | 最小接口适配 | 必须删除／替换 | 无法直接采用的证据 |
| --- | --- | --- | --- | --- | --- |
| Registry 是 profile/action 的前置门 | npc_tracker `registry.js:63 runRegistry()`、`gate.js:55 parseGateNames()`；当前医生仅有 actor ledger | 保留“未登记人物不能进入后续任务”的不变量 | 阶段3用 `ActorRegistry + ActorRef` 取代姓名 Set；阶段2只验证现有 actorId | 替换 name-only gate | npc_tracker 以姓名为键，会同名污染；不能原样采用数据键 |
| 每人物独立运行、独立取消、独立失败 | npc_tracker `profile.js:340 runProfile()`、`charAbortControllers`、`runningCharacters`；当前 `completeActorProfilesForTurn()` 已 `Promise.all` | 保留并发模型请求、一个人物失败不击穿其他人物 | 使用现有 sovereignty per-actor task/parallelLane；编译和提交结果逐人物记录 | 删除共享“修 JSON”第二 lane 和全批一起成功的隐式假设 | Apache-2.0 允许复用，但本项目已有更强持久任务，不需要复制整套运行锁/看门狗 |
| 并发请求，串行应用，避免 ID 和状态竞争 | npc_tracker `profile.js:471-509` 并发，随后 `applyOne()` 串行；当前医生生成并发、patch 串行合并 | 原样保留这一并发形状 | 阶段2把串行 patch 合并改成串行完整候选事务提交 | 删除 merge-first/repair-second 的跨输出合并 | npc_tracker 应用的是 delta，不满足本项目整表原子基线，不能采用 delta 语义 |
| per-chat 状态 hydrate/save，空状态不得覆盖未 hydrate 的真状态 | npc_tracker `state.js:443 createEmptyChatState()`、`:572 hydrateChatStateFromHost()`、`host.js` 空状态守卫；当前 `readChatNamespace()` 已 chatId 隔离 | 保留现有 chatId namespace、防跨聊天复制和 durable save | 阶段2 profile commit 强制使用当前 captured chatId 并在 await 后复核 target | 替换仅内存 accepted 就进入调度 | npc_tracker 的 Tauri sidecar 是其宿主适配；本项目继续复用自身 namespace，不再建 sidecar |
| 批次完成后一次保存，但单角色结果可独立记录 | npc_tracker `profile.js:546 saveSettings()`；当前最终 cycle save | 保留结果和诊断逐人物记录 | 本项目因“回读后才行动”需在每个完整 profile 提交时保存；这是目标语义要求的差异 | 删除直到 cycle 尾部才保存 profile 的路径 | 批尾一次保存无法保证 profile 在 actor action 前已持久回读，因此不兼容 |

### 3.4 World：阶段推进、稀疏增量和条件注入母版

| 参考步骤／不变量 | 当前文件和函数 | 原样保留 | 最小接口适配 | 必须删除／替换 | 无法直接采用的证据 |
| --- | --- | --- | --- | --- | --- |
| 每个事件有稳定 ID 和类型化阶段，阶段由本地时钟推进 | `continuity-core.mjs` 的 `normalizeThread()`、`advanceContinuityClocks()`、`scheduleWorldLanes()` | 保留稳定 ID、阶段、终态和本地时钟 | 阶段5将 `ActionAttempt` 作为世界候选输入，不直接改阶段 | 删除人物模型自行宣告世界终态的写路径 | World 无许可证；且其 `forceTriggerEvents()` 不能移植为人物尝试必成 |
| 模型只返回稀疏变化；未返回旧项继续保留 | `mergeWorldItems()`、`applyWorldUpdate()` 已按 ID 合并并保留省略项 | 原样保留本项目独立实现的稀疏合并语义 | 阶段5为每个世界裁决加 attempt/receipt 来源 | 禁止用完整模型快照覆盖整个 world | World 的字段名和 store 结构不同，无需复制 |
| 推演前备份，失败恢复；重掷不制造重复历史 | `continuityCheckpoint`、repair journal、content digest、receipt | 保留 checkpoint、digest、幂等 receipt | 阶段5把 actor attempt/world result 分成两个 receipt stage | 替换把 action proposal 直接转 world event 的捷径 | World 的 checkpoint/ledger 是独立全局扩展，本项目必须保留聊天/分支隔离 |
| 只注入当前可见、满足条件、预算内的世界项 | `buildContinuityInjection()`、knowledge visibility、injection receipts | 原样保留条件可见和预算 | 阶段5只注入已裁决且允许披露的结果 | 删除后台私密尝试自动泄露到正文 | World 的 DOM/宿主注入接口不适合直接移植 |
| 风声按沉寂衰减 | `decayWorldClocks()` | 仅保留“可衰减”的产品语义 | 阶段6独立重写参数与实现并补回归基线 | 必须替换第2.1节所列重合参数/公式，除非取得许可 | 审计 ref 无 LICENSE，当前代码重合已有具体证据 |

### 3.5 Story Oracle：只做兼容边界

| 参考步骤／不变量 | 当前文件和函数 | 原样保留 | 最小接口适配 | 必须删除／替换 | 无法直接采用的证据 |
| --- | --- | --- | --- | --- | --- |
| 用版本化公开 API 共存，不改对方内部 | 上游 `StoryOracleAPI.version/isCompatible/registerMode/context/run`；当前 `disableStoryOracleAutoIfNeeded()` 和 `callModel()` 的 story-oracle provider | 保留 `api.isCompatible(1)`、`api.run()`、设置回读和防双写 | 只在 API capability 明示时传 abort signal；失败回到本项目任务恢复 | 禁止 `unsafe.eval`、DOM 注入、复制内部 builder/forge/parser | 上游根目录无许可证；`unsafe.eval` 明示非正式且无兼容承诺 |
| Story Oracle 不是人物真源、Registry 或 profile commit 系统 | 当前只把它当模型 provider/自动诊断兼容 | 原样保留这个边界 | 无 | 删除任何计划把 Story Oracle 角色工坊输出直接写 ActorProfileBaseline 的路径 | 其侧聊历史和角色工坊有独立状态所有权，版本更新频繁，不满足本项目事务/ActorRef 合同 |

## 4. 历史审计时生产调用链复核（已由后续 P0–P5 取代）

以下内容是阶段1审计时的生产快照，用于说明后续 P0–P5 为什么替换旧入口；不是当前“旧路径与迁移收敛”的生产调用链。该历史链路当时位于 `index.js:10786 runContinuityTarget()`：

1. 从最终接受正文计算压力和连续性。
2. `migrateActorLedgerFromContinuity()` 读取旧账本。
3. `discoverActorsFromTurnSources()` 直接把新发现写入 actor ledger。
4. 身份揭示、异变谱系、生命周期和实际观察依次归并。
5. `prepareActorLedgerProfilesV6()` 先创建/投影 profile；缺票时仍可能在生成后本地掷 `legacy-profile`。
6. `completeActorProfilesForTurn()` 对最多两个人物并发调用模型。
7. 当前模型可自由输出 JSON、键值表或标题；`parseActorProfileCompletionOutput()` 宽松解析。
8. 缺列或解析失败时，第二次调用 `buildActorProfileRepairMessages()` 让模型“修 JSON”。
9. `mergeActorProfileCompletionPatches()` 合并两次模型输出；`actorProfileCompletionMissingFields()` 又把旧 candidate 与 patch 合在一起检查。
10. `mergeActorProfilePatches()` 与 `applyActorProfileCompletionToV6()` 分步修改内存账本。
11. 再次 `prepareActorLedgerProfilesV6()` 后，`scheduleActorTurns(requireProfileReady: true)` 立即允许人物任务。
12. 人物 shard 与世界 lane 执行后，整个 cycle 才在 `index.js:11964 writeChatNamespace(... durable: true)` 保存和回读 revision。

另有第二个不受同一 profile 完整性门约束的入口：宏连续性输出的 `parsed.raw?.actorProfiles` 会在 `index.js:11635` 交给 `mergeActorProfilePatches()`。这使世界/连续性模型可以绕过完整候选编译器修改人物档案。

### 4.1 当前可保留能力

- `readChatNamespace()` 已按 chatId 隔离，并拒绝带其他 chatId 的 namespace。
- `performChatNamespaceWrite()` 已有字段 revision、写队列、awaitable durable save、回读重试和内存回滚。
- profile 模型调用已经逐人物并发，失败不会击穿 `Promise.all`。
- `actorProfileReadyForAction()` 已作为行动调度门。
- actor shard 与 world adjudication 已有分权核心和 receipt stage，可供阶段5继续收敛。

### 4.2 当前 P0 差距

| 差距 | 用户可见风险 | 首个修复阶段 |
| --- | --- | --- |
| 发现即 actor，没有显式 Candidate→Registry 晋升 | 同名/误识别可直接获得档案和任务 | 阶段3 |
| 骰票可在 accepted narrative 后用 `legacy-profile` 生成 | 首次出场正文与档案可能不是同一人物设计 | 阶段4 |
| 自由输出→宽松解析→第二模型修 JSON→两次输出合并 | 格式修复变成第二次语义改写，可能拼出从未完整生成过的档案 | 阶段2 |
| 完整性检查借用旧 candidate 值 | 半张新表也可能被算作完整 | 阶段2 |
| 内存 patch 后先跑人物/世界，cycle 尾部才持久保存 | 保存失败时人物已经行动，档案却不存在 | 阶段2 |
| 回读只比 revision，不比 ActorRef/schema/digest | 错人、截断或内容不一致仍可能被算成功 | 阶段2 |
| 宏 `actorProfiles` 是第二写入口 | 连续性模型绕过人物档案合同 | 阶段2 |
| baseline 与 dynamic 字段仍有重复投影 | 当前情绪/计划可能固化，长期事实也可能被动态覆盖 | 阶段2先划清写入，阶段6删旧投影 |
| World 风声实现与无许可证上游重合 | 继续扩散会增加维护与授权风险 | 阶段6 |

## 5. 本次重构阶段2：精确实施合同

阶段2名称固定为“人物完整档案 P0”。阶段2只解决：

```text
整表候选 -> 本地修复 -> Schema 验证 -> 原子保存 -> 内容回读 -> 行动就绪
```

它不得提前实施候选晋升状态机、预设生成前骰票或人物驱动世界重构。

### 5.1 允许修改的准确文件

生产文件：

1. `actor-profile-v6-core.mjs`
2. `actor-profile-v6-core.d.mts`
3. `actor-ledger-core.mjs`
4. `actor-ledger-core.d.mts`
5. `index.js`

针对性测试文件：

1. `tests/actor-profile-v6-core.test.mjs`
2. `tests/actor-ledger-core.test.mjs`
3. `tests/rc14-root-invariants.test.mjs`
4. 如现有文件无法表达宿主回读，可新增且仅新增 `tests/actor-profile-transaction.test.mjs`。

除为保持声明同步外，阶段2不得修改 `actor-ref-core.mjs`、`fair-director-preset-core.mjs`、`continuity-core.mjs`、`actor-shard-core.mjs`、Story Oracle 兼容代码、数据库模板或 UI。

### 5.2 函数级入口与决定

| 现有函数 | 阶段2动作 | 冻结后的职责 |
| --- | --- | --- |
| `buildActorProfileCompletionMessages()` | 最小适配 | 只请求一个目标 ActorRef 的完整 `ProfileInsertCandidate`；仍以内容质量为主，不嵌套 SQL/审核协议 |
| `firstJsonObject()` / `parseLooseProfileTable()` / 字段 alias 表 | 保留并收敛为本地修复内部件 | 清围栏/废话、提取对象、修常见引号/逗号/括号、字段名和类型；不得决定新语义 |
| `parseActorProfileCompletionOutput()` | 改为完整候选编译入口或兼容包装 | 返回 `{ok, candidate, repairs, errorCode, missingFields}`；绝不返回可提交 partial patch |
| `actorProfileCompletionMissingFields()` | 改语义或由 Schema validator 替代 | 只验证本次完整候选与高优先级锁定事实，不借旧草稿补缺 |
| `buildActorProfileRepairMessages()` | 从生产链删除，随后删除 export；若测试仍需迁移可保留一阶段 dead compatibility wrapper | 不再让第二个模型修格式 |
| `mergeActorProfileCompletionPatches()` | 删除生产调用和 export | 禁止合并两次模型输出组成一张档案 |
| `applyActorProfileCompletionToV6()` | 替换为完整 baseline materializer；旧名仅可做单候选兼容包装 | 在内存工作副本上一次生成完整 `profileV6`，保留 confirmed/locks/history，不逐字段落半张表 |
| `mergeActorProfilePatches()` | profile 生成路径不再调用 | 只暂留旧档案迁移/显式兼容；阶段6删除重复 AI 写入口 |
| `actorProfileReadyForAction()` | 强化 | 新生成人物必须有成功 Schema、commitId、profile digest 和持久回读证据；失败时 false |
| `completeActorProfilesForTurn()` | 重写内部时序 | 并发生成；逐人物本地编译；串行完整候选提交；每个提交后回读；返回实际持久 ledger |
| `persistedNamespaceMatches()` / `verifyPersistedChatNamespace()` | 添加可选内容验证器或 profile 专用包装 | profile 事务比对 ActorRef、profile schema/version、commitId、baseline digest；不改变其他字段的兼容语义 |
| `runContinuityTarget()` | 最小改序 | profile 回读成功后才进入 `scheduleActorTurns()`；失败人物保持不可行动，其他人物可继续 |
| `index.js:11635` 宏 profile merge | 删除 | 忽略/拒绝 `parsed.raw.actorProfiles`，记录稳定兼容诊断；世界/宏不再拥有 baseline 写权 |

建议新增的纯函数名固定为以下语义；实现时可因现有命名风格微调，但不得改变职责：

- `repairActorProfileInsertLocally(output, context)`
- `validateActorProfileInsertCandidate(candidate, context)`
- `materializeActorProfileBaseline(previousProfile, candidate, context)`
- `replaceActorProfileBaselineInLedger(ledger, actorRef, baseline, commitMeta)`
- `actorProfileBaselineDigest(profile)`

不得新增第五层“审核结果”对象。`ProfileInsertCandidate` 是写入前的临时值，不是新的持久数据层。

### 5.3 `ProfileInsertCandidate` 最小 Schema

候选顶层只需：

- `actorRef`：至少包含现有稳定 `actorId`；姓名仅用于显示和交叉检查。
- `identity`
- `personality`
- `relationships`
- `goals`
- `knowledge`
- `resourcesCapabilities`
- 可选 `physiology`（只有 `full_adult` 要求完整）
- `sources`：按字段/轴标记 confirmed、designed_seed、hypothesis；不得把补空标成 confirmed。

已有 V6 字段继续作为兼容列；阶段2不得借“简化 Schema”删除现有必填字段。当前 `identity/personality/goals/physiology` 的完整性下限继续保留，同时把现有已准备的 relationships、knowledge、resourcesCapabilities 纳入整表物化。动态位置、即时关系变化、当前情绪、计划执行进度和 action history 不进入 baseline 候选。

### 5.4 迁移边界

- 不做破坏性全量迁移，不遍历或重写所有旧聊天。
- `ACTOR_LEDGER_VERSION` 和 `ACTOR_PROFILE_V6_VERSION` 是否升版由实际新增持久字段决定；若升版，normalizer 必须双读旧版，且旧数据不可丢字段。
- 已持久、已确认的旧 V6 档案作为“已确认旧档案”读入；后续重生成时才走完整候选事务。
- 新生成档案必须写 `baselineCommit` 等价元数据：schema version、commitId、ActorRef、digest、sourceRef、committedTurn、readbackVerified。
- 旧档案不得伪造新的 readback 历史。它可标记为 `legacy_persisted`，因为它本身来自当前聊天的持久回读；不能标记为阶段2新事务通过。
- `legacy_persisted` 仅允许兼容读取、人工编辑和进入迁移／补全候选；`actorProfileReadyForAction()` 必须返回 false。只有 `status=committed`、非空 commitId/digest、当前 schema、ActorRef 一致、digest 重算一致且 `readbackVerified=true` 的完整档案才能进入 schedule、shard、attempt 或 settlement。
- 阶段2不删除旧字段投影；只停止新 AI 输出通过旧入口写入。阶段6在迁移覆盖和回放通过后再删除。
- 所有写入仍在现有 chat namespace/actorLedger 中，禁止建立第二数据库或全局人物库。

### 5.5 必须删除或停用的旧路径

阶段2完成门要求以下生产行为消失：

1. `completeActorProfilesForTurn()` 调用 `buildActorProfileRepairMessages()`。
2. 第一次和第二次模型输出通过 `mergeActorProfileCompletionPatches()` 合并。
3. 完整性检查用旧 candidate 草稿替本次候选补齐必填字段。
4. profile 仅在内存 accepted 就被 `scheduleActorTurns()` 视为 ready。
5. `parsed.raw.actorProfiles` 通过宏连续性输出写入人物档案。
6. profile durable readback 不支持/内容不匹配仍进入行动就绪。

格式不可恢复或内容缺失时，允许按配置进行有限次语义重试；但每次重试都必须返回一张新的完整替换候选，前一次输出只可作为错误反馈，不得与新输出合并。

### 5.6 稳定失败语义

| 失败码 | 含义 | 状态变化 | 是否可自动重试 |
| --- | --- | --- | --- |
| `actor_profile.transport_failed` | 模型/线路运输失败 | 不改 baseline；只记技术任务失败 | 是，走现有线路健康/退避 |
| `actor_profile.target_stale` | 聊天、swipe、generation 或 ActorRef 已变化 | 丢弃结果，零写入 | 由新目标重新调度，不重放旧结果 |
| `actor_profile.format_unrecoverable` | 本地格式修复后仍不能得到单一候选 | 零写入 | 可有限次请求完整替换候选 |
| `actor_profile.schema_incomplete` | 必填字段、类型或最低内容不完整 | 零写入；报告精确字段 | 可有限次请求完整替换候选 |
| `actor_profile.fact_conflict` | 候选试图覆盖更高优先级事实且无法逐轴安全剔除 | 零写入 | 只有能给模型明确冲突轴时才重试 |
| `actor_profile.actor_ref_mismatch` | 候选身份与目标 ActorRef 不一致 | 零写入并隔离该结果 | 不对同一输出重试；重新生成 |
| `actor_profile.commit_rejected` | revision 冲突、durable saver 不可用或宿主拒绝 | 内存回滚，baseline 不 ready | 是，从最新持久状态重建候选事务 |
| `actor_profile.readback_unsupported` | 新档案无法从宿主持久层读取 | 保存不能证明成功，人物不 ready | 宿主能力恢复后重试 |
| `actor_profile.readback_mismatch` | 回读 ActorRef/schema/commitId/digest 不一致 | 内存回滚，人物不 ready | 是，但不得把旧写入算成功 |

多人物同轮时，一个人物失败不得撤销其他人物已经独立提交并回读成功的档案；也不得把“部分人物成功”描述成整轮全部成功。

### 5.7 阶段2测试清单

必须使用合成数据覆盖：

1. 完整 basic/full/full_adult 候选一次通过并生成自然可读档案。
2. 代码围栏、前后废话、中文引号、未转义引号、控制字符、尾逗号、轻微缺括号和字段别名可由本地修复。
3. 单字段类型归一不会改变语义；不可恢复格式不产生 partial profile。
4. 每个必填字段缺失均给出精确路径；不得借旧草稿凑完整。
5. `未知/待确认/暂无/不详/空串` 不能满足必填；确实不适用的生理字段必须有“不适用 + 原因”。
6. 六层事实优先级逐字段生效；单骰轴冲突只丢该轴。
7. confirmed、人工锁和历史版本在 materialize 后保留；AI 补空来源不冒充 confirmed。
8. 保存失败、revision 冲突、聊天切换、swipe 过期均零写入且人物不可行动。
9. 回读 ActorRef、schema/version、commitId 或 digest 任一不一致即失败。
10. 两个人物并发生成时，一个格式失败，另一个仍可串行提交；ActorRef 不串线。
11. 运行链不再调用第二个“人物档案 JSON 修复”模型任务，不再合并两次输出。
12. 宏返回 `actorProfiles` 不再写档案。
13. `scheduleActorTurns(requireProfileReady: true)` 只选择已持久回读档案。
14. 旧 V6 档案仍可读、锁定、覆盖和显示，且不会伪造新事务证据。

阶段2至少运行：

```powershell
node --test tests/actor-profile-v6-core.test.mjs tests/actor-ledger-core.test.mjs tests/rc14-root-invariants.test.mjs
```

如新增 `tests/actor-profile-transaction.test.mjs`，必须加入同一命令。阶段2仍不需要真实模型、SillyTavern、Tauri 或发布构建；这些不是 P0 单元/集成合同通过的替代品，也不能用旧报告宣称通过。

## 6. 后续阶段边界

- 阶段3：把 `ActorCandidate -> ActorRegistry` 状态机、稳定 ActorRef、身份揭示、同名消歧和聊天隔离物理固定。
- 阶段4：把 `characterCreationTicket` 接到正文生成前预设，并让医生只绑定/验证同一票。
- 阶段5：人物依据 baseline + dynamic state 提出尝试，世界按时间、位置、知识、资源、风险和玩家主权独立裁决。
- 阶段6：迁移旧档案、删除已停用重复写入/解析路径、清理积压兼容和 World 重合实现。
- 阶段7：完整验证并交付独立测试仓库 `mvu-auto-doctor-testing/main`；除非用户另行明确要求正式发布，不执行正式仓库发布门禁。

## 7. 现有运行不变量（继续有效）

### 7.1 运行边界

- `observedThrough` 只由本地观察推进，不需要模型，也不等待人物或世界任务。
- `simulatedThrough` 只在该回合全部非过期任务达到事务终态后推进。
- 所有失败恢复只使用 `observedThrough` 这一套调度时钟；旧版未来重试迁移到当前观察回合。
- 每条正文建立 observation、profile、actor、world，以及按设置可选的 physiology 任务。
- 任务状态限定为 `pending`、`running`、`retryable_failed`、`deferred`、`committed` 和 `cancelled_stale`。
- 模型失败只影响技术任务，不修改人物性格、计划、沉默、知识、关系或行动历史。
- 用户取消后待运行、运行中和可重试任务进入终态，刷新不会偷偷重启。

### 7.2 档案来源与人工控制

- 字段来源仍限定为 `confirmed`、`designed_seed`、`hypothesis` 或 `deprecated`。
- 角色卡、世界书、数据库和已接受正文中的明确事实记为 `confirmed`。
- 医生补足长期可用字段记为 `designed_seed` 或可修订推断。
- 字段和人物锁、人工覆盖、单模块重生成和版本历史继续保留。
- 生理模块不反推人格、价值观或道德。

### 7.3 人物与世界分权

- 连续性线程的 `nextBeat` 和 `trigger` 只形成 stimulus/opportunity/risk，不直接写人物目标。
- 人物候选路由继续使用 `foreground_offer`、`foreground_attempt`、`background_private`、`background_public`。
- 若对象是玩家，只能形成意图、邀请、接近或条件，不能结算玩家参与、同意、行动或感受。
- 后台成果只有在人物说出、实际使用或玩家发现后才披露；未进入历史的能力与资源不能临时出现。

### 7.4 自定义指令与隐私

- 全局补充指令仍按用户选择的模块逐字注入；医生不增加额外内容审查层。
- 诊断和导出只记录指令启用状态、范围、长度、哈希和是否注入，不保存原文。
- 凭据、私人聊天、原始模型请求与响应、私人角色卡/世界书/预设全文不得进入诊断、报告、仓库或外部模型。

## 8. 阶段1完成门

阶段1的完成标准是本文已落盘并满足：

- 每个母版均有“参考步骤→当前函数→保留→适配→删除/替换→不兼容/许可证证据”的逐项映射。
- 唯一数据流、四层职责、事实优先级和逐轴冲突规则已经冻结。
- 当前“自由输出→宽松解析→第二模型修 JSON→合并”的真实生产路径与第二写入口已经定位。
- 阶段2允许修改的文件、函数、迁移边界、删除项、失败语义和测试清单已经精确列出。
- 阶段1没有修改生产行为，也没有把旧证据冒充当前实现测试。

阶段1到此结束；阶段2必须在独立新任务中开始。

## 9. 历史阶段6实施回填（2026-08-10，兼容旧名）

本节保留 2026-08-10 报告中的历史“阶段6”编号和当时实现事实，仅供旧报告、字段和测试名称对照；它不把当前阶段重新编号。当前“旧路径与迁移收敛”的唯一合同与实测证据见 [`ACTOR_COMPATIBILITY_MIGRATION_SOURCE_MAP.md`](ACTOR_COMPATIBILITY_MIGRATION_SOURCE_MAP.md)。

### 9.1 唯一迁移写路径

- 聊天 namespace 升至 v13，人物主权迁移证据升至 v3。
- `readChatNamespace()` 只负责兼容读取；`migrated_pending_persist` 内存对象没有运行资格。
- profile、actor、world 的 schedule、claim 和 checkpoint restore 前统一经过 `ensureActorSovereigntyMigrationPersisted()`：先写完整 payload，按 migration content digest、scope digest 和 rev 读回，再写 commit marker 并读回。
- 日常 `current` 判断只核验不可变迁移版本、scope、marker、schema 和退役入口版本，不把随后合法变化的 ledger/runtime 摘要冻结为迁移证据。
- 29 个普通 namespace 局部写入口（repair/opening/forum/world/continuity/profile/ledger/checkpoint/diagnostics 等）全部调用同一个 guard；guard 在 ensure 后重新读取权威 current，并校验 scopeDigest、namespace rev、所写字段 revision 和字段内容摘要。旧 scope 候选、无法归属的同字段并发变化均 fail closed；只有字段内容逐值相同才可 revision rebase。
- raw 写队列只保留“定义、受守卫普通入口、迁移内部闭包”3 个源码引用。迁移闭包使用不可导出的函数局部 Symbol token，只供 payload/marker 两阶段提交，普通模块无法绕过或递归调用。

### 9.2 旧数据保留与隔离

- 无完整旧 scope、task/checkpoint 无相同 scopeDigest、旧 targetIndex、宽松 target 和跨 chat/card/worldbook/runtime 状态均 fail-closed。
- committed 历史继续可读但不重放；旧活跃 task 延后并标记 `migrationQuarantined`；旧 checkpoint 仅 `compatibilityOnly` 且 `restorable=false`。
- receipt 内嵌 attempt 提升为顶层 actionAttempts 历史项，不保留第二份权威副本，也不获得 settlement 资格。
- 规范化过滤的 actor、task、checkpoint、blob、receipt、未知或冲突字段逐条原样进入内容寻址 compatibility archive；archive 不是 ledger/runtime，不能 action、settle、claim 或 restore，重复迁移不会重复膨胀。

### 9.3 作用域与 Observation 恢复

- scope 逐项绑定聊天、稳定卡 ID/版本、扁平去重排序世界书集合、世界书 manifest 和 runtime version。世界书无 host revision 时，以完整可序列化 entry 语义生成 synthetic revision；读取不明时保持 unresolved/blocked。
- 迁移写失败时，本回合已接受正文进入独立 Observation WAL；旧 profile/actor/world 工作继续隔离。
- observation-only 回合不制造行动。迁移 gap 只有在当前聊天逐条重捕获并证明完整九字段 target、全部 sourceKey 覆盖、latest sourceKey 和 scopeDigest 后才推进 `simulatedThrough`；缺证据或正文/分支/swipe/generation 变化都保持红色 gap。
- 未收敛 WAL、gap task 和对应 observation 不受普通历史容量裁剪；只压缩已终结历史。

### 9.4 Continuity 旧宏入口与 QC 证据

- Continuity 正常提示、修复提示、根 schema/template 不再要求 `actorProfiles`，解析器显式拒绝该根字段；index 中仅为旧宏存在的 ignore 分支已删除。
- `actor-profile-v6-core.mjs` 对 caikis 风格外层 `actorProfiles` 包装的 ProfileInsertCandidate 兼容保持不变，它不属于 Continuity 写入口。
- 旧 QC 对 `updateFloatingOrb` 局部变量名和源码形状的正则断言改为健康投影行为取证；失败、身份隔离和积压继续高于蓝色运行态。

### 9.5 World 风声衰减替换完成

第2.1、3.4、4.2节冻结的 World 重合项已经处理：旧四组 `base/grace/linear/quadratic` 参数和二次公式已删除。新实现是本项目独立编写的分段耐久策略：类型决定静默保护期，strength 提供有限耐久缓冲，缓冲耗尽后按 cadence 分段提高消散风险，随机函数仍可注入。确定性回归证明弱风声可随沉寂消散、强风声更耐久且边界掷骰可复现。没有复制未发现许可证的上游源码、参数或公式。

### 9.6 阶段边界

历史阶段6只完成当时的迁移、旧入口收敛和本地受控验证；没有运行真实外部模型、真实数据库、真实 SillyTavern/Tauri、构建、CI 或正式发布门，也没有提交或推送。不得把本节当成当前源码或正式发布证据。

## 10. 旧路径与迁移收敛当前回填（2026-08-11）

- `migrateActorLedgerFromContinuity()` 保留公开兼容 export，但生产调用只剩 `compatibility-migration-core.mjs` 一处；普通 `index.js/runContinuityTarget()` 为零调用。
- adapter 只在 raw pre-Registry 证据下重建旧身份。已有当前 Registry 时，未登记 ledger actor 和 continuity 姓名都不能越过 P0 注册；原已登记 ActorRef 保留。
- `migrationTimestamp` 由 raw 持久字段确定，`continuityV5=true` 在 adapter 前端纯 normalize/no-op；同一输入及 marker 写失败重试保持 ledger、payload digest 与 replayKey 稳定。
- `mergeActorProfilePatches()` 只保留有界、逐项可核账、显式 overflow 的 fail-closed 兼容壳；它不写 profile、receipt、actor version 或 ledger 时间。P1 完整 `ProfileInsertCandidate` 的原子保存和读回仍是唯一正式档案写入口。
- scope mismatch 继续复用 `readChatNamespace() -> archivedActorSovereigntyScope() -> compatibilityScopeArchives + emptyChatNamespace()`：旧 actor/profile/task 可读归档但不能进入新 active scope，也不能 action、settle、claim 或 restore。
- 历史 `phase6Runtime`、旧报告和测试文件名只作为兼容旧名保留；当前阶段名称始终是“旧路径与迁移收敛”。
