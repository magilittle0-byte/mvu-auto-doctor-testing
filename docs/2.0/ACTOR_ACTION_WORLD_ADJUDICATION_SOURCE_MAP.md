# P4：人物行动尝试与世界裁决来源映射

## P4 实际交付边界

P4 只把人物提案入口从“每人一次模型调用，失败后还可再调用模型修 JSON”收束为“同一已接受正文目标最多一次人物提案批调用”，并继续接入既有的 `ActionAttempt` 先行持久化和 P3 单次世界连续性批裁决。没有进入 P5/P6/P7，没有改写 P1 人物整表原子提交、P2 正文接受后世界工作与 MVU 并行、P3 世界连续性单批次/单写入/读回/精确恢复架构。

| 环节 | P4 前生产链 | P4 后生产链 |
| --- | --- | --- |
| 人物提案 | `runActorShardBatch()` 为每名人物调用一次 `callModel()`，最多五名；失败后生产入口还能再请求模型修 JSON | `runActorShardProposalBatch()` 对 0 人零调用，对 1/3/6 人均一次 `callBatch()`；`failover:false`、`maxFailovers:0`，无第二模型修复 |
| 格式与隔离 | 单人解析失败后可转模型修复 | `parseActorShardProposalBatch()` 只做本地批提取，再逐 ActorRef 绑定复用 `parseActorShardProposal()`；缺项、重复、未知身份和单项坏 JSON 只隔离该项 |
| 语义健康 | 运输返回可掩盖整批无可用动作 | 非空批次零有效提案返回 `semantic-failed`；收集状态、lease、agent pool、诊断和 sovereignty task 都保持失败，不回写为 completed |
| 尝试与裁决 | 尝试已先持久化，但上游是逐人模型调用 | 一次人物批提案后仍沿原链：本地准入 → `ActionAttempt` 原子写入与内容读回 → P3 一次世界批裁决 → 逐 `attemptId` 验证 → settlement |
| 恢复与过期 | exact-target pending attempt 可恢复 | 原样保留：精确恢复不创建人物提案 job，人物模型调用为 0；不重复 attempt、成本、receipt 或游标；过期 target/swipe/generation/content 输出为零且不能进入写入 |

## P4 逐项来源契约

