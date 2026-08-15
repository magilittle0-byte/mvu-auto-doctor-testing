# P3 世界召回与推进：来源与运行合同

本文件描述当前测试仓生产合同。自动行为测试与语法检查可证明本地边界，不能替代真实 API、Tauri 宿主、刷新恢复、构建或正式发布门禁。

## 唯一世界域与来源

`ContinuityState` 是唯一世界域。`nextTurnInjection` 是其最小 schema 扩展，不能放入
ActorLedger、数据库、receipt 数组、第二 store 或旧 `continuityInjectionQueue/Batches`。

| 机制 | 成熟实现 | 分类 | P3 接法 |
|---|---|---|---|
| 只读召回 | Stitches Reborn V 的 `recall` task、TavernDB `targetSheetKeys -> prepareAIInput_ACU`、World 引擎 `loadCurrentEntries -> matchKey -> activationOf -> buildPromptSection`，以及既有 `actorProfileV6View` | 原样复用 + 最小适配 | Doctor 本地物化 must ActorRef、线程和世界轨。external 域中 `getSortedEntries` 与逐本 `loadWorldInfo` 获取到的同一物理条目按 `(world,nativeId)` 合并一次，优先保留 `getSortedEntries` 已解析表示并合并 acquisition provenance。角色卡 embedded 先保留 `character_book.name`；仅当该书名等于 character primary world、external world 同名且 nativeId 相同，才把宿主 `importEmbeddedWorldInfo` 生成的镜像并入 embedded 权威 SourceRef。其他不同书或不同 ID 完整保留。稳定 entry ID 取 `(sourceDomain,world,nativeId)`，`contentDigest` 仅作完整性字段；合法 `uid/id=0` 仍保留为原生 ID。embedded 的 `keys/secondary_keys/extensions.vectorized/selectiveLogic/case_sensitive/match_whole_words` 与 ST 字段统一规范。随后按成熟 World 引擎语义激活：`constant` 常驻，其他条目走 primary key 与 `selective/selectiveLogic/secondaryKeys/caseSensitive/matchWholeWords`，非 constant 的 vectorized 条目不由 Doctor 自行触发。扫描材料仅是当前 accepted narrative、ready actor、召回线程/世界轨和权威 selector。Advance 只读取实际激活条目的完整内容，不做固定条数或单条裁剪。人物侧读取自然叙事模块与就绪事实，不重复票据、提交证明、锁和版本历史。没有新增 store 或状态机。 |
| 召回完整性 | 既有 `scheduleActorTurns`、`scheduleWorldLanes` 与 Actor/Thread/Lane 持久ID | 原样复用 | 所有 must actor、must thread、must lane 必须存在于 fresh ledger；本地再加入已调度人物关联线程和已选世界轨来源线程，缺任一权威ID即 fail-closed。召回包带确定性 digest，只读且零写。 |
| 世界推进 | Stitches Reborn V 的 `act,scene` 推进任务、既有 `generateWorldContinuitySingleBatch` | 最小适配 | Advance 读取 canonical recall packet 与最终正文；正常候选一次输出 NPC proposals、按 actorId 的裁决和世界/线程变化。Advance 与唯一一次定向补缺各自允许现有 fast route 做最多一次 transport-only handoff（仅 empty、transport-error、rate-limit），不对语义或校验失败切槽。若完整内存预检只发现可修复的草案缺项，最多追加一次只含原候选与固定 validationCode 的小型定向补缺，不重发世界书/档案/正文全量。 |
| Advance 生命周期 | 既有 `callModel`、route health、distinct connection key、`activeModelControllers` 取消链与 P1 `noTimeout:true` 调用形状 | 原样复用 + 最小适配 | Advance 复用无生产总超时、同一输入、现有配置槽与同一个 AbortSignal/取消按钮；一个槽的 transport-only 失败最多移交一个不同且健康的既有 fast slot。cancel、foreground preemption、validation、HTTP auth 与未知失败都不移交。正常路径在模型前没有世界持久写；所有运输槽失败或 parse/validation 失败都丢弃内存候选，可安全重试。 |
| 旧 reserved 兼容清理 | 既有 `cancelCurrentOperations -> invalidateOperations`、同 namespace 字段 CAS/readback 与严格 Stage3 target matcher | 兼容保留 | 新正常路径不再创建 `world_call_reserved`。仅对历史版本留下的 exact target/producer 预留，在没有 ATT/prepared/package 时沿旧 CAS/readback 清理或人工退役；它不再参与新候选生命周期。 |
| 显式 manual 退役旧 reserved | 既有取消链的同字段 `expectedFieldStates` CAS/readback、Stage3 完整 target/producer matcher、`stage3ContinuityDigestWithoutInjection` 与 committed 历史终态的双严格递增顺序 | 最小适配 | “继续/恢复世界连续性”只可退役同 chat/scope 下 index 与 generationSerial 均严格更早、messageId/generationId 已更新、target/producer 自洽的 `world_call_reserved`。还必须证明 checkpoint state 与当前 continuity（去 injection）一致、`lastSource` 不指旧 target、没有任何 `preparedWorld`/packet，且旧 target 没有任意 ATT/settlement receipt。成功读回后 fresh-read 当前 target，再由原 P3 路径执行一次本地 Recall 和正常 Advance（仅候选缺项允许同一边界内一次定向补缺）；同 target transport/crash reserved、自动 P1 唤醒、漂移、CAS/readback 失败仍保持 0 模型 manual。没有新增 store、checkpoint、parser 或状态机。 |
| attempt 准备与读回 | 既有 actor-shard proposal 合同、`actorActionCandidatesFromShard`、`prepareActorActionAttempts`、`recordActorActionAttempts`、`persistActorActionAttemptsForTurn` | 最小适配 | 正常 Advance 保留 `interactionTargets/resourceCosts/capabilityUsed/currentGoal/waitCondition/stimulusDecisions/contact/causalChain`；人物输入包含已有 knowledge/resources/stimuli。生产 prepare 传入宿主当前玩家身份索引，指向玩家的尝试只能进入前台待玩家决定。地点旅行只做结构归一；成功/部分成功后的地点生效时间和下一行动回合以世界裁决的实际 `durationTurns` 为权威。任何结果应用前仍先 durable ATT + prepared readback。 |
| 世界裁决与结果 | `parseActorShardProposal`、`prepareActorActionAttempts`、`recordActorActionAttempts`、`validateWorldAdjudicationBatch`、`settleActorActionCandidates`、`mergeActorWorldEventsIntoContinuity` | 原样复用 | `stage3ValidateWorldDraftInMemory` 在持久化前的 working clone 上复用完整 ActorRef/knowledge/resource/player-sovereignty 与 adjudication validator；attempt 不等于 outcome。`success/partial` 必须有非空 `appliedStateChanges`；无真实增量只能 held/delayed/blocked，不能 `advanced` 配空增量。 |
| 世界保存与恢复 | TavernDB `runTableWriteTransaction_ACU` / `runTableUpdateCommit_ACU` 的工作副本→读回→最终提交，既有 `writeChatNamespace` | 最小适配 | 现有 checkpoint 的 `world_candidate_prepared` 与 ActorLedger attempt 同一 CAS/readback；Phase1 两个选定字段读回必须共享同一个新 transaction revision，且该 revision 分别严格大于各自 S0，未选中的 Continuity revision/digest 必须原样不变。Phase2 只从该读回候选结算。 |
| P3 checkpoint migration guard | 正常 `world_candidate_prepared -> world_committed`、旧 `world_call_reserved` 兼容读取、continuity snapshot/`lastSource`、持久 world package/settlement proof，加 Doctor `actorActionTargetOf` 严格目标投影 | 最小适配 | 正常模型成功并完成全部内存校验后，ATT 与 prepared working copy 才第一次同 CAS 写入；prepared 刷新后零模型 Phase2，committed/P4 exact-once 不变。旧 reserved 只读兼容。任一 target/producer/digest/readback 漂移均 fail-closed，不新增 store、matcher、checkpoint 或状态机。 |
| 下回合包 | `buildContinuityInjection` + `ContinuityState` | 必要新写 | 只保存为 `nextTurnInjection`；阶段四实际 `precomposeNextTurnConsumer → commitNextTurnConsumer` 是唯一 reserve/consume。 |

