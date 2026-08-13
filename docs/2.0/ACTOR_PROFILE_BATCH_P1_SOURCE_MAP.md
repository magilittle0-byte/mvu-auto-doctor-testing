# 阶段二：人物档案批量填表来源映射

## 范围

本文件记录阶段二的唯一生产链：最终接受正文 → identity bootstrap 建立已有/新发现行身份 → 按 missing/refresh module group 依赖顺序填表 → candidateRef 严格原文锚定 → ActorCandidate/ActorRegistry promotion → 同一 characterCreationTicket 条件绑定 → 全组 working clone 校验 → actorLedger pending/readback → finalize/readback。它不启动世界模型、人物行动、agent pool、正文注入、外部 TavernDB CRUD 或总 barrier。

本轮只修改测试仓中的人物档案编排、连续性 SourceRef 保真、P3 诊断/界面、对应测试和本来源映射；不修改正式仓、外部 TavernDB、MVU、预设或角色卡。

截至 2026-08-13，本轮修改仍在测试仓工作树中；自动测试、现役模块语法检查和差异格式检查已经执行，真实 API/TauriTavern、浏览器、构建与 CI 尚未执行，也尚未暂存、提交或推送。最终交付记录以提交时的现场结果为准。

## 成熟来源与移植分类

| 来源 | 精确机制 | T/A/X 分类与本阶段处理 |
|---|---|---|
| `TavernDB_template_03_数据库表格模板_MVU一致性修正版.json` | 每个目标表有独立 Note/current rows，兼容目标按 group 调度；模型负责语义填表，脚本负责格式与 working clone；组失败不以空值或删列伪造成功 | **T**：直接复用“目标 Note/current rows → 兼容 group 调度 → 失败组反馈重试 → working clone → 统一提交”生命周期；**A**：sheetKey 映射为 `{ActorRef, profileModule}`，隐藏 targetRows 仅作人物与模块路由，人物内容保持自然中文 |
| `shujuku-spv8.4-index.test-fixture.js` 及对应 sanitizer/parser/orchestrator 源码 | sanitize、平衡括号提取、splitTopLevelSegments_ACU、逐行 salvage、schema validate、working clone、commit/readback | **T**：围栏/废话/标点/引号/逗号/括号宽容修复与逐行 salvage；**A**：以 ActorRef/candidateRef 分流；SQL、tableEdit、CRUD 和外部数据库时序不复制 |
| `数据库模板-super自定义7.12总版-caikis.json` 人物表 | first_npc → second_npc 晋升；同轮多人物完整填行；确认事实优先，缺项合理补全 | **T/A**：同一次填表决定 INSERT 行并填整行；candidateRef 经既有 ActorCandidate → characters → registered 严格 promotion 后才重键 ActorRef |
| npc_tracker | registry gate、逐人物隔离、收集后串行 apply、最后 save | **A**：只移植既有 Registry 严格匹配、逐人物隔离和串行 apply；其“先 AI gate 再填表”的第二次调用不复制 |
| `deliverables` 与知识档案 `original_sources/预设` 中的糖糖公司、Izumi、PrismFox；测试仓库 `dist/01_主预设_人物万花筒_P5同票塑形候选版.json` | 多轴人物差异、自然中文档案、生成前票据塑形、权威人物不重写 | **T/A**：只条件消费 Stage4 已存在的同 generation 票据；权威字段只补空缺；票池耗尽不事后重掷 |
| 项目 P0/P1/P5 source maps 与现有 core | ActorRef、Registry、ticket binding、baseline commit/digest/readback/readiness | **T**：复用现有 promotion/ticket/namespace writer；**X**：宿主 fail-closed 所需 canonical actorLedgerDigest、writer-time CAS 和 pending → finalize 双 readback；复用同一宿主 namespace 增加 `actorProfileRetryReceipt` 与同 generation 票据摘要以支持刷新后定向恢复，不新增第二档案 store、全局 barrier 或平行编排器 |

