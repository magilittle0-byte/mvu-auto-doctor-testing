# P3 世界召回与推进：来源与运行合同

本阶段仅进行了静态调用图与差异检查；未运行测试、语法、API、宿主、构建或 CI。

## 唯一世界域与来源

`ContinuityState` 是唯一世界域。`nextTurnInjection` 是其最小 schema 扩展，不能放入
ActorLedger、数据库、receipt 数组、第二 store 或旧 `continuityInjectionQueue/Batches`。

| 机制 | 成熟实现 | 分类 | P3 接法 |
|---|---|---|---|
| 只读召回 | Stitches Reborn V 的 `recall` task（只选 AM/支持材料）与 TavernDB `prepareAIInput_ACU` 的持久快照输入 | 最小适配 | 本地时钟先给出不可删除的 due 人物/线程/世界轨；Recall 只从持久 Profile、Continuity、世界书选择支持材料，零权威写。 |
| Recall JSON 提取 | 现有 `sovereignty-runtime-core.extractFirstBalancedJsonObject`，其宽容边界来自项目已复用的 shujuku/repair parser 路径 | 原样复用 | `stage3RecallSelection` 直接消费生产 extractor 的 `{value, source, start, end}` 返回契约；围栏/前后文由同一 extractor 处理，`{error}` 继续 fail-closed。没有新增 parser 或复制 balanced-object 扫描。 |
| Recall 输出预算 | 数据库/shujuku compatible group call 的统一模型连接配置与既有 World Advance `continuityMaxTokens` | 原样复用 | Recall 与 Advance 传入同一可配置 world 输出预算，连接层继续取 `min(connectionMaxTokens, requestedMaxTokens)`；不再用独立 1200 上限截断推理模型。仍仅一次调用、18k 输入容量门、无 failover/盲重试，malformed 或缺 must ID 继续 fail-closed。 |
| 世界推进 | Stitches Reborn V 的 `act,scene` 推进任务、既有 `generateWorldContinuitySingleBatch` | 最小适配 | Advance 读取 canonical recall packet 与最终正文；一次输出 NPC proposals、按 actorId 的裁决和世界/线程变化，`failover:false`、`maxFailovers:0`。 |
| attempt 准备与读回 | `actorActionCandidatesFromShard`、`prepareActorActionAttempts`、`recordActorActionAttempts`、`persistActorActionAttemptsForTurn`，以及数据库/shujuku 的本地字段类型归一化边界 | 最小适配 | Advance 返回 proposal/adjudication 草案后，本地只规范化明确结构：`from=actor.location.name`，`to=模型明确location或from`；同地点 travelTurns 固定0，不同地点把模型非负整数规范为至少1。它不猜地点语义，也不裁决实际 duration/cost/risk。随后仍经全部 ActorRef、档案、知识、证据、资源、能力、玩家主权与 stateChanges 门，代码在任何 outcome 应用前先 durable ATT + prepared candidate readback，世界裁决保持独立。 |
| 世界裁决与结果 | `validateWorldAdjudicationBatch`、`settleActorActionCandidates`、`mergeActorWorldEventsIntoContinuity` | 原样复用 | attempt 不等于 outcome；不得替玩家行动、同意、感受或结果。 |
| 世界保存与恢复 | TavernDB `runTableWriteTransaction_ACU` / `runTableUpdateCommit_ACU` 的工作副本→读回→最终提交，既有 `writeChatNamespace` | 最小适配 | 现有 checkpoint 的 `world_candidate_prepared` 与 ActorLedger attempt 同一 CAS/readback；Phase1 两个选定字段读回必须共享同一个新 transaction revision，且该 revision 分别严格大于各自 S0，未选中的 Continuity revision/digest 必须原样不变。Phase2 只从该读回候选结算。 |
| P3 checkpoint migration guard | 既有 World `world_call_reserved -> world_candidate_prepared -> world_committed` checkpoint，加 Doctor `actorActionTargetOf` 严格目标投影与既有 `actorSovereigntyMigrationIsCurrent` | 最小适配 | 三阶段 checkpoint 都携带同一完整 `target`，让同 namespace migration-guarded writer 在候选应用后仍保持 current；任何 active checkpoint 都在 Recall/Advance 前统一验证已知 phase、action target 与 producer target，unknown/drift 一律人工协调。Existing world package 还必须配套 exact committed checkpoint 才能 0 模型恢复；隔离历史按既有 `compatibilityOnly/restorable` 语义忽略。不放宽 migration schema，不新增 matcher、checkpoint 或状态机。 |
| 下回合包 | `buildContinuityInjection` + `ContinuityState` | 必要新写 | 只保存为 `nextTurnInjection`；阶段四实际 `precomposeNextTurnConsumer → commitNextTurnConsumer` 是唯一 reserve/consume。 |

