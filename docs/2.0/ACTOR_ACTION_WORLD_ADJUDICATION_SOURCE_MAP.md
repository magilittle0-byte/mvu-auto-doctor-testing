# 阶段5：人物尝试与世界裁决来源映射

## 第三方来源与许可边界

- **World**：核对了 `master` 根目录完整树。与本阶段直接相关的实际文件是 `world-engine-core.js`、`world-engine-ledger.js`、`world-engine-store.js`、`world-engine-inject.js`、`world-engine-evolution.js`、`world-engine-api.js`、`world-engine-chatcache.js`、`world-engine-worldbook.js`、`world-engine-rules-loader.js`，并同时核对了 `world-engine.js`、`world-engine-diag.js`、`world-engine-inject-inspector.js`、`world-engine-preset.js`、`world-engine-ui.js`、`world-engine-worldmap.js` 与 `memory-engine-*` 文件。当前树中没有 `world-engine-timeline.js`；实际存在的是 `memory-engine-timeline.js`。根目录与完整树均未发现 `LICENSE`、`COPYING` 或 `NOTICE`。
- **story-oracle**：优先读取本地完整副本 `C:\Users\asus\Documents\New project\story-oracle-upstream`，固定提交 `661f9f89446de473ace70a590897ca5065bc2efe`；完整读取 `README.md`、`index.js`、`manifest.json`、`style.css`，并核对 `.git`。根目录与仓库树未发现 `LICENSE`、`COPYING` 或 `NOTICE`。
- 因上述公开仓库没有可核验许可证，本阶段的“复用”严格指**成熟架构、时序、状态机和失败语义复用**：在本项目既有 Actor Ledger、namespace readback、SillyTavern generation target 与 continuity 接口上独立实现最小适配；没有逐字复制第三方代码或提示词，也不把独立适配冒充原样代码移植。

## World 与 story-oracle 的实际架构映射

| 来源 | 实际读取的成熟实现 | 本项目落点 | 复用类型与差异 |
| --- | --- | --- | --- |
| World `world-engine-core.js` / `world-engine-evolution.js` | 稳定 typed ID、重复 ID 修复、阶段/状态推进、只返回变化字段的稀疏增量、旧 checkpoint 继承、forward/redo/reroll 基线隔离、失败恢复 | `ActorRef`、`actionAttempts`、`WorldAdjudicationResult`、严格 generation target、失败后保留原 pending attempt | 架构与时序复用，按现有 Actor Ledger 独立适配；不复制源码 |
| World `world-engine-ledger.js` / `world-engine-store.js` / `world-engine-chatcache.js` | 差异账本、同轮覆盖、持久镜像、异步存储、聊天级 live mirror、目标冲突防护 | attempt 先写顶层唯一 journal，再写引用收据并强制 namespace readback；裁决后再次内容读回；聊天/分支/代次 fail-closed | 最小接口适配；World 没有 SillyTavern swipe/generationId/generationType，因此完整 target 合同为本项目新写 |
| World `world-engine-inject.js` / `world-engine-worldbook.js` | 条件满足才注入、可见性过滤、受限文本预算、触发条件与世界书分离 | 私密离屏结果保持 pending disclosure；只有 public/已观察摘要进入 world event 与正文注入 | 架构复用；明确不注入私密意图和有限知识 |
| World `world-engine-api.js` / `world-engine-rules-loader.js` | 解析、重试、规则加载、有限知识和时间约束 | 运输失败、格式失败、裁决合同拒绝分别记录；人物地点/时间/知识/资源约束在本地准入完成 | 架构复用；保留项目既有模型路由与恢复所有权 |
| story-oracle `index.js` waypoint / arc / transition 实现 | 稳定 waypoint ID、目标—障碍—选择—后果、难度对应成本、有限知识、yes/unsure/no 证据门、stale stamp、解析/运输重试分离、无证据不推进 | attempt 保存目标与依据、预期时间/成本/风险/反馈；世界逐项返回 success/partial/failure/delayed/blocked 与实际收据；无新裁决保持 pending | 状态机与验证方式复用，独立实现；不复用会反向推动玩家目标或替玩家选择的部分 |

## 阶段5唯一日志决定

- 顶层 `actorLedger.actionAttempts` 是完整 attempt 的唯一权威持久日志，保存 attempt 状态和绑定的世界裁决结果。
- `actionReceipts` 只保存阶段/结果收据并引用 `attemptId`，不再内嵌完整 attempt。
- 历史 `actionReceipts.actionAttempt` 只在规范化读取时提升为 `compatibilityOnly`、`settlementEligible=false` 的迁移历史；随后从收据投影中移除，绝不进入新裁决。
- 未终态 attempt 与其引用收据优先、无损保留；容量只淘汰终态历史。未终态数量本身超限时保留全部并写入 `actionAttemptBacklog.status=pending_over_capacity`，由统一诊断投影显示，禁止静默丢失恢复状态。

本文记录阶段5实际读取的成熟参考本体、项目内复用链、最小适配和不得不新写的部分。它不是第二套提示词、动作账本或世界账本，也不改变数据库、MVU、预设、缝合怪、医生和世界裁决各自的所有权。

## 阶段5实施合同

1. 只有已进入阶段3 `ActorRegistry`、拥有稳定 `ActorRef`，且阶段2完整档案已原子提交并通过 digest/commit/readback 校验的人物，才能提出 `ActionAttempt`。
2. `ActionAttempt` 只描述人物的目标、障碍、选择、知识/资源依据和预期时间、成本、风险、可观察后果；它必须先写入既有 Actor Ledger 并完成持久化读回，才可交给世界裁决。
3. `WorldAdjudicationResult` 必须逐项绑定同一 `attemptId`、`ActorRef`、chat、logicalIndex、message、swipe、generation serial/id/type、branch 和 content hash，并返回成功、部分、失败、延后或阻断的实际结果。
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