原附件失效时读取的是项目内明确标注的副本，不把副本称作附件原件。私人诊断与跑团原文不进入源码、提示词、文档或外部系统。
2026-08-11 的两份私人故障附件原临时路径当前不可读；本阶段只采用既有诊断摘要、P1/P5 source map 与旧任务中的调用链结论，
没有伪称读到原文。逐行现场复核和真实 refresh/restart 行为仍留给全部模块完成后的统一本地验证。

## 唯一生产调用图

## P13 宽容解析来源映射（格式层，不改语义）

- `shujuku-spv8.4-index.test-fixture.js`: `normalizeQuotesLayer_ACU`、`sanitizeJsonPipeline_ACU`、`splitTopLevelSegments_ACU`、`tryParseLooseJsonValue_ACU`、`coerceLooseRowObject_ACU` 与 `tryParseJsonObject` 是本次逐项核对的成熟来源。
- 已有直接复用/适配：围栏与废话剥离、主对象/数组、JSONL/连续对象、弯引号、控制字符、未引号键、尾逗号、缺闭合、深度感知拆分、逐行 salvage、轻微字段别名及类型归一。
- P13 最小移植：标准单引号的嵌套 object/array、对象内可明确识别的缺属性逗号、以及只在已知 ProfileInsertCandidate object/array 字段中对“完整且类型匹配”的字符串化 JSON 容器转换；顶层整体引号包装的结构不拆包，普通废话前缀的英文缩写 apostrophe 不会吞掉后续真实结构根；任意引号自然文本、带后缀或类型不匹配的内嵌 JSON 保留原字符串并交 schema 拒绝。仅机械恢复并记录有限 repair label，随后仍走既有 ActorRef/candidateRef、锚点、schema、authority 与 pending→final/readback 门。
- 明确不移植：`tableEdit` 块提取、SQL/ORM、数据库 CRUD、表写入时序以及任意自由文本语义猜测；格式无法恢复时维持 fail-closed，才允许一次 discovery-only 联合 replacement。

## 2026-08-13 modular group lifecycle correction

The former claim that “seven bounded Markdown-like sections” and a “single JSON array” were adapted from TavernDB was inaccurate. Production no longer uses either as its generation protocol. What is actually reused from TavernDB is the lifecycle: each target table owns a Note and current rows; the scheduler selects only missing/refresh targets and joins compatible targets into groups; each group receives one model response; every result is applied to one transaction-local working clone; only failed groups retry; any terminal group failure means zero commit for the complete actor batch.

Doctor uses four explicit groups: route-only `identity_bootstrap`, `character_core(person/personality/history/relationshipsMotives)`, `operational_profile(currentState/knowledgeCapabilitiesResources)`, and conditional `physiology_optional(physiology)`. The route-only probe creates no dossier content: it supplies literal displayName/row keys for local SourceRef/ActorRef locking, then character_core fills person and the other core modules from full authority/ticket context. Later groups use determined ActorRef targets and are scheduled in dependency order so each receives the latest transaction-local working row; this prevents operational modules from missing the just-generated person/core material. Full mode therefore remains at most three group calls and full_adult at most four, rather than one call per person per module.

For a discovery row, the same-generation ticket shown to later groups is explicitly provisional working authority. The prompt carries the precedence order (fixed authority and accepted narrative, confirmed profile, then non-conflicting ticket axes); prose cannot overwrite local `confirmed`, `locks`, or `designRolls`. Only the existing local Registry promotion plus ticket-binding routine determines the final binding and discards axes already established by authority. This is a minimal Doctor adaptation because TavernDB rows already have stable identity before fill, while Doctor must bootstrap a new ActorRef from accepted narrative without persisting a partial row.