## 代码与提示词的分权

- **代码硬保证：** fresh ledger 中所有 due/overdue/starved NPC 都进入 `mustActorIds`，预算只限制可选探索；Recall 必须保留这些 ID 并物化完整 ActorRef/Profile/目标/承诺/知识材料；Advance 对每个 must actor 恰收一条 proposal 和一条 adjudication 草案；ActionAttempt 与 prepared checkpoint 同 CAS/readback；Phase2、scope/target/CAS、恢复与 P4 可见投影均 fail-closed。
- **提示词负责：** 从人物档案、欲望、有限知识、关系、资源和压力形成自然 NPC 尝试；按规则给成本、时间、风险和后果；正文不是后台行动的相关性过滤器；绝不替玩家行动、同意或感受。
- **交界：** Advance 同次返回尝试候选和按 actorId 的裁决草案；代码在任何世界结果应用前先本地验证集合、持久并读回 ATT，再绑定草案并结算。代码不增加人格关键词或语义裁判。

## P2/P3 时序与人物门

P1/P3 的 current-source Registry lookup 统一复用既有 `actorProfileRecoverySourceMatches`。Registry 的持久 SourceRef 只保存 identity/scope 的规范键，因此比较前仅去掉未持久的冗余 scope 对象；`identityScopeId`、`scopeDigest`、generation、swipe 与正文 `contentFingerprint` 仍严格。宿主在 MVU/机制块写回后产生的 full `hash` 漂移可恢复，但正文、身份或作用域漂移仍 fail-closed；没有新增 matcher、store 或兼容身份猜测。

自动 accepted-final 仅在 P1 完整档案 readback 或严格 `no_candidates` 后才唤醒 P3；P3 自己 fresh-read ledger，不把瞬时 P1 result 当持久权威。手动世界入口直接 `enqueueContinuity(force)`，也只凭同一 fresh durable ledger gate 准入，不重跑 P1；手动人物档案入口才会重试 P1。

P3 每次自行 fresh-read ActorRegistry/ActorLedger/Profile：

- 当前 source 有 registry actor 且有任一未 ready：`blocked`，零 proposal、零世界调用、零世界写。
- 当前 source 全部 ready：进入人物 proposal→attempt 链。
- 当前 source 无 actor：默认 `blocked: actor_registry_awaiting_p2`。
- 只有 P1 对同 accepted target 明确 `no_candidates`，并把最小 terminal authority receipt、retry receipt 清理和匹配 ticket 清理一起完成宿主读回时，P3 fresh-read gate 才允许结构世界轨；刷新/重启后不重跑 P1。

首次同一运行仍可使用 generation-bound transient permit 立即唤醒 P3；跨刷新恢复只认同 namespace 内的最小 P1 terminal receipt。两者都只是既有 P3 fresh-read gate 的上游 authority，不是 P3 成功收据或 barrier。持久回执直接复用 P1 Recovery `SourceRef` normalizer/matcher/digest、receipt seal、namespace CAS/readback；准入还要求 retry receipt 为空且同 source ticket batch 已清理。旧 target、正文 fingerprint、identity/scope/generation 漂移或回执篡改一律拒绝。

该适配没有新增 world store、queue、barrier、checkpoint 或第二套 source normalizer。P3 放行后仍沿既有 Stitches Recall -> Advance 和 `world_call_reserved -> world_candidate_prepared -> committed` 恢复链运行；已有 prepared/committed package 继续由 Continuity fresh snapshot、settlement proof 与 P4 exact-once lease/consumer 管理，P1 terminal receipt 不能重演或冒充任何世界域权威。