| 既有成熟机制 | 阶段5复用方式 |
| --- | --- |
| 阶段2 `ProfileInsertCandidate`、`actorProfileBaselineDigest()`、原子 namespace 写入和内容读回 | `actorProfileActionReadiness()` 直接以 coverage、prepared、commit、schema、ActorRef、digest 和 readback 为行动就绪门；`legacy_persisted` 只读兼容但必须迁移，不能成为新行动证据 |
| 阶段3 `ActorRegistry`、typed `ActorRef`、身份隔离和聊天域注册 | `actorActionEligibility()`、人物调度、shard 候选和尝试持久化都读取同一注册项；隔离人物、未注册人物和 ActorRef 不一致均拒绝行动 |
| 既有 Actor Ledger、action receipt、actor shard 与 sovereignty task/lease/retry | `ActionAttempt` 作为 Actor Ledger v8 内的有界 pending journal 和 `attempted/pending_world` receipt 保存；没有新建第二套动作账本或任务系统 |
| 既有 continuity/world lane、世界压力、公平调度和注入收据 | 结构世界轨继续独立调度；人物结果仅在有效世界裁决后生成 world event，并继续沿既有可见性与注入收据路径进入正文 |
| 阶段4 generation 事务目标 | 同一 chat/message/index/swipe/generation/branch/hash 绑定扩展到人物尝试和世界裁决；旧 swipe、换 chat、重生成和迟到回包一律失配 |

## 最小适配

- `actor-authority-core.mjs`：把旧的普通 attempt/result 对象收紧为 `action_attempt` 与 `world_adjudication_result`，补齐 typed `ActorRef`、完整 generation target、预期与实际时间/成本/风险、资源成本、可见性、观察者、公开/私密摘要、可观察后果和 `revealPath`；保留既有玩家主权、能力与资源检查。
- `actor-ledger-core.mjs`：在原 Actor Ledger 内增加有界 `actionAttempts` pending journal；复用原 action receipts，先记录和读回同一尝试，再允许 settlement。失败/延后仍可记录世界回执，但只有 success/partial 能应用被裁决的状态变化、资源、地点和计划。
- `index.js`：沿原生产链把“shard 候选 → 本地准入 → 尝试持久化读回 → continuity 世界裁决 → 本地批次验证 → settlement”串联；恢复时读取同一 pending attempt/candidate，不重新请求人物模型或生成新 attemptId。恢复任务物化与本轮人物集合以这些 exact-target pending attempts 的稳定 ActorRef 为唯一权威；即使本轮重算调度选择了另一人物，也不会为其启动 worker、制造 `output_missing` 或替换原 attemptId。
- `continuity-core.mjs`：修复提示只增加同一 `attemptId`、`ActorRef`、target 以及实际裁决字段；没有新增第二个世界模型入口。
- `tests/browser-runtime.test.mjs`：本地宿主夹具从真实 `actionAttempts` 读取并原样回传绑定字段，不再制造只有 attemptId 的旧式假裁决。

## 不得不新写

- 完整 action target 规范化与逐字段匹配：参考作品没有 SillyTavern chat/swipe/generation/branch/content-hash 的迟到隔离语义。
- 尝试先行持久化及内容读回验证：参考作品没有本项目 namespace、host save/readback、事务 revision 和恢复机制。
- 世界裁决批次完整性校验：必须拒绝未知 attempt、重复 attempt、缺项、ActorRef/target 错配，以及越过人物提案的资源或状态变化。
- `pending_world` 恢复：必须从同一 Actor Ledger 恢复原 attempt 和 candidate，不能在重试中重写人物意图或把上次尝试当成功。
- 阶段5静态与行为反例：覆盖成功/部分/失败/延后、玩家主权、知识/能力/资源越界、多人物确定性、目标错配、无裁决零写入，以及人物轨失败但结构世界继续。

## 封死的生产旁路

- settlement 不再从 candidate 临时重建 attempt；没有已持久化 journal 与 attempted receipt 就拒绝。
- success/partial 之外不应用 proposed state changes，不扣资源、不移动地点、不推进计划，也不把 desired effect 写成状态事实。
- 模型返回先过完整批次校验；一项重复、缺失或绑定错误使本批次 fail closed，所有尝试继续等待有效裁决。
- pending attempt 的恢复必须匹配当前完整 target；旧 chat、swipe、generation、branch、hash 或迟到结果不能复用。
- 人物 worker/持久化失败只记录人物技术失败，后续 `scheduleWorldLanes()` 仍运行；独立世界事件 `actorId` 为空，不生成代言人物。

## 所有权保持不变

- 预设：只消费阶段4生成前人物票据并塑造首次出场，不做事后世界裁决。
- 医生：观察、验证、原子档案、持久化、失败恢复和诊断；不增加内容外审。
- 人物 shard：提出人物自己的有限尝试，无状态写权限。
- 世界裁决/continuity：决定尝试的实际结果、耗时、成本、风险、可见性与可应用变化；不替玩家决定。
- 结构世界轨：独立推进势力、环境、经济等过程，不伪造人物行动。
- 数据库：继续从最终接受正文独立填表；不把医生账本写入当数据库成功。
- MVU：继续拥有实时变量；阶段5没有新增 MVU 写入口。
- 缝合怪：继续拥有未执行规划；规划只能作为候选背景，不能覆盖玩家、骰子、权威设定或裁决。

## 证据边界

阶段5只运行语法、JSON、针对性行为/静态反例和适当纯本地回归。它不包含真实模型、真实数据库、SillyTavern、Tauri、正式构建或正式发布门禁，因此本文件不是正式发布证据。
