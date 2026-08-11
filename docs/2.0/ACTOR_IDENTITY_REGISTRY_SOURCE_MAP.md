# P0 人物身份登记、别名与 Gate 来源映射

## 范围与分类

本文件只覆盖身份候选、已登记姓名/别名、ActorId 绑定和 actor-shard 前的本地 Gate。人物档案、票据、行动、世界、连续性与发布均不在本阶段。

- **A（直接/改名移植）**：保留参考函数的拆分、循环、重复拒绝或写入边界，仅替换本地接口。
- **T（结构翻译）**：把 caikis SQL 两表语义或 npc_tracker 控制流翻译为本项目对象存储；不是逐字复制。
- **X（Doctor 必要胶水）**：仅限 `chatId + cardId` 身份域、当前 accepted narrative 的 SourceRef 校验、namespace 归一化/摘要/读回，以及把既有 `identityQuarantine` 完整载荷接回同一两表事务。
- 历史审计、旧测试与故障记录只用于回归断言，不是设计来源。

## 生产调用路径

`index.js/runContinuityTarget`

1. `discoverActorsFromTurnSources` 只产出本轮 `ActorCandidate`。
2. `runActorRegistryUpsert` 同时精确查询 `actorRegistry.characters`（first/candidate）与 `actorRegistry.registered`（second/registered）。精确命中时更新原行；两处都无命中才插入 candidate。
3. 只有 `sourceKind === accepted_narrative`，并且本轮 `runActorRegistryUpsert` 以同一 `candidateId` 返回 `table === characters`、其 ActorRef 与当前 `characters` 原行严格相等的候选，才进入 `promoteActorCandidatesToRegistry`。命中 `registered` 的结果是 caikis `first_npc` UPDATE-only：本轮到此结束，不进入 second_npc promotion。
4. 晋升函数只能从 `characters` 找到原行，复制为 `registered` 行后删除 candidate 原行。找不到 candidate 时不得新建 registered。若当前 accepted narrative 的结构化标记同时给出合法旧 ActorId 与新姓名，且 SourceRef/identity scope 全量匹配、`identityQuarantine` 中恰好有该 ActorId 的完整 actor，则 upsert 仍先写 `characters`，promotion 再以该完整 actor 作为载荷执行同一次 copy/delete，并在成功结果中原子移除对应 quarantine；不从 quarantine 直接写 `registered`。
5. 整个 Registry 与 quarantine/actor 变更随同一个 actorLedger 走既有 namespace durable save、readback 与 digest 校验。生产调用只在 readback 成功后采用新 ledger；保存、读回或目标时效失败时返回旧 ledger，因此隔离载荷不会被半提交。
6. `actor-shard-core/selectActorShardCandidates` 对当前人物名执行一次 `registeredSet ∩ candidates`；随后仍必须通过既有 schedule allow-list 与 `actorProfileActionReadiness(actor).ready`。身份登记不等于档案完成，也不等于行动就绪。

兼容升级不属于普通回合身份登记。生产环境只有 `compatibility-migration-core.mjs` 一处调用 `migrateActorLedgerFromContinuity()`，且只有 raw pre-Registry 证据允许从旧 continuity 一次重建 Registry；已有当前 Registry 时，即使旧 marker 尚未完成，也不得把 ledger 中未登记 actor 或 continuity 姓名提升为 registered。普通 `index.js/runContinuityTarget()` 为零调用，原已登记 ActorRef 原样保留。

这里的“registered 精确命中只 UPDATE、不 promotion”直接遵循 caikis `first_npc` 的 **T** 合同；第 3 步用本轮 upsert 收据筛选 promotion 输入则是最小 **X** 接线，不是 caikis 原前端按钮的 A/T 移植。其等价范围仅是“当前这条已接受正文明确给出了人物身份，且目标消息没有被换 chat、换卡、换 swipe 或重生成”。`actorCandidatesForRegistryPromotion` 先以本轮 upsert 的 `candidateId` 找回 accepted candidate，再以 `actorRefsMatch` 严格匹配实际 `characters` 原行；对于已存在的 candidate 行，会把本轮发现映射回该原行的 stored candidateId 后再晋升。它不按数组位置或模糊姓名猜测，不接纳 `table === registered`，也不放宽 promotion 自己的 `candidate_missing`。MVU 锚点和用户侧 scene/act 只保留在 candidate 表，直到以后某条 accepted narrative 对同一精确姓名/明确分隔符别名提供当前 SourceRef；不增加新状态、审核器、队列、缓存或模型调用。

## 逐函数与分支来源

