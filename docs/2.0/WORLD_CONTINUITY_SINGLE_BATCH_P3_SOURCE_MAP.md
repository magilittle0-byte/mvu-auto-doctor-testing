# P3 世界连续性单批次来源映射与实现合同

## 阶段边界

本文件只覆盖 P3 世界连续性。P2 的 accepted narrative 并行入口、queue、WAL、聊天 namespace writer 保持原位；P1 人物注册与完整档案批次、外部数据库填表、MVU 变量结算仍是独立所有权。本文不实现 P4 人物行动重构，也不进入 P5/P6/P7。

标记：

- **A**：按参考原样移植的局部算法。
- **T**：改名或最小接口适配，流程与参考保持一致。
- **X**：Doctor 宿主约束所需适配；参考没有对应的 SillyTavern target、WAL 或 namespace 接口。

## 成熟参考逐项映射

| 参考来源与函数 | 标记 | Doctor 对应入口 | 实际复用与适配 |
|---|---:|---|---|
| `World/world-engine-evolution.js::evolve`（1053 起） | T | `index.js::runContinuityTarget` | 直接映射为：`checkpointBase/base` 深拷贝旧态 → 生成一个 `scheduledBase` 状态包 → 一次世界生成 → 本地解析 → 稳定 ID merge/校验 → 一次世界域保存/读回；失败保留 `base`，不提交本地时钟为伪成功。没有复制 World 自带队列或 UI。 |
| `World/world-engine-evolution.js::callEvolutionAPI`（918 起） | T | `index.js::generateWorldContinuitySingleBatch` | 单一 prompt/state pack 只调用一次世界模型。Doctor 去掉 World 内部 retry，并强制 `failover:false`、`maxFailovers:0`；0/1/3/6 个世界事件都不改变调用数。 |
| `World/world-engine-api.js::parseJSON`（366 起） | A/T | `continuity-core.mjs::parseContinuityJsonLocally` | 原样保留“先直接 JSON.parse，再扫描最后一个完整顶层对象”的算法；改名并接入 Doctor 的 `ContinuityState` 标签。 |
| `World/world-engine-api.js::repairTruncatedJSON`（323 起） | A/T | `continuity-core.mjs::repairTruncatedContinuityJson` | 原样保留括号栈与最后完整成员边界恢复；仅改函数名与代码风格。不会调用修复模型。 |
| `World/world-engine-core.js::ensureEntityIds/findEntityIndex`（152/175 起）及分类 merge | T | `continuity-core.mjs::mergeWorldItems/applyWorldUpdate` | 继续使用既有 Doctor 最小适配：显式已知 ID 更新、显式未知 ID 拒绝、无 ID 才按唯一身份键匹配或分配确定性前缀 ID；不按数组位置覆盖。 |
| `World/world-engine-core.js::saveCheckpoint/restoreCheckpoint/saveStateWithLayer`（380/402/410 起） | T/X | `runContinuityTarget` 的 `continuityCheckpoint` 与世界域 `writeChatNamespace` | checkpoint 保存调用前旧态；世界字段与 world task receipt 一次原子 save，并要求一次 readback。Doctor 使用现有按聊天 namespace writer，异常由 writer 恢复内存旧态并让既有 WAL task 保持可恢复。 |
| `Story Oracle/index.js::soCallModel`（1709 起） | T | `generateWorldContinuitySingleBatch` | 复用单入口模型调用边界；不复制 Story Oracle 的剧情 arc 状态机。 |
| `Story Oracle/index.js::buildWorldInfo`（2166 起） | T | `buildContinuityMessages` 的 `scheduledBase/worldContext/stateAnchors/acceptedNarrative` | 保留“一次冻结完整上下文再生成”的做法；Doctor 额外绑定严格 accepted target。 |
| `Story Oracle/index.js::parseLorebookBlocks/applyLorebookOps/undoLorebookOps`（3001/3548/3633 起） | T | 本地解析、分类 merge、world namespace save/rollback | 复用“本地宽容解析、按稳定 uid 合并、写前 snapshot、失败恢复 snapshot”的事务形状；不复制 lorebook 写入格式。 |
| `npc_tracker/scripts/host.js` 的 `structuredClone` fallback 与按聊天宿主存储 | T | `deepClone`、现有 chat namespace writer | 仅复用聊天隔离与克隆保存边界。npc_tracker 的每人物 profile 调用仍属于 P1，不并入世界 prompt。 |
| `数据库/表格模板_无限回廊原始二创版.json` | X | 无世界写入口 | 只确认外部数据库以独立表主键和独立填表流程保存。其人物/地点/任务表结构没有硬套进 Doctor 世界状态，也没有被世界事务接管。 |

## Doctor 必需适配（参考中不存在）