| P4 结构/函数/提示词 | 成熟来源 | 复用分类 | 等价改写与接口字段替换 |
| --- | --- | --- | --- |
| `selectActorShardCandidates()`、`runRegisteredActorGate()`、`actorProfileActionReadiness()` | 项目既有 Actor Registry、Profile V6、identity quarantine 与 P1 整表提交读回门 | 原样复用 | 继续拒绝跨聊天、未注册、ActorRef 不一致、歧义/隔离和档案未 action-ready 人物；P4 只把验收上限由 5 扩为 6 |
| 单人物提示合同与 `parseActorShardProposal()` | 项目既有 `actor-shard-core.mjs` 的有限知识、地点、资源、能力、刺激决策、玩家主权、本地白名单和语义增量检查 | 原样复用 | P4 对批内每项重新调用同一解析器，没有另写人物语义审查器，也没有降低字段要求 |
| `buildActorShardBatchMessages()` | 既有 `buildActorShardMessages()` 完整系统合同；P1 一次档案批输入/稳定身份模式 | 等价最小改写 | 照 P1 的单批数组和稳定身份绑定组织输入；把 P1 的 `ProfileInsertCandidate`/档案字段替换为 `ActorRef`、有限知识、地点、资源、能力、行动窗口和预期成本/耗时/风险，保持“一次输入覆盖全批、每项上下文隔离”不变 |
| `parseActorShardProposalBatch()` | P1 candidate-local validation、部分坏项隔离、全批零语义失败；既有单项 parser | 等价最小改写 + 接口适配 | 保持“先解批包装、再按稳定身份逐项验证、坏项不吞好项”的解析顺序；把 P1 的 profile candidate key/schema/digest 检查替换为 actorId/ActorRef、行动白名单、知识/地点/资源/能力和语义增量检查 |
| `runActorShardProposalBatch()` | P1 一次模型批调用；npc_tracker `gate.js` 的一次 gate、逐人物隔离、汇总后统一应用；P2/P3 stale target fail-closed | 等价最小改写 | 保持“一次 gate/一次批调用/逐项隔离/汇总后提交”的调用时序；把 npc_tracker 的 profile/name 键和 host state 换成稳定 ActorRef 与 Actor Ledger，把 P2/P3 的 target stamp 换成完整 chat/swipe/generation/content 复核 |
| `collectActorShardProposals()` | P2 已接受正文目标；P3 `generateWorldContinuitySingleBatch()` 的单调用、无 failover、无第二修复模型 | 最小改写 | 替换人物提案入口，保留本地 current-target 去重、诊断和结构世界轨；人物批和世界批各最多一次，不为每个人再调世界 AI |
| `prepareActorActionAttempts()`、`recordActorActionAttempts()`、`persistActorActionAttemptsForTurn()` | 既有 Actor Ledger v8、P1 namespace 原子写入/内容读回、P3 exact-target 事务 | 原样复用 | attemptId、ActorRef、目标、知识、地点、资源/能力、预期成本/耗时/风险、可见性/揭示路径仍先完整落账并读回；P4 没有新动作账本 |
| `validateWorldAdjudicationBatch()`、`settleActorActionCandidates()` | 既有 actor authority/ledger；World typed ID/checkpoint/失败回滚；Story Oracle waypoint 证据门与成本后果状态机 | 等价改写并接入既有接口 | 把 World 对象 ID/phase/checkpoint 替换为 attemptId/ActorRef/status/pending journal，把 Story Oracle waypoint ID、yes/unsure/no 和 cost/consequence 替换为 attemptId、success/partial/failure/delayed/blocked、actual cost/duration/risk/observable consequence；验证顺序和“无证据不推进”状态机保持一致 |
| 本地坏 JSON 的平衡对象扫描 | P1“格式优先本地修复、语义逐项隔离”合同 | 接口层补充 | 保持 P1 的本地修复顺序；因行动批包装是 `proposals[]`，用平衡对象提取替换 P1 的 profile 批提取器，只恢复结构、不补写语义、不调用第二模型 |

`buildActorShardRepairMessages()` 与旧 `runActorShardBatch()` 仍作为历史测试/QC 兼容导出存在，但 `index.js` 的 P4 生产入口不再导入或调用它们；P4 静态反例封住逐人 `callWorker`、`repairWorker` 和修复模型重回生产链的旁路。

## 成熟参考实现读取与等价改写范围

- **World**：核对 `master` 根目录完整树，逐项照 `world-engine-core.js`、`world-engine-evolution.js`、`world-engine-ledger.js`、`world-engine-store.js`、`world-engine-chatcache.js`、`world-engine-inject.js`、`world-engine-worldbook.js`、`world-engine-api.js`、`world-engine-rules-loader.js` 的 typed ID、演化事务、checkpoint、差异账本、聊天隔离、可见性过滤、失败恢复和读回方式等价改写。
- **Story Oracle**：读取项目根下的本地完整副本 `story-oracle-upstream`（本机绝对路径未入库），固定提交 `661f9f89446de473ace70a590897ca5065bc2efe`；逐项照 `index.js` 的 waypoint/arc/transition、yes/unsure/no 证据门、成本—后果、stale stamp、forward/redo/reroll 和解析/运输失败分离方式改写。
- **npc_tracker**：读取项目根下的本地完整副本 `.codex-p0-reference-npc-tracker`（本机绝对路径未入库）的 `scripts/gate.js`、`scripts/profile.js`，并核对 `scripts/api.js`、`scripts/state.js`、`scripts/host.js`；逐项照一次 gate、每人物隔离、失败不吞同批、汇总后统一应用和单次保存的调用时序改写。
- 许可信息只约束不做整段逐字搬运，不影响成熟架构和实现方式的优先复用。本阶段实际执行的是**逐函数、逐状态、逐失败分支的等价改写**：保留参考实现的调用顺序、状态机、隔离、恢复与提交边界，只把参考作品字段替换为本项目已有 `ActorRef`、Actor Ledger、namespace readback 和 SillyTavern generation target 接口。

## World、Story Oracle 与 npc_tracker 的等价实现映射