| 分类 | 参考实现/步骤 | 生产函数或分支 | 仅做的接口改动 |
|---|---|---|---|
| A | npc_tracker `registry.js:11-29 resolveRegistryTargetName` 的 trim/空名返回骨架 | `resolveActorRegistryTargetName` | 去掉 ST user 宏替换；输入改为已解析候选名 |
| A | npc_tracker `registry.js:33-45 applyRegistryResult` | `applyCandidateRegistryResult` | `chatState.characters` 改为 `actorRegistry.characters`；行值换成 ActorCandidateRow |
| A | npc_tracker `gate.js:45-58 parseGateNames` | `parseRegisteredActorGateNames` | 只改函数名；保留 Set、结果形状检查、去重和未知名过滤循环 |
| T | caikis `first_npc` insert：新增前同时查 first/second；两处无命中才 INSERT first | `exactRegistryRows`；`runActorRegistryUpsert` 的 simultaneous lookup/no-match insert 分支 | SQL 表改为两个名称键控对象；比较仍是 name/aliases 严格相等 |
| T | caikis `first_npc` update：任一表精确命中只 UPDATE 原行；命中 second/registered 后本轮结束，不再执行 second_npc insert/delete | `runActorRegistryUpsert` 的 registered/candidate update 分支；生产接线把 `table === registered` 视为 UPDATE-only 终点 | 更新 ActorRef 姓名/aliases、来源引用和候选证据；不创建第二身份；已登记人物再次出现时保留同 ActorId，不 promotion、不 quarantine |
| T | caikis second 表 `name UNIQUE`；多重精确命中不得任选 | `runActorRegistryUpsert` alias-conflict 分支 | 把数据库唯一冲突投影为 identity quarantine，不做模糊消歧 |
| T | caikis `second_npc` insert：`INSERT ... SELECT first_npc`，成功后 `DELETE first_npc` | `promoteActorCandidatesToRegistry` 的 candidate lookup、copy、delete 与 missing-candidate 分支 | candidate 行复制为 registered ActorRef；同一调用中的明确别名输入只去重一次；预先存在的 registered 不能替代 candidate 原行；Actor 实体沿既有 ledger 形状物化 |
| T | caikis `second_npc` update：真名揭示时旧名进 aliases、更新 name；second name/alias 精确占用触发 UNIQUE 冲突 | `preferredActorRegistryName`；`mergeActorIdentityReveal`、`reconcileActorIdentityRevealsFromAcceptedContent` 与 accepted-content mutation form 的 registered UPDATE/conflict 分支 | 只对已登记 ActorId 更新；若另一 ActorId 精确占用目标 name/alias/form，则写入 `actor_candidate.alias_conflict` quarantine 并保留两边全部数据；不再从 quarantine 恢复/注册，也不手工合并或删除 duplicate |
| T | caikis `艾萨克·牛顿 → 艾萨克/牛顿` 明确分隔符规则 | `explicitDelimitedActorAliases` | 仅接受 `·`、`・`、`•`；没有 endsWith、语义或同源推断 |
| T | npc_tracker `runGate`：取得已登记集合，再用 `parseGateNames` 求交 | `runRegisteredActorGate` | 医生已有 accepted candidates，因此把它们包装成 `{characters}`，删除参考中的模型调用 |
| X | 当前已接受正文替代 caikis 前端晋升按钮 | `acceptedActorSourceRefMatches`；promotion 的 `accepted_narrative` 分支 | 精确核对 chat/message/index/swipe/generation/generationId/type/branch/hash/identityScopeId |
| X | 医生现有 ActorCandidate 输入边界 | `runActorRegistryUpsert` 的 kind/state、chat/scope、sourceKind 与排除名拒绝分支 | 只复核医生已产生的候选是否仍属于当前已接受正文和当前隔离域；不增加审核、格式修复或模型调用 |
| X | Doctor 的 unresolved internal-id 无损隔离恢复 | `unresolvedQuarantineEntriesForActorId`、`explicitQuarantineRevealEntries`；`runActorRegistryUpsert` 的旧 ActorId candidate 绑定；`promoteActorCandidatesToRegistry` 的 quarantine payload 适配 | 只有结构化 `<actor>/<npc>` 同时给出合法旧 ActorId 与姓名、当前 SourceRef 全量匹配且恰好一个完整隔离 actor 时，才让该旧 ActorId 进入既有 `characters → registered → delete candidate`；promotion 成功后才删除对应 quarantine。冲突、stale、错误/缺失 ID、多重载荷均保留隔离数据；历史、知识、资源、关系、承诺、stimuli、stateFacts、actionHistory、profile、证据与 lineage 只做完整载荷搬运。该适配没有 caikis 可直接复用的 quarantine 机制，因此明确计为 X，不冒充 A/T。 |
| X | `chatId + stable cardId` 隔离键 | `index.js/actorIdentityScopeId`、`captureTarget`、`sourceRefOf` | worldbook id/digest 不进入身份键 |
| X | namespace save/readback/digest | `emptyActorRegistry`、`registryEntryFromActor`、`normalizeRegistryEntry`、`normalizeCandidateRegistryRow`、`normalizeActorRegistry`、`normalizeActorLedger`、`actorRegistryDigest`、`actorRegistryMatchesLedger` | 让两张表可持久化并由现有 durable namespace 读回；不增加另一套存储 |
| X | ActorId 绑定 | `runActorRegistryUpsert` no-match insert | 调用既有 `actorIdFromScopedIdentity`，输入只含 `chatId + cardId` 身份域和规范姓名；不含 source/message/swipe |
| X | 生产接线 | `actorCandidatesForRegistryPromotion`；`index.js` 的 discover/upsert→characters-only accepted promotion→一次 actorLedger persist/readback→profile 顺序，以及既有 `actorActionEligibilityInLedger`、`registeredActorRef`、`actorLedgerView` 的当前 Registry 读法 | 只消费本轮 inserted/updated 中 `table === characters` 的结果，以 candidateId 找输入并以严格 ActorRef 找原行；registered UPDATE 不进入 promotion；同轮普通新人物与隔离恢复共用一次 actorLedger 持久化和读回；不调用额外模型，profile 和 schedule 顺序保持既有实现 |
| X | Gate 接线 | `actor-shard-core/selectActorShardCandidates` | Gate 只生成 registered ActorRef allow-list；既有 profile-ready/schedule 门继续生效 |
| X（冻结） | 旧 `entries` 只读兼容投影 | `normalizeActorRegistry` 与兼容损失报告 | 正常读取 legacy 字段并一对一投影，不按 alias 合并旧身份，不写回旧结构；不实现旧六拆三 |
| X（冻结基线） | P0 前已经存在的 legacy actor/continuity 一对一登记 | `compatibility-migration-core.mjs` 的 v4 adapter 调用与 `migrateActorLedgerFromContinuity` 的 Registry 目标字段适配 | 仅在 raw pre-Registry 证据下把旧记录一次投影到当前 `registered[name]`；已有当前 Registry 时禁止从未登记 ledger actor/continuity 新增身份；稳定时间只来自 raw 持久字段，不读取当前正文、不增加识别/合并算法，也不承担旧六拆三 |