| 适配 | 标记 | 原因 |
|---|---:|---|
| `sameAcceptedNarrativeTarget` + `capturedTargetKey` | X | World/Story Oracle 没有 SillyTavern 的 chat/card/generation/branch/message/swipe/accepted-content fingerprint。P3 以完整 target 作为单批身份；正文或 swipe 改变即 stale。 |
| `continuityTargetIsCurrent` 在调用前、返回后、保存前、保存后、读回后检查 | X | 防止异步期间换聊天、换 swipe 或正文改变后向旧目标宣称成功。 |
| world task receipt 与世界字段同一 namespace 事务 | X | Doctor 需要 WAL/重启恢复证据。只有世界状态读回一致且 target 仍匹配，world task 才标记 committed。 |
| `worldContinuityPersistenceOutcome` | X | 用于把世界域与人物域的 UI/返回状态分开：世界已提交而人物失败时 world 不重开；世界失败而人物保存成功时也不能宣称世界成功。 |
| `worldSovereigntyTaskAlreadyCommitted` | X | 以现有 WAL backlog 中 `module=world`、`status=committed` 和完整 `sovereigntySourceKey` 识别同一已接受正文。该 key 覆盖 chat、逻辑消息位、message、swipe、generation、generationId、generationType、branch、正文指纹和角色卡作用域摘要；任何一项变化都不得复用。 |
| 全角冒号/逗号与尾逗号本地修复 | X | World 的括号截断恢复未覆盖中文标点；这是无语义改写的轻微格式适配。语义不可恢复仍失败。 |

## 生产入口与旧到新调用映射

### 旧路径

`enqueueContinuity` → `runContinuityTarget` → P1 档案调用 → actor shard → world 预取或后置 world call → 最多两轮 world JSON/model repair，且每轮允许一次 route failover → 人物、世界、checkpoint、pressure、receipts、runtime 联合最终保存。

旧路径存在三个可重复世界生成点：

1. world agent 预取失败后，后置循环会再次调用；
2. 语义/JSON 无效会请求第二次“世界 JSON 短修复”；
3. route failover 会换槽位再次生成。

联合最终保存失败还会把已成功的世界候选回滚为未提交，恢复任务随后对同一 accepted target 重新生成。

### P3 路径

`enqueueContinuity`（P2 原队列） → 严格 `capturedTargetKey` → `runContinuityTarget` 冻结 accepted narrative/state pack → `generateWorldContinuitySingleBatch` 恰好一次（无 failover、无修复模型）→ `parseContinuityOutput` 本地提取/轻修 → `applyWorldUpdate` 按稳定 ID merge → policy/因果校验 → 世界字段 + world task receipt 一次 durable save + 一次 required readback。

人物域随后只保存 `sovereigntyRuntime/actorLedger/actor checkpoints`。世界字段不再出现在人物事务的 `cycleFields`。世界独立提交后，即使人物档案或人物结算保存失败，world task 保持 committed，返回 `status: applied`、`worldRetryRequired:false`，只保留人物域恢复状态。

人物域自动恢复再次进入同一 accepted target 时，生产入口先检查上述严格 WAL 身份。精确 world task 已 committed 时，`maxAttempts=0`、不建立 world job、不构造或合并新的世界候选、不追加 lane receipts、不生成新 checkpoint，也不再次执行 world namespace save/readback；它直接以持久 namespace 中的 continuity/worldPressure/receipts/director 为权威，只继续人物域恢复。因此该路径是 **0 次世界模型调用 + 0 次世界域写入**。不同聊天、角色卡作用域、消息、swipe、generation、branch 或正文指纹不会命中这个捷径。

## 6.1 真实故障对齐

本地诊断记录显示：

- accepted target 4：变量 1 次、档案相关 4 次、关系生成/修复 2 次、真正世界连续性 1 次。
- accepted target 6：变量 1 次、档案/生理档案 8 次、人物行动 shard 4 次、真正世界连续性 2 次，共 15 次模型调用。
- target 6 的第一次世界运输和输出成功；人物/世界联合最终事务保存失败后，恢复流程对同一 target 又调用一次世界模型。最终世界提交成功，但 6 张人物档案仍不完整。
- “恶魔旅团外围成员·疤脸/跟班A/跟班B”与“疤脸男/跟班A/跟班B”被登记为 6 个 ActorRef，是真实 P1 身份重复，放大档案调用和积压，但不是世界重算的直接原因。本阶段不越界修改 P1/P4 身份架构。

P3 对应阻断：

1. 预取无论成功、空输出还是运输失败都算本 target 已尝试，不再进入第二个 world call。
2. 本地可修复输出不产生模型调用；不可恢复输出零世界字段写入，world task 留作恢复。
3. 世界域先独立 save/readback 并终结 world task；后续人物事务失败不再回滚或重开世界。
4. 世界失败不会阻塞或回滚外部数据库、MVU 或已独立提交的 P1 档案；人物失败也不能用世界成功掩盖。
5. 同一精确 target 的 world task 已 committed 后，人物恢复不再调用或写入世界；旧记录中“人物事务失败导致同一 target 第二次世界生成”的入口被直接截断。

## 未复用与明确边界

- 未复制 World 的内部重试、API hard timeout、存储 key 或 UI；它们与 P3 的“至多一次”和现有 Doctor namespace/WAL 不兼容。
- 未复制 Story Oracle 的 arc/plan 状态机、自动世界书写入和多阶段规划；P3 不新增第二套 orchestrator。
- 未把 npc_tracker 人物 profile 或数据库表格并入世界 prompt/世界事务。
- actor action adjudication 继续维持现有接口：人物只提交尝试，世界输出可裁决世界所有权结果；更完整的人物行动生命周期留给 P4。

## 证据边界

本阶段只运行本地语法、VM/生产函数回归和非浏览器测试。没有运行真实模型、浏览器、SillyTavern、Tauri、构建、CI 或发布门禁；旧 6.1 报告仅用于故障复现映射，不是当前源码通过证据。