| 来源 | 实际读取的成熟实现 | 等价改写到 P4 | 接口字段替换 |
| --- | --- | --- | --- |
| World `world-engine-core.js` / `world-engine-evolution.js` | stable typed ID、重复修复、forward/redo/reroll 基线隔离、阶段推进、失败恢复旧 checkpoint | `createActorActionAttempt()` 先建立稳定 attempt，`validateWorldAdjudicationBatch()` 再推进终态；失败保留原 pending attempt，恢复不重新生成 | World object ID → `attemptId`；entity ref → `ActorRef`；phase → attempted/pending_world/settled/held/rejected；checkpoint stamp → 完整 generation target |
| World `world-engine-ledger.js` / `world-engine-store.js` / `world-engine-chatcache.js` | 差异账本、同轮覆盖、持久镜像、聊天级 live mirror、写后读回与目标冲突防护 | `recordActorActionAttempts()` 先写唯一 journal 与引用 receipt，`persistActorActionAttemptsForTurn()` 单次 namespace 保存并内容读回；裁决后再次 settlement readback | World ledger/store/cache → `actorLedger.actionAttempts`/`actionReceipts`/chat namespace；chat cache key → canonical chat/message/swipe/generation/content target；revision/checkpoint → namespace revision + target digest |
| World `world-engine-inject.js` / `world-engine-worldbook.js` | 条件满足才注入、可见性过滤、受限预算、触发与存储分离 | 私密离屏结果保持 pending disclosure；只有 public 或被观察的结果生成 world event，并通过既有 injection receipt 进入叙事 | visibility filter → visibility/observerActorIds/publicSummary/privateSummary；trigger → `revealPath`；worldbook injection → continuity world event/injection receipt |
| World `world-engine-api.js` / `world-engine-rules-loader.js` | 运输、解析、规则和语义失败分层；有限知识、时间与规则约束 | 人物批运输失败、格式失败、单项准入拒绝和世界裁决拒绝分别记录；本地完成知识/地点/资源/能力准入 | rules context → actor candidate 的 limitedKnowledge/location/resources/capabilities；API retry/fallback → P4 单调用、无 failover、由 durable task 跨轮恢复 |
| Story Oracle `index.js` waypoint / arc / transition | stable waypoint ID、目标—障碍—选择—后果、yes/unsure/no 证据门、成本与难度、stale stamp、无证据不推进 | attempt 保存目标、依据和预期成本/耗时/风险；world result 保存实际成本/耗时/风险/可观察后果；缺项、重复、错 target 均保持 pending | waypoint ID → `attemptId`；goal/obstacle/choice → goal/knowledgeBoundary/action；yes/unsure/no → success/partial/failure/delayed/blocked；stamp →完整 target；consequence → appliedStateChanges/observableConsequence/revealPath |
| npc_tracker `scripts/gate.js` / `scripts/profile.js` / host-state 调用面 | 一次 gate、每人物独立校验、单项失败隔离、汇总后应用、保存一次 | `selectActorShardCandidates()` 先 gate action-ready ActorRef，`runActorShardProposalBatch()` 一次调用，`parseActorShardProposalBatch()` 逐人物隔离，随后 attempt journal 一次保存读回 | character name/profile key → `ActorRef.actorId` + displayName；profile rows → ActionAttempt candidates；tracker state/save → Actor Ledger + namespace durable write/readback |
| P1 `actor-profile-batch-core.mjs` | 一次模型批调用、stable candidate key、candidate-local schema/fact validation、部分坏项隔离、全批零语义失败、单次原子提交读回 | P4 直接沿相同时序实现一次人物提案批、逐 ActorRef 本地验收、部分成功继续、零语义失败；合格项再统一生成并保存 attempts | `ProfileInsertCandidate`/profile schema/commit digest → actor proposal/ActionAttempt/attemptId；profile namespace commit → actionAttempts journal commit |
| P3 `generateWorldContinuitySingleBatch()` 与 world transaction | 冻结 exact target、一次世界模型调用、无 failover/第二修复模型、本地解析、单写入读回、精确恢复零调用零写 | P4 人物提案批照同一单调用和 stale 双复核方式接入；有效 attempts 仍只交给原 P3 一次世界批统一裁决 | P3 captured target → actor batch target/ActionAttempt target；P3 raw batch output → actor proposal batch output；P3 stable world result ID → 逐项绑定的 attemptId/ActorRef |