Each prompt contains independent module Notes, exact targets, fresh current module values, and authority material. Compact JSON in targetRows is hidden routing metadata only; authored values remain natural Chinese. The response uses only lightweight target/module routing tags, never user-visible fixed headings. The parser tolerates fences, surrounding prose, Chinese quotes, and minor tag variants, but never guesses a slot from Chinese semantic keywords. Duplicate, unexpected, or missing targets/modules fail closed. The old single-dossier/seven-heading parser is load-time compatibility only and is not a production generation fallback.

Direct reuse: per-target Note, group scheduler, working clone, unified commit, and failed-group retry. Minimal adaptation: sheetKey maps to `{ActorRef, profileModule}`, a row maps to ActorRef, and history maps to full SourceRef/CAS. Natural module text is stored in the deterministic `narrativeSections[moduleKey]` slot. Existing confirmed/ticket-owned structured facts are retained; module prose is never reverse-parsed into relationships, knowledge, resources, goals, or world outcomes. P3 Recall already carries the complete `profileV6`, so it consumes these deterministic module slots directly.

Doctor-specific necessary code: strict ActorRef/candidateRef identity, full SourceRef, transaction-local successful-group cache, same-source/fresh-revision guards, Registry/ticket binding, and pending -> host readback -> final -> host readback CAS. Successful group output is never persisted separately. A terminal generation failure returns S0; only a Phase2 failure after a verified Phase1 may retain non-ready S2. TavernDB, MVU, presets, and Doctor remain independent.

## P14 legacy narrative dossier compatibility boundary

- Reused unchanged: ActorRef/Registry promotion, exact accepted-text anchor,
  ticket binding, source/scope guards, one failed-subset replacement, and the
  pending -> host readback -> final -> host readback transaction.
- Legacy read-only compatibility: old persisted one-person dossiers may still
  be loaded. Their seven-heading parser is never used for new model output.
- New local compatibility layer: `profileFormat: narrative-v1` and ordered
  `narrativeSections` are canonical content.  They are digested with the
  baseline receipt.  Legacy V6 remains read-only and is never bulk-migrated.
  Narrative prose is display context only: it is not parsed into knowledge,
  resources, capabilities, locations, relations, player choices, or world
  results.  Those structured ledger facts retain their existing owners.

## 2026-08-13 no-candidates authority receipt source map

P1 的两处 current-source Registry lookup 与 P3 fresh-read gate 统一复用现有 `actorProfileRecoverySourceMatches`。Registry SourceRef 持久投影不保存冗余 scope 对象，因此比较前只对齐该既有投影；identityScopeId、scopeDigest、generation、swipe 与正文 contentFingerprint 仍严格，只有宿主 MVU/机制块写回造成的 full hash 漂移被允许。未新增 matcher 或身份推断。

| 来源 | 分类 | 本轮复用与边界 |
|---|---|---|
| 现有 P1 `actorProfileRetryReceipt`、完整 Recovery `SourceRef`、source digest、receipt seal、同聊天 namespace writer、writer-time CAS 与 durable content readback | **T（原样复用）** | `no_candidates` 终态回执直接使用同一套 SourceRef 规范化、source matcher、source digest、回执 payload digest 和宿主 CAS/readback；没有第二套 source normalizer、第二个 store、queue、barrier 或 checkpoint。|
| TavernDB / `shujuku` 的 staged working transaction -> terminal cleanup/readback | **A（最小适配）** | 将“事务结束后清理暂存材料并读回确认”适配为：同一次 namespace 写入同时清掉匹配 ticket batch 与 retry receipt，并保存最小 terminal receipt；content validator 必须读回三者的一致状态。没有复制 TavernDB CRUD、表状态机或数据库所有权。|
| `caikis` 人物表与 `npc_tracker` | **T/A（保持既有边界）** | 仅沿用 identity promotion、明确空结果与 registry gate 语义；不从这些作品新增持久层、人物扫描器或世界推进协议。|
| Stitches Recall -> Advance、现有 World/Continuity `world_call_reserved -> world_candidate_prepared -> committed`、fresh snapshot/checkpoint，以及 P4 lease/settlement proof | **A（只复用恢复形状）** | P1 终态回执只作为现有 P3 fresh-read actor gate 的上游 authority receipt。P3 放行后仍进入原有 Recall/Advance、prepared checkpoint、settlement 与 P4 exact-once consumer；已存在的 prepared/committed world package 仍走原恢复路径，绝不重演 Advance，也不复制世界状态、checkpoint 或 P4 lease/proof。|
| Doctor 的 P1 严格零行结论跨 refresh/restart 唤醒 P3 | **X（必要最小新写）** | 参考作品没有“P1 已证明本 generation 无人物，刷新后手动 P3 不重跑 P1”的跨阶段语义，因此仅新增一个最小、generation-bound terminal receipt payload/digest，以及在既有 P3 fresh-read gate 中消费它。旧 target、正文 fingerprint、identity/scope 或 generation 漂移、回执篡改、terminal cleanup 未读回均 fail-closed。|