## 代码与提示词的分权

- **代码硬保证：** fresh ledger 中所有 due/overdue/starved NPC 都进入 `mustActorIds`，预算只限制可选探索；Recall 必须保留这些 ID 并物化完整 ActorRef/Profile/目标/承诺/知识材料；Advance 对每个 must actor 恰收一条 proposal 和一条 adjudication 草案；ActionAttempt 与 prepared checkpoint 同 CAS/readback；Phase2、scope/target/CAS、恢复与 P4 可见投影均 fail-closed。
- **提示词负责：** 从人物档案、欲望、有限知识、关系、资源和压力形成自然 NPC 尝试；按规则给成本、时间、风险和后果；正文不是后台行动的相关性过滤器；绝不替玩家行动、同意或感受。
- **交界：** Advance 同次返回尝试候选和按 actorId 的裁决草案；代码在任何世界结果应用前先本地验证集合、持久并读回 ATT，再绑定草案并结算。代码不增加人格关键词或语义裁判。

## P2/P3 时序与人物门

P1/P3 的 current-source Registry lookup 统一复用既有 `actorProfileRecoverySourceMatches`。Registry 的持久 SourceRef 只保存 identity/scope 的规范键，因此比较前仅去掉未持久的冗余 scope 对象；`identityScopeId`、`scopeDigest`、generation、swipe 与正文 `contentFingerprint` 仍严格。宿主在 MVU/机制块写回后产生的 full `hash` 漂移可恢复，但正文、身份或作用域漂移仍 fail-closed；没有新增 matcher、store 或兼容身份猜测。