## actor-first Recall→Advance→两阶段提交

```text
fresh ledger readback
  -> scheduleActorTurns
  -> local mustInclude (人物目标/承诺/冷却/截止优先；独立世界轨可并列)
  -> Recall API: only select persistent supporting profiles/threads/lanes/WI, preserve all mustInclude
  -> Advance API: actor proposals first, actorId adjudications + world/thread changes
  -> actorActionCandidatesFromShard（Advance 的尝试候选）
  -> prepareActorActionAttempts
  -> recordActorActionAttempts
  -> actorLedger + world_candidate_prepared checkpoint same CAS durable readback
  -> validateWorldAdjudicationBatch
  -> settleActorActionCandidates
  -> world + settled ledger + package final CAS durable readback
```

任何 scheduled ready actor 的 proposal 缺失、Recall/Advance 运输或语义失败、prepare/record 拒绝或 Phase1 readback 不符，都会让整个 batch 失败：零 Phase2 世界写。正文不是幕后轨的过滤器；P4 才按可见性和 convergence 投影注入。

## 无 branch target、reservation 与双域恢复

P3 target 严格为 `chatId/index/messageId/swipeId/generationSerial/generationId/generationType/scopeDigest/contentFingerprint`；不含 branch。任一 generation identity 缺失的旧 checkpoint、packet 或 settlement proof 仅能进入人工协调，不能恢复、复用或放行世界调用；既有 ActionAttempt 仍以同一完整 target 做 receipt matcher。

Advance 前，既有 `continuityCheckpoint` 持久写入无 branch `stage3ProducerTarget + world_call_reserved`。Advance 输出经本地验证后，ActorLedger `pending_world` 和 `world_candidate_prepared` 同一 CAS/readback；刷新或明确重试从该读回做 0 模型 Phase2。reserved 无候选、候选 proof/CAS 不符均 fail-closed/manual reconciliation，不重演 Advance。

`nextTurnInjection.settlementProof` 是 canonical ordered projection：

`continuity-core` 的规范化与宿主读回必须逐项保留 packet `producerTarget` 和 proof `producerTarget` 的同一完整 P3 target；缺 `generationId` 或 `generationType` 的旧包被规范化为不可恢复，不能借兼容读取放松 readback matcher。

```js
{
  actorLedgerDigest,
  orderedResults: [{ attemptId, status, id, actorRef, worldAdjudicationResult }],
  digest: fingerprint(JSON.stringify(orderedResults))
}
```

按 `attemptId` 排序。恢复时 fresh-read 两域，重建同一 projection/hash，核对 actor ledger digest、每个 attempt 和 receipt，并调用既有 `actorActionSettlementsMatchLedger()`。package 存在但任一 settlement、digest、receipt、target 或 host readback 不符，一律不能返回 applied/0 调用成功。

## UI、失败与阶段四边界

所有 P3 `applied/blocked/failed/stale/disabled`、completed key、状态展示和 world diagnostics 都必须在 `taskEpoch === operationEpoch && taskChatId === currentChatId` 下更新。旧 A 切换到 B 后只能删除自己的 pending key；不得写 B 的状态、completed key、诊断或结果。当前 task 的 stale/disabled 显式收为 idle，零世界持久化。

P3 只保存 package，不调用旧 `registerContinuityInjection`、`prepareContinuityInjectionBatch` 或旧平行桥。阶段四的 single consumer 已从 package 做唯一 reserve/consume；P3 本身不直接写正文提示槽。

## 文件与未验证风险

本阶段修改：`index.js`、`continuity-core.mjs` 与本 source map。未复制缝合怪的 NSFW/正文大提示词、TavernDB CRUD 或第二存储；Recall→Advance 串行 relay 是对其 tag task 和数据库 staged transaction 的最小适配。MVU、外部数据库、预设和 P4 消费代码保持独立。真实模型、host durable readback、刷新恢复和阶段四消费尚未运行验证。