该回执不是第二套编排器或世界 checkpoint：它不保存人物、世界候选、模型输出或完成队列，只证明同一 accepted target 的 P1 严格 `no_candidates` 已与 terminal cleanup 一起完成宿主读回。P1 读回失败仍降为 `not_completed`，不得加入 completed key，也不得唤醒 P3。

```text
accepted-final
  └─ enqueueActorProfiles(includeMaintenance=false)
       └─ runActorProfileTarget
            ├─ sovereigntyNarrativeEligible（只判定，不改正文）
            ├─ freshFrozenScopeGuard
            ├─ collectContinuityWorldContext（只读角色卡/世界书）
            ├─ 宿主只读 S0 = actorLedger + fieldRevision + canonical digest
            ├─ prepareActorLedgerProfilesV6（只生成模型输入草稿）
            └─ completeActorProfilesForTurn
                 └─ completeActorProfileBatchTransaction
                      ├─ identity_bootstrap 在同一 route-only 请求中要求每个 coverage unit 恰好一次结论；裸空答、缺失/重复/未知 unit 均不能证明 0 人，只有完整 unit 集全部 no-new 才可形成密封 no-candidates proof
                      ├─ 对确定行按 missing/refresh 调度 character_core → operational_profile → 可选 physiology_optional
                      ├─ actorRef 完整行 + candidateRef{name,sourceAnchor} 完整行
                      ├─ candidateRef 原文唯一锚点/真实 offset 本地校验
                      ├─ discoverActorsFromTurnSources(modelProfileDiscoveries)
                      │    → runActorRegistryUpsert
                      │    → actorCandidatesForRegistryPromotion
                      │    → promoteActorCandidatesToRegistry
                      │    → candidateId 精确重键 ActorRef
                      ├─ 同 generation Stage4 票据按 sourceAnchor offset 条件绑定
                      ├─ 有 Registry/票据 mutation 才 CAS save/readback 得 S1；否则 S1=S0
                      ├─ 本地宽容解析/事实覆盖/逐 ActorRef 校验
                      ├─ 仅不可恢复失败子集至多一次完整替换
                      ├─ Phase1：S1 CAS → pending_readback/false/not-ready → readback S2
                      └─ Phase2：从 S2 构造 finalize → CAS save → 最终 readback S3

手动当前来源重试
  └─ enqueueActorProfiles(force=true, includeMaintenance=false)

悬浮按钮 / 设置按钮 / public runActorProfiles
  └─ enqueueActorProfiles(force=true, includeMaintenance=true)

public runContinuity / enqueueContinuity / runContinuityTarget
  └─ P3 单批世界入口；独立读取 P3 所需状态并执行其 own proposal → attempt → world 流程
     （零 P1 discovery/Registry upsert/promotion/profile completion；不恢复 combined pool 或 barrier）
```

## 关键生产函数