accepted-final 独立启动 P3 与 P1。P3 fresh-read 当前 durable ledger，只调度已 ready ActorRef；同源新发现但未 ready 的人物留在 P1，不获得本回合自主行动，也不阻断结构世界轨。P1 完整 readback 或严格 `no_candidates` 后可发出幂等唤醒，pending/completed key 防止重复。界面中的“继续/恢复世界连续性”仍直接 `enqueueContinuity(force)`；P3 `applied` 后必须收口为已提交终态。

P3 每次自行 fresh-read ActorRegistry/ActorLedger/Profile：

- fresh ledger 中 ready ActorRef 进入人物 proposal→attempt 链；调度器的 `requireProfileReady` 再次硬过滤。
- 当前 source 新发现但未 ready 的 ActorRef 只进入诊断 `unreadySourceActorIds`，本回合不产生 proposal/ATT/自主行动。
- 没有 ready 人物时，P3 仍以 `structure_only` 跑势力、环境、经济、趋势与因果余波；不虚构代言人物。
- P1 的 `no_candidates` terminal proof 仍用于证明人物链确实为空和刷新读回，但只作为幂等唤醒材料，不再是结构世界轨的启动 barrier。

同一逻辑楼层发生 `swipe/regenerate` 时，旧 `world_committed` 只属于旧 generation。若其 target、producer、package/settlement proof 完整，且新 target 同 chat/scope/index、generationSerial 严格增加并具有不同 generationId，P3 将现有 checkpoint.state 认作该楼生成前基线并正常 Recall/Advance；宿主即使为 regenerate 保留相同 messageId、swipeId 和正文 fingerprint，也不能把新 generation 误判为旧终态。它不会进入 manual reconciliation。不同楼层仍走严格 prior-terminal 历史判定；任一目标或 proof 漂移仍 fail-closed。全过程不新增 store，正常模型前仍无 `world_call_reserved` 写入。

首次同一运行仍可使用 generation-bound transient permit 立即唤醒 P3；跨刷新恢复只认同 namespace 内的最小 P1 terminal receipt。两者都只是既有 P3 fresh-read gate 的上游 authority，不是 P3 成功收据或 barrier。持久回执直接复用 P1 Recovery `SourceRef` normalizer/matcher/digest、receipt seal、namespace CAS/readback；准入还要求 retry receipt 为空且同 source ticket batch 已清理。旧 target、正文 fingerprint、identity/scope/generation 漂移或回执篡改一律拒绝。

该适配没有新增 world store、queue、barrier、checkpoint 或第二套 source normalizer。P3 沿既有 Stitches Recall -> Advance，正常写入阶段只有 `world_candidate_prepared -> world_committed`；旧 reserved 只兼容恢复。已有 prepared/committed package 继续由 Continuity fresh snapshot、settlement proof 与 P4 exact-once lease/consumer 管理。

## actor-first Recall→Advance→两阶段提交