## P4 唯一日志决定

- 顶层 `actorLedger.actionAttempts` 是完整 attempt 的唯一权威持久日志，保存 attempt 状态和绑定的世界裁决结果。
- `actionReceipts` 只保存阶段/结果收据并引用 `attemptId`，不再内嵌完整 attempt。
- 历史 `actionReceipts.actionAttempt` 只在规范化读取时提升为 `compatibilityOnly`、`settlementEligible=false` 的迁移历史；随后从收据投影中移除，绝不进入新裁决。
- 未终态 attempt 与其引用收据优先、无损保留；容量只淘汰终态历史。未终态数量本身超限时保留全部并写入 `actionAttemptBacklog.status=pending_over_capacity`，由统一诊断投影显示，禁止静默丢失恢复状态。

本文记录 P4 实际读取的成熟参考本体、项目内原样复用、等价改写和接口字段替换。它不是第二套提示词、动作账本或世界账本，也不改变数据库、MVU、预设、缝合怪、医生和世界裁决各自的所有权。

## P4 实施合同

1. 只有已进入既有 `ActorRegistry`、拥有稳定 `ActorRef`，且 P1 完整档案已原子提交并通过 digest/commit/readback 校验的人物，才能提出 `ActionAttempt`。
2. `ActionAttempt` 只描述人物的目标、障碍、选择、知识/资源依据和预期时间、成本、风险、可观察后果；它必须先写入既有 Actor Ledger 并完成持久化读回，才可交给世界裁决。
3. `WorldAdjudicationResult` 必须逐项绑定同一 `attemptId`、`ActorRef`、chat、logicalIndex、message、swipe、generation serial/id/type 和 content hash，并返回成功、部分、失败、延后或阻断的实际结果。
4. 未裁决、裁决无效、批次缺项/重复、目标错配或迟到结果均保持 `pending_world`；不得写入状态事实、资源消耗、地点、计划或已成功历史。
5. NPC 可以提出邀请或尝试影响玩家，但世界裁决只能确认“邀请已经提出”等 NPC 自身事实，不能替玩家行动、同意、付费、移动、产生感受或形成关系结论。
6. 人物轨和势力/环境/经济等结构世界轨独立调度；任一人物失败或无人行动不能吞掉结构世界进程，结构世界事件也不得伪造一个代言 NPC。

## 实际读取的成熟参考本体

| 来源本体 | 完整读取范围 | 直接复用的成熟结构 | 明确不复用 |
| --- | --- | --- | --- |
| `【MoM】糖糖公司 V3.2正式版 (2).json`，SHA-256 `9F630BCFD609B173FD0514EB1220B73118A797D1756162FA493E882A3BCBBDFA` | 节点 29、30、60—63、78—81、85—87、108、131、160、185—188：现实世界独立性、人物生活、有限知识、人物行动与叙事边界 | 人物拥有玩家之外的目标与生活；人物只能依据自身已知信息、能力、资源和处境作选择；行动通过目标—障碍—选择—后果体现 | 节点82中覆盖玩家意志的写法与本项目玩家主权冲突，禁止移植；创作提示不能充当世界成功裁决器 |
| `数据库模板-super自定义7.12总版-caikis.json`，SHA-256 `219E60B9327D8CF28E18ABC3EABE675996CCF4F03F872A2A8CE424F6A7179742` | 全量读取全局时间/地点、世界地图、首轮 NPC、追踪人物和 Memo 表的 note/insert/update/delete/DDL | 先收候选、满足来源和完整条件后再晋级；稳定唯一键；基线与动态更新分离；只有客观闭合结果或明确接受才能写入 Memo | 数据库模板自己的 SQL/宏和表格写入仍归数据库所有；不把数据库表复制为医生动作账本，也不把提议当成已接受结果 |
| `Izumi 0707.json`，SHA-256 `D84EB5EF43EB382D70031DE5DD319871C99759027645696626EC504F26DE6691` | 节点 40、110、128、153、164、180、195、201、202：玩家边界、有限视角、人物动机/知识、镜头转移、证据推断与日常人物驱动 | 不替玩家说话或行动；人物只使用自身可得知识；允许镜头转向其他人物的独立日常、目标和选择；关系与结论必须来自可观察证据 | 叙事镜头和人物动机不是状态写权限；模型猜测、内心旁白和规划不能直接成为世界事实 |
| `双人成行v11.0—PrismFox 正式版（数据库变量版）.json`，SHA-256 `32071A9D6B3516D5CF2FC42A1A83264F8B38E26DDCE5DAE34E7345572D07D2FC` | 节点 12—15、17、166—170、172、180、183、187、224：人物行动、目标—障碍—选择—后果、NPC利益、有限知识与物理约束 | 人物行动受身体、信息、利益、经历和现实障碍约束；以具体选择和后果推动世界；NPC与世界各有自身利益 | 不移植对用户施加武断惩罚或代写玩家结果的部分；不允许人物模型自行宣布世界或玩家终态 |

