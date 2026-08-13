# P4 单消费者最终提示词入口：来源与实施映射

`consumerLease.start` 只保留 generation 开始时已知的 `index`、`swipeId` 和 `contentFingerprint`；不含 `branchId`、未来 `messageId` 或未来正文。最终目标字段只在 accepted-final 的 `consumeProof` 写入。

P4 在每个合法 generation 的 placement 前，仅以宿主 `setExtensionPrompt` 清空本插件的旧 `mvu-auto-doctor-continuity`、`mvu-auto-doctor-social-contract`、`mvu-auto-doctor-serendipity-license` 三个固定槽（同为 in-chat/depth-1/system）；不调用旧业务注入器、不写 namespace，且不会触及其他插件 key。

显式 provider 注册必须同时给出 `precompose` 与幂等 `cleanup`。医生在 callback 前确定稳定 `leaseToken` 并写入 provider lease/既有 `consumerLease`；cleanup 的每个路径都使用该 token 与同一 session context。callback throw、坏 receipt、stop、chat/swipe/新 generation、刷新后旧 lease、accepted-final 成功或不匹配都先确认 cleanup；未明确确认时保留 active/ticket/lease，将既有 lease 标为 `cleanup_failed`，不写 released/consume proof、不做后台重试、也不允许任何后续 provider 或 fallback placement。

`normalizeNextTurnInjectionLease` 将 `cleanup_failed` 作为显式合法 `consumerLease.state` 原样读回；`nextTurnLeaseCleanupBlocked` 专门识别该状态，而 fresh `precomposeNextTurnConsumer` 读到它就只保留 blocked 诊断并立即返回。本阶段没有自动 release、自动 cleanup retry 或解除该状态的入口。

`cleanup_failed` 不属于可 release 的 session match：`GENERATION_STARTED` 在创建新 session 前发现它即停止 P4 placement，`releaseNextTurnConsumer` 也不会再调用 provider cleanup。成功 cleanup 会先把 `cleanupConfirmed=true` 写入 active 与既有 lease；随后 final/CAS/readback 失败仅终结 lease/ticket，不会以同一 token 再调 cleanup。

迟到的 provider receipt 不直接调用 cleanup：它先检查 `cleanup_failed`、`cleanupConfirmed` 或已 released 状态；只有仍可释放的原 session 才调用统一 `releaseNextTurnConsumer('provider_receipt_stale')`。provider cleanup 以 generation 的稳定 `leaseToken` 为键使用纯内存 singleflight：首次 release 在调用 callback 前同步登记 Promise；STOPPED、下一次 STARTED、迟到 receipt、accepted-final 的后续入口只等待该 Promise 或读取其持久终态，绝不第二次调用同一 token 的 cleanup。成功先持久 `cleanupConfirmed`，失败先持久 `cleanup_failed` 并永久 blocked；失败的后续入口不能改写为 released。`persistedNextTurnConsumerCleanup` 在刷新/active 丢失后原样恢复 lease 的 cleanup token 与 `cleanupConfirmed`；匹配的 reserved+confirmed lease 被直接视为已清，只安全终结 lease 或等待受既有 final target/proof guards 约束的后续 consume，不建新 latch、也不重试 provider cleanup。latch 随 active lease token 清除，刷新只依赖已持久的 confirmed/failed 状态，绝不自动重试。

通用 provider 的前提是已有、有效且可写入 `consumerLease` 的 P3 package；这不是按 Beast/数据库硬编码，而是任何注册 provider 的持久 lease 安全要求。无 P3 package、world 无效或 world-CAS 退化后的 ticket-only payload 只使用唯一 SillyTavern fallback，绝不交给外部 provider。

P3 package 只在 producer target scope 与当前 frozen scope 相同、`stage3PersistedPackageForTarget(..., {allowUnrelatedLedgerEvolution:true})` 复验 packet producer、continuity digest、settlement proof、旧 target 的 attempt/result/ActorRef 与无 pending、且严格 legacy projection 成功时进入 world 段。P3 同 target 恢复仍使用默认整本 ActorLedger digest 严格模式；只有跨回合 P4 消费允许变量/P1 对无关人物档案的合法演化，旧 target 删除或篡改仍拒绝。package 已消费、被占用、proof/digest/scope/projection 失效时只释放其旧 world lease，世界段留空；当前 generation 仍独立准备原样 P5 ticket，允许 ticket-only 单槽 placement。

world lease 的 CAS/readback 并发失败也只重新读取、释放或丢弃 world 段；只要没有 `cleanup_failed` 阻断，当前 generation 已生成的 ticket batch 保留并以 ticket-only payload 继续唯一 placement。只有实际 slot cleanup/provider callback/provider receipt/fallback 失败才会使整 payload fail-closed。

accepted-final 在 `ensureAcceptedFinalTargetIdentity` 冻结并传递 index/messageId/swipeId/contentFingerprint/scopeDigest/session epoch；`commitNextTurnConsumer` 在提交前、durable write precondition 与 readback validator 都重新读取并比较同一组字段。它也先撤除并确认当前 single slot，才写 consume proof。任一 early exit、target/scope/epoch 不匹配、cleanup 或 readback 失败均以原 session fail-closed，零 consume proof。