- **P1/P3 并发重基（最小宿主适配）：** Advance 完成后、Phase1 之前，P3 fresh-read 既有 ActorLedger。`actor_attempts` 只把模型前冻结的 ready ActorRef 及其已验证 proposal/ATT 重放到最新账本，再原子写 ActorLedger + prepared checkpoint；`checkpoint_only` 仅用 ActorLedger 作 CAS guard，实际只写 prepared checkpoint，因此结构世界推进不会覆盖或抬升 P1 所有的人物档案字段。若且仅若 CAS 的唯一漂移字段是 ActorLedger，可在本地 fresh-read 后有界重基一次，零额外模型调用；continuity/checkpoint/target 或同 target ATT 漂移立即 fail-closed。Phase2 同样以 fresh ledger 的 target-attempt projection 校验并允许一次纯人物账本漂移的本地重基。`phase1WriteMode` 明确区分两套 revision/readback 合同；未新增 store、barrier 或状态机。
- **P4 target authority proof（既有 settlement proof 最小扩展）：** prepared 与 committed proof 共用 `stage3TargetActionAuthorityProjection`，按稳定顺序绑定本 target 的全部 ATT（包括 terminal/no-result）及关联 receipts，而不是只看带世界结果的尝试。人物档案和其他 target 的账本演化仍可通过 `allowUnrelatedLedgerEvolution`；本 target 的 action/status/ActorRef/target/result、receipt 数量、身份、目标与世界后果任一漂移都会拒绝 P4 恢复/消费。所有 receipt 只经过既有 `normalizeActorLedger` 的同一规范化路径，以消除 raw/durable 默认字段差异；不存在 delivery 阶段等价容差，`response_settled`、status、responseSourceRef 或任何其他回执字段变化都会改变 authority digest。当前 P4 exact-once 仍由 continuity packet 的 consumeProof 独立保证，本轮不接入或扩展 ActorLedger receipt settlement 生命周期。旧 proof 缺少 authority digest/count 时 fail-closed 进入兼容/manual，不会伪恢复。