## 项目内原样复用

| 既有成熟机制 | P4 复用方式 |
| --- | --- |
| P1 `ProfileInsertCandidate`、`actorProfileBaselineDigest()`、原子 namespace 写入和内容读回 | `actorProfileActionReadiness()` 直接以 coverage、prepared、commit、schema、ActorRef、digest 和 readback 为行动就绪门；`legacy_persisted` 只读兼容但必须迁移，不能成为新行动证据 |
| 既有 `ActorRegistry`、typed `ActorRef`、身份隔离和聊天域注册 | `actorActionEligibility()`、人物调度、shard 候选和尝试持久化都读取同一注册项；隔离人物、未注册人物和 ActorRef 不一致均拒绝行动 |
| 既有 Actor Ledger、action receipt、actor shard 与 sovereignty task/lease/retry | `ActionAttempt` 作为 Actor Ledger v8 内的有界 pending journal 和 `attempted/pending_world` receipt 保存；没有新建第二套动作账本或任务系统 |
| 既有 continuity/world lane、世界压力、公平调度和注入收据 | 结构世界轨继续独立调度；人物结果仅在有效世界裁决后生成 world event，并继续沿既有可见性与注入收据路径进入正文 |
| P2/P3 generation 事务目标 | 同一 chat/message/index/swipe/generation/content hash 绑定扩展到人物尝试和世界裁决；旧 swipe、换 chat、重生成和迟到回包一律失配 |

## 最小适配

- `actor-authority-core.mjs`：把旧的普通 attempt/result 对象收紧为 `action_attempt` 与 `world_adjudication_result`，补齐 typed `ActorRef`、完整 generation target、预期与实际时间/成本/风险、资源成本、可见性、观察者、公开/私密摘要、可观察后果和 `revealPath`；保留既有玩家主权、能力与资源检查。
- `actor-ledger-core.mjs`：在原 Actor Ledger 内增加有界 `actionAttempts` pending journal；复用原 action receipts，先记录和读回同一尝试，再允许 settlement。失败/延后仍可记录世界回执，但只有 success/partial 能应用被裁决的状态变化、资源、地点和计划。
- `index.js`：沿原生产链把“shard 候选 → 本地准入 → 尝试持久化读回 → continuity 世界裁决 → 本地批次验证 → settlement”串联；恢复时读取同一 pending attempt/candidate，不重新请求人物模型或生成新 attemptId。恢复任务物化与本轮人物集合以这些 exact-target pending attempts 的稳定 ActorRef 为唯一权威；即使本轮重算调度选择了另一人物，也不会为其启动 worker、制造 `output_missing` 或替换原 attemptId。
- `continuity-core.mjs`：修复提示只增加同一 `attemptId`、`ActorRef`、target 以及实际裁决字段；没有新增第二个世界模型入口。
- `tests/browser-runtime.test.mjs`：本地宿主夹具从真实 `actionAttempts` 读取并原样回传绑定字段，不再制造只有 attemptId 的旧式假裁决。

## 接口替换层：成熟机制在本项目宿主上的等价落地