本阶段只做静态调用图与差异检查；未运行测试、语法/JSON、真实 API、宿主、浏览器、构建、CI 或发布流程。

## 所有权与时间

```text
上一 accepted final
  -> P3 已持久 nextTurnInjection（世界 producer）
当前 GENERATION_STARTED 的 await pre-compose 窗口
  -> 既有 prepareNpcDesignTicketBatch（当前 generation 的 ticket batch）
  -> 严格 legacy-to-consumer projection / 单消费者 placement
当前 accepted final
  -> P2 bindCharacterCreationTicketsToRegisteredActors 逐人绑定票据
  -> P4 仅写 consumerLease / consumeProof
```

world package 与 ticket 不属于同一 producer：前者来自上一 accepted target，后者属于当前 generation。P4 不使用 branchId。

## 成熟来源与复用分类

| 机制 | 真实来源 | P4 分类 | 边界 |
|---|---|---|---|
| 世界事实与玩家边界 | `continuity-core.mjs:buildContinuityInjection` | 原样复用内层行，最小容器适配 | 不投递旧 bridge 外壳或 fixed director 行 |
| legacy package | P3 `index.js` 在 world durable readback 前写 `nextTurnInjection.payload.text/visibleThreadIds` | 只读验证 | P4 不覆盖 payload、producerTarget、digest 或 settlementProof |
| 无桥投影 | `continuity-core.mjs:buildContinuityConsumerPayload` | 必要新胶水 | 原样复用 `normalizeNextTurnInjection` 已使用的 `cleanText(..., 12000)` canonical 形态，对 director x rawMaxVisible 的原 renderer 输出与独立 visible projection 做严格验证；不使用新 parser、正则或 HTML 清洗 |
| 人物票据文本 | `index.js:npcDesignTicketPrompt(batch)` | 原样复用 | 禁止另造人格池、票据提示词或二次掷骰 |
| P5 预设读取 | `fair-director-preset-core.mjs:CHARACTER_DIVERSITY_CONTRACT` | 原样复用 | 读取 `<Original_NPC_Dice_Tickets>`，票据仅在 P2 注册/readback 后逐人消费 |
| 单一宿主回退 | SillyTavern `setExtensionPrompt` | 最小适配 | 唯一 key `mvu-auto-doctor-next-turn-consumer`，IN_CHAT/depth 1/system；无 verified provider 时才使用 |
| 通用 provider | `window.MvuAutoDoctorAPI.registerNextTurnConsumerProvider` | 必要新胶水 | 显式注册的单-slot precompose callback；provider 自己拥有既有 final directive 合并 |

## 严格 P3 legacy-to-consumer 投影

P3 当时的真实调用是：

```js
buildContinuityInjection(next, { director, maxVisible })
```

没有 `selectedThreadIds`。P4 枚举 `director` 与 `rawMaxVisible=0..4`，以同一 `state`、同一调用签名重演旧 renderer，并独立计算：

```js
threads
  .filter(thread => thread.stage !== 'resolved' && thread.relation === 'converging')
  .slice(0, Math.max(0, Number(rawMaxVisible) || 0))
  .map(thread => thread.id)
```

P3 namespace normalize 与 P4 重演均复用 `cleanText(..., 12000)` 形成同一 canonical 文本；枚举先按 `(canonicalText, visibleProjection)` 去重，再要求 canonical 文本与 `payload.text`、visible projection 与 `payload.visibleThreadIds` 同时精确且唯一匹配，才将旧第一行 bridge 外壳及第二行固定 director 行剥离。`maxVisible=0` 在 renderer 中显式保留为 0，不再被默认值 2 覆盖；当 0/2 因无可见支线而产生完全相同的文本与投影时，它们属于同一 canonical 候选而不是伪歧义。renderer canonical 全文若超过 12000 而在持久化时截断，则投影 fail-closed，禁止从重演全文补回持久包中不存在的尾部。

不匹配、缺闭合、未知版本、多个三元组匹配、callback throw 或 receipt digest 不符，均 release + fail-closed，绝不投 legacy bridge 文本。

## 消费、释放与退化

- `consumerLease/consumeProof` 是 `nextTurnInjection` 的唯一 P4 写入面，且只保存身份、slot/provider receipt 与 `consumerPayloadDigest`，不存第二副全文。
- `recordNextTurnConsumerInspection` 只记录受控 `verified/ticket_only` 与固定失败码，不记录 prompt、正文、人物或世界内容；成功 fallback/provider placement 不再停留在含混的 `disabled`。
- stop、dry、quiet、chat switch、scope 变化、未接受正文、swipe/regenerate 替代均清空唯一 ST key 并释放未绑定 ticket batch；刷新不恢复内存 ticket。
- accepted final 后仅在 scope、final target 与 digest 严格匹配时写 consume proof；P2 仍按既有 ActorRef 注册/readback 逐人绑定票据。
- 当前缝合怪只有归档配置、TavernDB 默认召回没有第三方 verified slot；两者均不会自动注册，也不会被医生写入其 prompt/finalMessage/injects/user_input。TavernDB `GENERATION_ENDED` 填表保持独立。
- `applySocialInjection`、`applyContinuityInjection`、`registerSerendipityInjection` 已物理移除；P4 只清理三个固定旧 key，随后唯一写入 `mvu-auto-doctor-next-turn-consumer`。