```text
fresh ledger readback
  -> scheduleActorTurns
  -> local mustInclude (人物目标/承诺/冷却/截止优先；独立世界轨可并列)
  -> local recall packet: materialize scheduled profiles/threads/lanes/WI, preserve all mustInclude
  -> one normal Advance API: actor proposals first, actorId adjudications + world/thread changes
  -> full working-clone preflight（必要时最多一次小型定向补缺）
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

Advance 前只抓取 namespace S0 与本地 Recall，零持久写。模型输出先在 working clone 完成宽容解析、人物 proposal 权威校验、attempt prepare/record、裁决完整性、世界策略与语义推进校验；只有通过的候选才允许 ActorLedger `pending_world` 和 `world_candidate_prepared` 同一 CAS/readback。可修复缺项只把原候选与固定 validationCode 送入一次定向补缺；定向补缺仍不过即零写失败。刷新或明确重试从 prepared 读回做 0 模型 Phase2。运输、取消、格式或校验失败均不改变世界域；旧 reserved 仍按兼容规则处理。

本轮真实失败回炉继续复用同一 P3 链：`callModel` 只负责非空运输，不再提前执行 P3 schema/authority validator；`parseContinuityOutput` 在模型返回后做纯机械宽容恢复，允许单对象数组及唯一白名单单键 `{"ContinuityState":{...}}` 解包，但含兄弟键、非法值或多对象数组一律返回固定格式错误。随后完整 working-clone validator 仍按原标准校验；adjudication 复用既有 validator 的固定错误分类，并只给定向修复发送不含正文的最小字段形状。定向补丁按 validationCode 白名单逐键准入：裁决只能改 `actionAdjudications/lastTick`，proposal/attempt 只能改相关 action 字段，语义推进只能改 `threads/world/scenarioPlan/lastTick`；未知码或任一越权键整体拒绝，不能清空或覆盖原有效字段。若需要，最多一次只携带原候选与固定 `validationCode` 的定向补缺，补缺返回仍在 P3 内本地校验，失败不触发第三次调用。固定校验码进入隐私安全诊断，不记录 reason 正文。

`world.output.parse_invalid` 是唯一不做 overlay 的分支：首稿没有可依赖的 raw 基线时，定向修复必须自身含完整 `turn/lastTick/threads/scenarioPlan/world` 根对象；有 scheduled actor 时还必须同时含 `actionProposals/actionAdjudications`，已有 pending ATT 时必须含 `actionAdjudications`。满足该机械完整性后仍交给同一个 full validator；格式非法、歧义 wrapper/数组、缺根字段或缺 actor action 字段均保持固定 parse code，最多两次调用且 Phase1 前零写。

其余定向补缺使用精确 `{"repairPatch":{...}}` envelope，并从模型原始输出机械提取显式键，不再经过会补出默认 `turn/threads/world/lastTick` 的完整候选 normalizer。兼容单键 `patch/targetedRepair`、受控 snake_case 字段别名，以及 proposal/adjudication family 的数组根；只投影固定 validationCode 所属的 allowed keys，额外键被忽略且不能覆盖原候选，零命中、歧义 wrapper 或未知 family 拒绝。只有本地首稿 raw 与 repair family 都可用时才发第二次调用；合并后仍运行原 full authority validator，语义门不变。

`world.semantic_progress_missing` 的无增量终态不再要求模型伪造 thread/world/scenario 变化。模型可返回明确的 `lastTick={turn:目标回合,action:"held",threadId:"WORLD",reason:具体未满足条件}`；在完整 ATT 裁决已经完成、没有任何未 resolved 线程、线程/world/scenario 稳定投影完全未变、且所有行动结果都是 `held|rejected|blocked` 且没有 `appliedStateChanges` 时，生产 validator 也会机械生成同一 privacy-safe WORLD-held 收据，避免把安全的“本轮无权威增量”再次交给模型补写。该本地收据不创造事实，只固定当前 target 的检查终态。模型根对象遗漏或漂移的 `turn` 在 working clone 进入 policy 前机械规范为本地权威 `nextTurn`；该修复不修改 thread/world/scenario/ATT，最终 commit 原本也以同一 nextTurn 为准。存在活动线程必须继续使用其稳定 threadId；完整 validator 只把 `targetTurn + active unresolved stable threadIds` 作为 privacy-safe repairContext 交给唯一补缺，不重发正文、世界书或档案。无活动线程才教 `WORLD`，有活动线程则 held 必须从给定 ID 中选择。specific held 是“当前 target 已检查但条件未满足”的终态收据，因此要求 tick 精确等于 scheduled `nextTurn`、稳定活动 ID 与零域变化，不要求它大于 baseline 中可能已等于该 targetTurn 的上一条 tick。空、未知 threadId、WORLD 绕过活动线程、错误 lastTick turn、隐含域变化或 pending settlement 均 fail-closed。该收据证明“本轮已检查且保持”，不是世界事实增量，也不降低 attempt≠outcome、玩家主权或完整裁决门。

P3 的 Advance 与其唯一一次语义补缺都复用 `callModel` 的既有 fast-route health、distinct connection key、scheduler lane 与 privacy-safe route diagnostics；每次语义调用最多允许一次 transport handoff。纯谓词只允许 `empty`、`transport-error`、`rate-limit`，因此 validation/semantic、cancel、foreground preemption、HTTP auth 与未知错误不会换槽。切换只在用户已配置的不同健康 fast slot 间重发完全相同 messages；同物理 connection key 不算备份。空响应先由 transport 校验归类并标记该槽失败，只有非空可用输出才标健康。正常 P3 仍在 Recall/模型/完整本地校验前零持久写，所有槽失败也保持零世界写。

世界终态诊断复用 `callModel` 内部 scheduler 的 `queuedAt/callStartedAt`：每次运输分别回传 `queueWaitMs` 与真实调用段 `modelMs`，P3 再独立累加本地 `parseMs/validationMs` 和 Phase1/Phase2 `persistMs`；不再把整个 generator 墙钟冒充模型耗时。模型后的 proposal、ATT、adjudication、Phase1 CAS/readback 失败统一映射固定 privacy-safe validationCode，并经 `finishWorldResult` 保留分段耗时，不包含正文、人物名或 validator reason。

同一 accepted target 的 `applied` 与 `failed` 都写入既有运行时 `continuityCompletedKeys`；P1 的幂等 `afterPending` 仅 join 当前 promise 并原样返回其结果，绝不递归 enqueue，因此成功或失败都不会在同一回合重发全量 P3。显式 `force` 控件仍可重试，`foreground_preempted` 仍走原有 checkpoint/serial-chain 恢复而不会被当作失败终态。没有新增 store、checkpoint 或状态机。

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

## Runtime fingerprint and wrapper-race closure

- `continuityCoreSemanticFingerprint()` binds the private next-turn target, lease, consume/settlement-proof, injection, and complete continuity-state recovery normalizers. `doctorRuntimeCriticalFingerprint()` includes that semantic digest, so an internal recovery-closure change changes the runtime fingerprint.
- `continuityCoreSemanticFingerprint()` 同时绑定 `continuityGlobalHoldIsVerifiable` 与 `enforceContinuityPolicy`；宿主 runtime fingerprint 另直接绑定最终人物裁决诊断投影。修改 WORLD-held 终态或 pending/semantic/held 计数都会改变当前运行指纹。
- The existing `writeChatNamespace` migration/scope wrapper remains the persistence owner. When P1 advances only `actorLedger` during its asynchronous scope-resolution window, the wrapper exposes privacy-safe `staleFields`; P3 permits one local rebase for either `field_state_mismatch` or `stale_namespace_revision` only when `actorLedger` is the sole drift field. All continuity/checkpoint/target or multi-field drift remains fail-closed without another model call.
- Phase1 carries forward the exact namespace returned by the successful durable writer readback. The runner no longer discards that verified snapshot and immediately substitutes mutable in-memory host metadata; any P1 update after the readback is instead detected by the unchanged Phase2 field-state CAS and uses the existing one-time actor-only local rebase. This closes the candidate-readback TOCTOU without weakening checkpoint, target, ATT, or world authority.
- If the concurrent P1 write first persists the shared sovereignty migration, unchanged `continuity` and `continuityCheckpoint` fields may receive higher bookkeeping revisions while retaining the exact same digest. Phase1 now rebases only this nondecreasing-revision/exact-digest case before constructing its fresh expected states; any digest change or revision regression still fails before the prepared write. This is a local CAS-baseline refresh, not a world-state or authority relaxation.
- During checkpoint-only durable readback, an unselected P1 `actorLedger` update may advance the namespace-wide revision. Only this write mode asks the existing verifier to allow `persisted.rev >= candidate.rev`; the selected `continuityCheckpoint` field revision must still match exactly, and the content validator still verifies the complete same-target ATT/receipt authority projection. Actor-attempts and every default/full-field writer retain exact global-revision matching.
- If that checkpoint-only content validator detects same-target ATT/receipt drift after the prepared save, the writer no longer restores its stale pre-save whole namespace. It fresh-reads the durable namespace, CAS-proves that the selected checkpoint is still exactly its candidate, and durably compensates only `continuityCheckpoint`, preserving every unselected P1 field in memory and storage. A competing checkpoint makes compensation fail closed with `host_save_content_validation_conflict` and leaves the durable prepared state recoverable; successful compensation reports `host_save_content_validation_compensated`. If the compensation readback itself is unknowable, memory retains the last proven durable prepared authority and reports `host_save_content_validation_readback_unknown` rather than claiming rollback or zero-write. Ordinary host transport/readback failure remains the separate `host_save_readback_mismatch` diagnostic.
- The runtime fingerprint binds `persistedNamespaceMatches`, selected-field content equality, durable verify, `checkpointOnlyRetryAuthorityMerge`, and the production writer/compensation implementation. Revision allowances accept only finite nonnegative safe integers; an invalid explicit global revision is rejected before host save, and helper mutation tests prove these closures alter the runtime hash.
- SillyTavern `saveMetadata` may resolve after its internal conditional chat save swallowed an error. The existing selected-field CAS/readback writer now classifies privacy-safe `read_error`, `namespace_missing`, `revision_behind`, and `selected_conflict` evidence (selected field name, expected/actual revision, digest-match boolean only). Only checkpoint-only Phase1 may then fresh-read the durable namespace and perform one local save/readback retry: chat/scope must remain exact; the unselected comparison set is the union of both namespaces' own data keys plus their revision keys; every unselected field must be revision/digest non-regressing against the current in-memory authority, and two unrevisioned values must remain exactly equal. Only a newer `actorLedger` is admissible, and only when the unchanged prepared-checkpoint validator proves the complete same-target ATT/receipt projection. Any older actor ledger is never republished, and any newer continuity/other world-owned field fails closed. The retry composes the latest proven authority and overlays only `continuityCheckpoint`; it never clones and republishes a stale whole namespace. A baseline is retryable only when its selected content and selected field revision both equal the current baseline. Same baseline content at a higher selected revision is a conflict and is never overwritten. Same prepared content at an equal-or-higher selected revision, after the unchanged authority validator passes, is accepted as already persisted without another save. A competing selected checkpoint fails closed; an unknowable result retains the last provable prepared/authority state. The old catch rollback is disabled only after a durable save actually started, and retry-save exceptions emit fixed read-error evidence. Scheduled actor-attempt mode keeps its strict original writer path, and no branch reruns Recall or Advance.
- Phase2 reuses that selected-field transaction recovery for the existing `continuity + continuityCheckpoint + director flags` commit. Its first durable readback polls for a bounded five attempts; if the host swallowed the save, exactly one fresh-authority local re-save is allowed without Recall, Advance, or candidate regeneration. The selected transaction must be wholly the exact prepared baseline at its original field revisions or wholly the same committed candidate at equal-or-higher field revisions; mixed selected states and higher-revision baselines are conflicts. Unselected authority validation is deliberately separate from selected commit/content validation: a fresh namespace with exact chat/scope, safe non-regressing global/own-key field revisions may retain newer P1 and same-target ATT/receipt authority even when that authority makes the committed candidate fail its settlement proof. In that case the safe failure snapshot uses fresh authority as its base and restores only the selected Phase1 prepared fields; only an old/unknown fresh namespace falls back to current. An already durable committed candidate is accepted without another save. Phase2 does not opt into unconditional `retainOnFailure`: any failure before durable save restores the selected Phase1 prepared baseline. After a local re-save, null/error/older-P1/mixed readbacks are classified again against the last verified fresh authority; only a complete committed proof succeeds, while every other result restores selected prepared fields on the last safe unselected authority. Thus no failed return can leave an unverified `world_committed` checkpoint or consumable P4 payload in memory, and a later unrelated diagnostic save still carries both the fresh ATT/receipt authority and prepared state. Phase2 host-save/readback failures propagate bounded kind/evidence (including `content_validation_conflict`), report `world_candidate_prepared` when that safe checkpoint remains, and use `world.phase2.*` fixed privacy-safe codes rather than Phase1 or generic operation codes.
- Phase2 的最终 package 读回使用 settlement proof 自带的 target-level authority projection，并显式允许 P1 在模型调用期间对人物档案或其他 target 的 ActorLedger 做合法演化；它不再用 proof 中模型前的整本 ledger digest 误拒这些并发提交。同 target 的任意 ATT/receipt 增删或字段漂移仍由完整 authority digest 严格拒绝，失败时保留 fresh ActorLedger 与 prepared checkpoint，不重跑模型。
- proposal 定向补缺从完整数组替换收紧为 ActorId 局部替换。内存预检记录每个失败行的固定 `actor_shard.*` 子码，只把失败 ActorId、子码和 `actorId/intent/candidateAction/stateChanges` 最小形状交给唯一一次补缺；有效人物行保持原样，模型冗余回传的已有效调度行仅忽略且绝不覆盖，补丁仍不得新增未知 ActorId、遗漏或重复目标 ActorId。身份、位置、证据、资源、能力、刺激与目标引用继续由既有 `parseActorShardProposal` 从 candidate authority 安全绑定，合并后仍运行完整 working-clone validator。语义校验失败在人物调度诊断中记录为 `advance_proposal_invalid/advance_validation_failed`，不再伪装成运输失败。Router 原本会让每个未指定槽位的新调用轮转到下一健康 fast slot，因此真实补缺从已证明快速的槽位2轮转到了槽位3；现在唯一补缺固定复用本次 Advance 已成功响应的槽位，若该槽发生 empty/transport/rate-limit，既有 transport-only handoff 仍可转交一次其他健康槽。成功但缓慢的响应仍不伪装成运输失败，也不触发第三次语义调用。
- adjudication 定向补缺继续原样复用 `validateWorldAdjudicationBatch`的 attempt≠outcome、ActorRef/target、玩家主权、代价、耗时、可观测性和状态变化门。最小适配只让该 validator 返回固定隐私安全 `contractCodes`，P3 据此只请求失败 ActorId/attemptId 的缺失字段。补丁按 ActorRef 局部投影：已有 attemptId/ActorRef/target、其他有效裁决行及同行未失败字段都不得覆盖；冗余有效行忽略，未知、缺失或重复失败目标 fail-closed。合并后仍运行同一完整 authority validator，且依旧最多 Advance+一次 repair、Phase1 前零写。
- 人物调度诊断不再把 `attempts_prepared` 的未裁决 ATT 预报为 completed/succeeded/semantic；该阶段只记录 selected 与 pending nonsemantic 数。最终 readback 后，只有 `settled|partial` 且具有非空 `appliedStateChanges` 才计 semantic，`held|blocked|rejected|pending_player` 计 held/nonsemantic，partial 不再误计 held。这里只修正隐私安全计数，不改变 authority、settlement 或持久化状态。
- The final pre-resave target/precondition guard also applies that safe failure snapshot before returning. If the first host save was swallowed, fresh authority advanced P1/ATT/receipt, and the accepted target then became stale, the writer performs zero second save, retains fresh unselected authority with selected prepared/P4-empty state, and emits fixed readback evidence; a later unrelated diagnostic save cannot solidify the discarded committed candidate.
- Phase2 proof construction and P4/P3 verification now canonicalize each same-target receipt through the existing `normalizeActorLedger` receipt path before hashing. This makes an in-memory settlement receipt and its JSON/durable normalized representation identical (including defaults such as `technicalFailure: false`) without removing any authority field. `stage3PersistedPackageDecision` reports a privacy-safe fixed subcode (`packet_missing`, producer/continuity/settlement target mismatch, `authority_digest_mismatch`, settlement-result mismatch, or whole-ledger mismatch) while the public package helper remains null-or-packet compatible. P4 records the subcode on its inspection result; a newer accepted target with an invalid prior proof exits through the measured finalizer and stays retryable rather than becoming permanently completed. Receipt lifecycle fields remain strict: changing `response_settled`, status, responseSourceRef, identity, target, ActorRef, attempt/result, or observable consequence changes the target authority digest. P4 exact-once remains owned by its existing continuity consumeProof; no ActorLedger receipt-consumption state machine is added here.

## UI、失败与阶段四边界

所有 P3 `applied/blocked/failed/stale/disabled`、completed key、状态展示和 world diagnostics 都必须在 `taskEpoch === operationEpoch && taskChatId === currentChatId` 下更新。旧 A 切换到 B 后只能删除自己的 pending key；不得写 B 的状态、completed key、诊断或结果。当前 task 的 stale/disabled 显式收为 idle，零世界持久化。

P3 只保存 package，不调用旧 `registerContinuityInjection`、`prepareContinuityInjectionBatch` 或旧平行桥。阶段四的 single consumer 已从 package 做唯一 reserve/consume；P3 本身不直接写正文提示槽。

## 文件与未验证风险

本阶段修改：`continuity-core.mjs`、`index.js`、P3/运行指纹诊断测试与本 source map。未复制缝合怪的 NSFW/正文大提示词、TavernDB CRUD 或第二存储；Recall→Advance 串行 relay 是对其 tag task 和数据库 staged transaction 的最小适配。MVU、外部数据库、预设和 P4 消费代码保持独立。真实模型、host durable readback、刷新恢复和阶段四消费尚未运行验证。
本轮最小适配继续复用既有链：人物 proposal 逐项调用 `actor-shard-core.parseActorShardProposal` 的 ActorRef、stimuli、knowledge、resource、capability 与 interaction target 完整合同；世界书取材将角色卡 embedded 与宿主 active/selected external 条目做并集，先按物理 SourceRef 消除宿主双路径重复，再以 World 引擎既有蓝绿灯激活控制流选择相关条目；获取来源只作 provenance，prepared SourceRef 的稳定 ID 由来源域、世界书名与原生条目 ID 形成，完整内容 digest 另作完整性绑定。旧论坛帖进入 P3 前复用 `forum-core.constrainForumCausalSignals`，不得仅凭历史 `causalSignal` 布尔进入世界因果。除一次失败候选的定向补缺外，没有新增常规模型调用、store、checkpoint、容量、token 或 timeout。

模型侧提示改为“所有权与玩家边界 + attempt≠outcome + 增量内容要求 + 最小输出形状”。完整 ready profile/worldbook 只在 Recall 持久材料中出现一次；不再重复发送另一个人物快照、另一个世界书取材池和大量由本地 parser/policy 已硬保证的格式说明。宽容标点/截断解析、稳定 ID merge、枚举归一、策略校验和缺项拒绝仍由现有脚本负责，没有降低必填语义。