- 完整 action target 规范化与逐字段匹配：照 Story Oracle stale stamp 与 World checkpoint identity 的比较顺序实现；字段替换为 SillyTavern chat/message/swipe/generation/content-hash。
- 尝试先行持久化及内容读回：照 World ledger/store/chatcache 的“先提交、再读回、失败恢复旧状态”实现；存储接口替换为 Actor Ledger、namespace、host save/readback 和事务 revision。
- 世界裁决批次完整性校验：照 World typed ID/重复修复与 Story Oracle 证据门实现；实体键替换为 attemptId + ActorRef + full target，并补入玩家主权、资源和状态变化白名单。
- `pending_world` 恢复：照 World checkpoint 继承和 forward/redo/reroll 基线隔离实现；checkpoint payload 替换为 Actor Ledger 中同一 exact-target attempt/candidate，恢复时不重写人物意图。
- P4 静态与行为反例：把上述成熟状态机的失败分支逐项固化为成功/部分/失败/延后、玩家主权、知识/能力/资源越界、多人物确定性、目标错配和无裁决零写入测试。

## 封死的生产旁路

- settlement 不再从 candidate 临时重建 attempt；没有已持久化 journal 与 attempted receipt 就拒绝。
- success/partial 之外不应用 proposed state changes，不扣资源、不移动地点、不推进计划，也不把 desired effect 写成状态事实。
- 模型返回先过完整批次校验；一项重复、缺失或绑定错误使本批次 fail closed，所有尝试继续等待有效裁决。
- pending attempt 的恢复必须匹配当前完整 target；旧 chat、swipe、generation、hash 或迟到结果不能复用。
- 人物 worker/持久化失败只记录人物技术失败，后续 `scheduleWorldLanes()` 仍运行；独立世界事件 `actorId` 为空，不生成代言人物。

## 所有权保持不变

- 预设：只消费生成前人物票据并塑造首次出场，不做事后世界裁决。
- 医生：观察、验证、原子档案、持久化、失败恢复和诊断；不增加内容外审。
- 人物 shard：提出人物自己的有限尝试，无状态写权限。
- 世界裁决/continuity：决定尝试的实际结果、耗时、成本、风险、可见性与可应用变化；不替玩家决定。
- 结构世界轨：独立推进势力、环境、经济等过程，不伪造人物行动。
- 数据库：继续从最终接受正文独立填表；不把医生账本写入当数据库成功。
- MVU：继续拥有实时变量；P4 没有新增 MVU 写入口。
- 缝合怪：继续拥有未执行规划；规划只能作为候选背景，不能覆盖玩家、骰子、权威设定或裁决。

## 证据边界

P4 只运行语法、JSON、针对性行为/静态反例和适当纯本地回归。它不包含真实模型、真实数据库、SillyTavern、Tauri、浏览器、构建、CI 或正式发布门禁，因此本文件不是正式发布证据。

## 本地历史诊断复盘

只读复核“无限回廊6.1”本地诊断后，旧目标 6 的关键证据是：人物轨出现 4 次 actor shard 模型调用，但最终 `semanticActions=0`，世界裁决 `adjudication.consumed=0`。这说明“运输成功/调用完成”不能证明人物产生可裁决语义，逐人调用也没有形成 attempt → adjudication 的消费闭环。P4 没有复制私人跑团原文；只把这三个计数变成回归合同：非空人物批零有效提案必须显式语义失败，所有有效 attempt 必须先持久化读回，世界结果必须逐项消费同一 attemptId。

## P4 本地测试矩阵

- `tests/actor-shard-core.test.mjs`：0/1/3/6 人物、一次批调用、批提示隔离、单项坏 JSON/未知/重复/缺项/资源越界隔离、运输成功但语义为零、调用前后目标过期。
- `tests/actor-action-world-adjudication-p4.test.mjs`：生产入口只用批 runner、无逐人/repair worker、无 failover；语义零不会完成 lease、发布成功 pool candidate 或完成 actor task；exact-target 恢复不创建人物提案 job；六人物容量一致接通。
- `tests/actor-world-adjudication-stage5.test.mjs`（保留历史文件名，避免扰动既有引用）：稳定 ActorRef、完整档案门、跨聊天/目标错配、知识/地点/资源/能力、混合成功/部分/失败/延后/阻断、玩家自主权、私下 reveal path、attempt 先于 adjudication、精确恢复与 receipt 幂等。