| 文件 / 函数 | 所有权与合同 |
|---|---|
| `index.js/enqueueActorProfiles` | 模块私有单串行链、pending Map、completed Set、独立 status；pending duplicate 不制造 busy；epoch/chat 过期任务只能清自己的 owner，不能回写新聊天状态或 completed |
| `index.js/runActorProfileTarget` | 唯一人物档案模块入口；机制-only/纯补丁正文先被 eligibility 门拒绝；不进入世界/人物/action/pool |
| `actor-ledger-core.mjs/acceptedActorSourceRefMatches`（只复用） | 精确比较 chat/message/logicalIndex/index/swipe/generation/generationSerial/generationId/type/identityScope/scope/hash/contentHash/contentFingerprint；不使用 `branch`；Registry 已落而档案失败时，只有同 current source 且未 ready 的 ActorRef 重新进入 initial |
| 数据库 important role 行键与整行填表 + `actor-ledger-core.mjs/discoverActorsFromTurnSources(modelProfileDiscoveries)` | **T：**复用数据库非空唯一 display label/行键与整行填表语义，不要求户籍式姓名；**A：**Doctor 先用 route-only identity probe 只读 accepted narrative、registered/excluded 索引，允许正文逐字姓名、代号、编号、职业或描述性称谓作为兼容 `name` 行键，再用既有 literal sourceAnchor、SourceRef、ActorRef、Registry/CAS/readback 加强来源安全。不增加姓名扫描器、parser、store 或状态机；无效/重复锚点进入 unresolved。|
| `actor-ledger-core.mjs/actorLedgerDigest` 与 `actorProfilePendingWriteSetDigest` | canonical actorLedger CAS；pending write-set 投影包含 ActorRef/schema/commitId/profileDigest/pending/readback=false/not-ready/locks/manualOverrides 和 preparedFieldRevision |
| `actor-ledger-core.mjs/actorProfileReadinessInLedger` | 单 actor helper 只作第一层快速否定；持久 ready 必须从 final ledger 重建整批 pending 投影并核对 verification、当前 ActorRef/schema/profile digest |
| `actor-profile-v6-core.mjs/selectActorProfileCompletionCandidates` | current-source initialActorIds 不限人数、不受 8/24 截断；历史欠账只在显式 maintenance 下受 actorProfileBatchCapacity 预算 |
| `actor-profile-v6-core.mjs/actorProfileCompletionGroupPlan + buildActorProfileModuleGroupMessages` | 从 fresh canonical profile 选择 missing/refresh module targets；每个兼容 group 的 Notes 只注入一次；隐藏 JSON 只作人物/module 路由，模块值保持自然中文；后续 group 读取同一 transaction working row 与权威投影 |
| `actor-profile-v6-core.mjs/parseActorProfileModuleGroupOutput` | 去围栏/前后文、宽容标签引号/中文标点/alias；严格拒绝重复、越界、缺 target/module；不按中文语义关键词猜槽，不把旧整篇档案 parser 带回生产协议 |
| `actor-profile-batch-core.mjs/completeActorProfileBatchTransaction` | identity bootstrap → dependency-ordered groups；每组先在 group-local clone 验完再并入 transaction working clone；失败只携真实安全反馈重试该组；任一终局失败整批 S0；全部成功才进入 pending/final 两阶段读回并 ready |
| `actor-profile-v6-core.mjs/actorProfileActionReadiness` | 兼容用第一层快速否定，不能单独授予持久 ready；阶段二生产判定统一使用 ledger-level 重建验证 |
| `index.js/runContinuityTarget`、`enqueueContinuity` | P3 单批世界入口；不含 discovery、Registry upsert/promotion、Registry readback 或 profile completion，且不恢复 combined pool、barrier 或旧注入 |

## 人数、预算与重试

