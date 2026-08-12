# P3 单批世界连续性：R4-R2 来源与运行合同

本阶段仅进行了静态调用图与差异检查；未运行测试、语法、API、宿主、构建或 CI。

## 唯一世界域与来源

`ContinuityState` 是唯一世界域。`nextTurnInjection` 是其最小 schema 扩展，不能放入
ActorLedger、数据库、receipt 数组、第二 store 或旧 `continuityInjectionQueue/Batches`。

| 机制 | 成熟实现 | 分类 | P3 接法 |
|---|---|---|---|
| 单次世界演进 | World `evolve/callEvolutionAPI`、既有 `generateWorldContinuitySingleBatch` | 原样复用/最小适配 | 一次冻结输入、一次世界调用、`failover:false`、`maxFailovers:0`。 |
| 单批人物 proposal | `collectActorShardProposals`、`runActorShardProposalBatch`、npc_tracker 一次 gate | 原样复用 | 1/3/6 ready actors 仅一次既有批调用，不建第二模型、池或状态机。 |
| attempt 准备与读回 | `actorActionCandidatesFromShard`、`prepareActorActionAttempts`、`recordActorActionAttempts`、`persistActorActionAttemptsForTurn` | 原样复用 | attempt 在世界调用前先 durable readback。 |
| 世界裁决与结果 | `validateWorldAdjudicationBatch`、`settleActorActionCandidates`、`mergeActorWorldEventsIntoContinuity` | 原样复用 | attempt 不等于 outcome；不得替玩家行动、同意、感受或结果。 |
| 世界保存与恢复 | World checkpoint/store、既有 `writeChatNamespace` | 最小适配 | 无 branch accepted target、checkpoint reservation、包内双域 settlement proof。 |
| 下回合包 | `buildContinuityInjection` + `ContinuityState` | 必要新写 | 只保存为 `nextTurnInjection`；阶段四 `finalSystemDirective` 未来唯一 reserve/consume。 |

## P2/P3 时序与人物门

P2 与 P3 从 accepted final 独立 fire-and-forget。P3 不 await P2、不由 P2 直接判定成功，手动世界运行也不重跑 P2。

P3 每次自行 fresh-read ActorRegistry/ActorLedger/Profile：

- 当前 source 有 registry actor 且有任一未 ready：`blocked`，零 proposal、零世界调用、零世界写。
- 当前 source 全部 ready：进入人物 proposal→attempt 链。
- 当前 source 无 actor：默认 `blocked: actor_registry_awaiting_p2`。
- 只有 P2 对同 accepted target 明确 `no_candidates`、完成 source/readback 且返回 `eligible` 时，P2 以 transient nonblocking signal 通知 P3 再试；P3 fresh-read 仍无 actor 才允许结构世界轨。

该 transient signal 不持久、不作 P3 成功收据，也不形成 barrier。它随写入时的 chat/operation epoch 绑定；若它在初次 P3 尚 pending 时到达，按同 target 记录一次 deferred retry；旧 chat/epoch 不消费或写入新 chat 信号。

## 全批 proposal→attempt→单次世界裁决

```text
fresh ledger readback
  -> scheduleActorTurns
  -> 0 ready（仅 no_candidates permit）: 0 proposal -> structure world
  -> 1/3/6 ready: collectActorShardProposals (one batch)
  -> actorActionCandidatesFromShard
  -> prepareActorActionAttempts
  -> recordActorActionAttempts
  -> durable actorLedger readback
  -> fresh pendingActorActionAttempts
  -> generateWorldContinuitySingleBatch (one call)
  -> validateWorldAdjudicationBatch
  -> settleActorActionCandidates
  -> world + settled ledger + package durable readback
```

任何 scheduled ready actor 的 proposal 缺失、运输/语义/stale 失败、prepare/record 拒绝或 attempt readback 不符，都会让整个 world batch 失败：不调用世界模型、不写世界状态、不部分记录 attempt。已有持久 `pending_world` attempt 仅用于其原有恢复路径，仍必须经同一单次世界裁决。

## 无 branch target、reservation 与双域恢复

P3 target 仅为 `chatId/index/messageId/swipeId/generationSerial/scopeDigest/contentFingerprint`；不含 branch、generationId 或新身份。既有 ActionAttempt 内部 target 可继续用于其自己的 receipt matcher，但不是 P3 恢复身份。

世界调用前，既有 `continuityCheckpoint` 持久写入无 branch `stage3ProducerTarget + world_call_reserved`。该 reservation 未 readback 不调用世界；世界调用后最终提交失败则保留 reservation，同 target 后续 fail-closed/manual reconciliation，禁止重复世界调用。

`nextTurnInjection.settlementProof` 是 canonical ordered projection：

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

P3 只保存 package，不调用 `registerContinuityInjection`、`prepareContinuityInjectionBatch` 或正文提示入口。阶段四 `finalSystemDirective` 是唯一 reserve/consume 消费者；当前未接入，因此 package 不会进入正文。

## 文件与未验证风险

仅修改：`index.js`、`continuity-core.mjs` 与本 source map。未修改 ActorLedger core、MVU、TavernDB、数据库、预设、缝合怪或阶段四消费代码。真实模型、host durable readback、刷新恢复、reservation partial-save 和阶段四消费均未运行验证。