## World 固定源码与旧六拆三结论

已逐行核对 `DlSNlGHT/World` 固定提交 `154de4b590378cd0bd851cfffcefd3d96741cf3f`：

- `world-engine-core.js` 的 `entityIdNumber → nextEntityId → ensureEntityIds → findEntityIndex → assignEntityId → inheritLegacyIds` 只覆盖分类 ID、唯一旧键认领和 checkpoint ID 继承。
- `world-engine-evolution.js/evolve` 的顺序是深拷贝 backup、可选 checkpoint 恢复、本地步骤、一次 API、逐类按 ID 合并、forward 时保存旧 backup、保存新 state；异常时 `Object.assign(state, backup)` 恢复。
- `world-engine-chatcache.js` 的 `packChat/installPack/createSnapshot/restoreSnapshot/normalizeAfterRestore/pushLiveNow` 覆盖整包备份、恢复前备份、精确 slot 安装和一次 namespace 写回。

这些函数没有人物 profile/ticket/knowledge/resources/relations/history/attempts/receipts 的逐字段按 ActorId 合并。因此旧六拆三没有可改名移植的成熟函数，本阶段保持冻结；生产代码中没有 `migrateExplicitDelimitedAliasPairs` 或通用 remapper。

## 行数口径

按当前 P0 身份核心的非空实现行估算（不计类型声明、测试、文档和既有 ledger/profile/action 代码）：

| 类别 | 约计行数 | 包含 |
|---|---:|---|
| A | 30 | resolve、apply、parse 三个可辨认原函数骨架 |
| T | 255 | 明确分隔符、双表精确查询/更新/插入、copy/delete 晋升、Set Gate 翻译，以及真名/form UNIQUE 冲突隔离 |
| X | 约 270 | scope/sourceRef、两表 namespace 归一化/摘要/读回、按 candidateId + 严格 ActorRef 的生产筛选、quarantine 完整载荷适配与 shard 接线 |

A+T 约 285 行，X 约 270 行。`runActorRegistryUpsert` 和 promotion 从未计为 A：其 SQL/控制流对应段计 T，SourceRef/scope/namespace/生产筛选与 quarantine payload 适配段计 X。本次 P0 恢复修正复用既有 T 的两表 copy/delete 与 UPDATE-only 语义，只新增无法从 caikis 直接取得的最小 X 载荷桥；没有新增第三张表、状态机、收据、队列、缓存或身份算法。

## 明确不存在

- 把 `actorRegistry.entries + state` 当作当前可写 Registry/生命周期状态机，或 Registry v2。`normalizeActorRegistry` 的旧格式只读一对一投影和 `compatibility-migration-core.mjs` 的损失报告是显式 X 例外；它们正常读取 legacy `entries`，不隐藏字段名、不写回旧结构，也不执行身份合并；
- registry indexes、并查集、后缀/模糊/语义/同源合并；
- 从 accepted narrative 直接 INSERT registered；
- 真名冲突时手工拼接少数字段、删除另一 ActorId 的 lossy merge；
- 额外规划 AI、审核 AI 或 Gate 模型调用；
- 旧六拆三迁移和通用递归 remapper。