- 0 人：合格自然正文只执行 identity bootstrap；只有首次响应成功解析并明确返回严格“无人物档案”，且 current-source incomplete、missing/unexpected/unresolved/quarantine/schema/ticket/commit/readback/maintenance failure 全为空，才返回 no_candidates。首次响应若包含任何非空输出、候选或 identity/schema failure，重试的空答不得把它改成 no_candidates。模块 off、机制-only、空正文才是 0 调用。
- 1、3、6、超过 3、超过 24 个本回合新人物：全部 current-source initial 进入同一个正常批次，不设人物上限，不拆成人均调用。
- Registry 已成功保存但档案批次失败：显式手动 retry 通过 Registry.sourceRefs 与 captured source 的全字段精确匹配找回未 ready ActorRef；不按姓名猜，不提升历史来源。
- 历史欠账：自动 accepted-final 不处理；只有手动 includeMaintenance=true 时才按可配置预算加入同一批次。
- 正常 full 批次最多三个兼容 group 调用，`full_adult` 最多四个；已 ready module 不重调。每个失败 group 仅允许携其真实解析/结构错误做一次定向重试，先前成功 group 只缓存在本次 transaction 内存；运输失败只由 route/failover 处理，不伪装成语义成功。

## 权威、同票与完整度

- confirmedAnchors 只读；模型输出与低层草稿不能覆盖角色卡、原著、数据库确认事实或已接受正文。
- characterCreationTicket 只消费正文前同一票；正文后不签发、不重掷、不换票。
- ticket_pool_exhausted 明确记录，designRolls 保持 null；该人物仍结合权威、正文、世界观与可修订 hypothesis 完整建档。
- 自创字段标 hypothesis，同票派生标 designed_seed；不把推断冒充 confirmed。
- 人格衍生每组 2–3 条、每条 30–100 个中文字符；他者声部 4–7 条；作者声部不超过 200 字。启用生理档案时逐字段完整填写；不适用必须写物种原因。

## 原子保存与 refresh/restart

- S0 的 expected digest 对宿主 raw `actorLedger` 做 canonical digest；若旧 Registry 仅缺空 `scopeDigest`，事务候选在 fresh scope 证明后才最小填入，第一次合法写不会因内存填空自撞 CAS，任何非空 scope mismatch 仍 fail-closed。S0/S1/S2 的 `fieldRevisions.actorLedger + canonical actorLedgerDigest` 均由既有每聊天串行 writer 在真正执行时精确 CAS；锁、manual override 或其他 ledger 改动使旧模型结果 stale，绝不借最新 revision 重基。
- 联合提示中的详细 ActorRef 只来自 current-source initial 与显式 maintenance；其余全部 registered ActorRef 仅存在于 compact 去重索引，不作为可选历史欠档目标，也不会触发自动维护。
- Registry 无实际 mutation 时零 host save/readback，S1=S0。Profile Phase1 只落 `pending_readback/readbackVerified=false/preparedForAction=false` 并读回 S2；pending 永不 action ready。
- Phase2 只从真实 S2 构造 finalization。最终读回成功才是本次 atomic_readback；失败时本次 not_completed，返回/渲染不采用未认证 final candidate。
- refresh/restart 只从宿主 final ledger 重建对应 pending write-set projection，核对 preparedLedgerDigest、preparedFieldRevision、commitId、profileDigest、ActorRef/schema/locks/manualOverrides；不能只信 status/readbackVerified/verification 自报字段。
- `{module:'actor_profiles', ...}` 只作为本次 Promise 返回与当前诊断展示，不持久化为 barrier、receipt 或总完成状态。
- refresh/restart/CHAT_CHANGED/CHAT_LOADED 只 invalidate/cancel、清模块内存状态并从 actorLedger 读取；不会 discovery、调用模型或自动补历史欠账。
- 新聊天由 chat/card/worldbook/scope 隔离；swipe/regenerate 使用当前捕获 sourceRef 的 message/swipe/generation/scope/content 全字段精确匹配，旧分支迟到结果被 epoch/chat/scope/CAS 拒绝。

## 外部系统边界

TavernDB 完全独立：Doctor 不调用它的 CRUD、不等待它、不把数据库成功当人物档案成功。世界模型、人物行动、agent pool、下一回合注入、缝合怪重接和总 barrier 都留给后续阶段。
