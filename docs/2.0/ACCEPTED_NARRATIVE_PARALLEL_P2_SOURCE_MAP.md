# P2 接受正文并行启动来源映射

## 范围

本文件只覆盖 P2 的时序修复：最终 assistant 回复经本地规划泄漏清理后，Doctor 从同一份 accepted narrative 快照独立启动世界连续性；变量医生继续拥有自己的 MVU busy/指纹稳定等待、修复、写回和终态 settlement。本文不改变世界算法、人物行动/裁决、提示词、持久化格式、诊断 UI、数据库表格或预设。

- **A（可辨认改名）**：数据库作者已有事件链中的一个可辨认节点或调用边，在 Doctor 中只更换宿主事件名、任务名或快照适配名。
- **T（忠实翻译）**：保留作者实现的职责分离和时序含义，但把“表格填表”翻译成“Doctor 世界连续性”。
- **X（Doctor 必要胶水）**：数据库作者没有、而 Doctor 为 observation WAL、注入回执、完整目标身份、stale 零写入和现有 continuity 队列必须增加的薄适配。

普通 `Promise.then`、`Promise.all`、历史 bug、旧报告、既有通用队列和既有屏障实现不计为 A/T/X 成熟复用。

## 已完整读取的成熟来源与验收合同

| 来源 | 实际读取范围 | 采用的合同 |
|---|---|---|
| 数据库作者固定源码 `tauritavern-system-knowledge-archive/checkpoints/2026-07-23_database-history-v4/database-patches-v4/shujuku-spv8.4-index.test-fixture.js` | `GENERATION_ENDED` 注册与过滤、`handleNewMessageDebounced_ACU`、`evaluateNewMessageAction_ACU`、`triggerAutomaticUpdateIfNeeded_ACU`、`buildAutoUpdatePlan_ACU` | 最终 assistant 事件到达后，由数据库自己的 listener 重新读取当前聊天、确认最新消息为 AI 回复、从该聊天快照独立创建填表计划。它不通过 Auto Doctor 变量任务启动，也不要求 Doctor 调用 CRUD。该固定源码的实际事件名是 `GENERATION_ENDED`，不是 `MESSAGE_RECEIVED`；P2 复用的是“最终回复事件 → 当前 assistant 快照 → 独立任务所有权”的时序，而不是伪造同名 API。 |
| `docs/2.0/RELEASE_CHECKLIST.md` | 产品边界、医生闭环 | 数据库独立读取 `<content>`；Doctor 不读表、不等待数据库、不调用第三方 CRUD；论坛/连续性/人物等后台功能不阻塞正文、数据库或关键变量结算。 |
| `docs/REAL_ENV_QC.md` | 5C、5C.1、5C.2 | 变量 `repairing/state-committing` 只约束 Doctor 变量写和显式 opt-in settled reader；数据库与 continuity 可独立读同一 accepted `<content>`，不等待或修改变量任务；第三方数据库保持 black-box/unmanaged。 |
| `docs/2.0/REAL_REPLAY_ACCEPTANCE_MATRIX.md` | `RR-REPAIR-DB-BARRIER` 与激活规则 | 历史抢跑只证明“未接受正文不可消费”；它不是“accepted narrative 必须等 MVU 变量稳定”的新架构。P2 保留泄漏清理、accepted content 截取和本地 observation 持久化这些正文接受边界。 |

## 数据库作者实际事件链

1. `GENERATION_ENDED` listener 过滤 quiet/background generation 后调用 `handleNewMessageDebounced_ACU('GENERATION_ENDED')`。
2. 防抖回调重新执行 `loadAllChatMessages_ACU()`，再读取 `getChatArray_ACU()` 的当前快照。
3. `evaluateNewMessageAction_ACU` 要求当前最后一条消息存在、不是用户消息，并属于当前角色；然后决定 `update_only` 或作者自己的正文优化模式。
4. `triggerAutomaticUpdateIfNeeded_ACU` 从当前 live chat 计算 AI 楼层与各表格独立更新计划，再由数据库自己的执行器填表。
5. 这一链的事件、快照、去重、模型、失败和表格持久化均归数据库自己所有。Doctor 没有包裹它、等待它、调用它或把它接入 Doctor settlement。

## A/T/X 逐项映射

| 分类 | 数据库作者节点 | P2 生产节点 | 保留与适配边界 |
|---|---|---|---|
| A | `GENERATION_ENDED → handleNewMessageDebounced_ACU` | `MESSAGE_RECEIVED → sanitizePlanningLeakOnReceivedMessage → captureTarget` | 宿主事件名和本地清理步骤不同，但都是在最终 assistant 回复可读后建立本轮消费入口。P2 不复制作者的防抖、UI 或表格逻辑。 |
| A | `evaluateNewMessageAction_ACU` 的 latest AI message 校验 | `latestAiMessage / captureTarget / sovereigntyNarrativeEligible` | 把“最新 AI 回复可填表”可辨认改名为“当前 chat/message/swipe/generation/branch 的 accepted narrative 可观察”。 |
| A | `triggerAutomaticUpdateIfNeeded_ACU` 自己启动数据库更新 | observation 与两类本地 injection receipt 完成，且现有 settlement 重复短路、全新 settlement record 建立后，调用既有 `enqueueContinuity` | 只复用“消费者自己启动”的调用边；`enqueueContinuity` 的队列算法与 captured barrier 都是 Doctor 既有基线，不冒充数据库来源。全新记录会启动 captured 状态持久化，但 continuity 不等待 `record.ready`。 |
| T | `loadAllChatMessages_ACU → getChatArray_ACU` 后才决定填表内容 | 规划泄漏清理后重新 `getContext()`，以当时 `captured.contentFingerprint = acceptedContentFingerprint(message.mes)` 绑定快照 | 忠实保留“事件参数不是内容权威，当前最终 assistant 快照才是消费输入”。 |
| T | 数据库更新不从另一个插件的变量任务派生 | continuity 不再从 `waitAutomaticTargetSettled/stateCommitting` 派生 | 数据库与世界仍各自失败、各自持久化；变量失败不取消已启动世界，世界失败不阻断变量医生。 |
| T | 数据库自己的 in-flight/楼层历史控制重复填表 | 同一目标先复用现有 settlement 同步短路与持久终态恢复，再进入现有 continuity pending/completed 去重 | 保留独立消费者自己拥有幂等性的原则；没有建立跨插件“数据库屏障”。 |
| X | 无 Doctor observation WAL 对应物 | `observeSovereigntyTarget(captured)` durable 成功后才允许世界启动 | 防止 API 故障或刷新让已接受回复从 Doctor backlog 消失；失败时世界隔离，但变量继续。 |
| X | 无 Doctor 注入消费回执对应物 | `settleContinuityInjectionReceipts` 与 `settleActorLedgerInjectionReceipts` 完成本地结算后启动 | 仅结算 Doctor 已有 receipt；没有新增 receipt、队列或状态机。 |
| X | 数据库作者不使用 Actor/world 完整目标身份 | `sameAcceptedNarrativeTarget` 要求 chat/index/message/swipe/epoch/generation/branch/acceptedContentFingerprint 一致 | `UpdateVariable` 或 `StatusPlaceholder` 改变整条消息指纹但不改变 accepted content 时仍视为同目标；accepted content 真变化、chat/swipe/generation/branch 变化均 stale，旧世界任务零写入。 |
| X | 数据库作者没有 Doctor 的 reload settlement | `existingTargetSettlementRecord` 与 `createTargetSettlementRecord(...).recoveredTerminal` 在 world 启动前短路 | 覆盖重复 `MESSAGE_RECEIVED`、pending/terminal settlement，以及聊天重载后内存 continuity key 清空的情况；不增加第二类 receipt。 |

## 旧时序与新时序

旧时序：

```text
MESSAGE_RECEIVED
→ 泄漏清理
→ accepted target
→ observation WAL
→ 两类 injection receipt
→ target barrier ready
→ waitAutomaticTargetSettled
   → MVU busy flag 释放
   → accepted content + MVU fingerprint 安静窗口
→ state-committing
├─ 变量医生
└─ continuity
```

新时序：

```text
MESSAGE_RECEIVED
→ 泄漏清理
→ accepted target
→ observation WAL
→ 两类 injection receipt
→ 既有 pending/terminal settlement 去重
→ createTargetSettlementRecord
   → 检查已持久 terminal；全新目标建立 record 并启动 captured 持久化
├─ continuity（不等待 record.ready，进入既有 enqueueContinuity）
└─ barrierRecord.ready
   → waitAutomaticTargetSettled
      → MVU busy/指纹稳定等待
      → state-committing
         → 变量医生修复、写回、opening sync、final settlement
```

实际减少的是 continuity 原先继承的整段 `barrierRecord.ready → waitAutomaticTargetSettled → stateCommitting` 等待：全新 captured 持久化可与 world 并行，world 也不再等待 MVU busy flag 释放、MVU 指纹安静窗口、变量 enqueue/repair/writeback 与其后续提交链。这里没有删除 captured barrier；`createTargetSettlementRecord` 仍建立记录并启动 `record.ready` 持久化，变量分支仍等待它。崩溃恢复依靠已经先成功持久化的 observation WAL，以及现有 continuity checkpoint/queue 幂等与 stale 零写入；受控测试不把尚未完成的 captured barrier 写入夸大为 durable。数据库不进入任何一边。

## 动态回归边界

`tests/accepted-narrative-parallel-p2.test.mjs` 使用合成文本和窄 Promise 依赖回放，覆盖：

- 全新 settlement record 已建立、captured barrier 持久化仍 pending，且 MVU busy/变量稳定 promise 未解决时，world 已启动；
- 正常 world 与变量修复并行，任一失败不取消或阻塞另一边；
- 两类本地 receipt 完成前 world 不启动；
- 已有 pending settlement 与已持久 terminal 会在 world 启动前短路；全新 captured barrier 的持久化不会重新成为 world 前置；
- pending settlement、持久 terminal settlement/reload 在 world 启动前短路；
- 同目标事件风暴只进入一次既有 world queue；
- chat/message/swipe/generation/branch/epoch 或 accepted content 变化时 world 零写入；
- 只改 `UpdateVariable/StatusPlaceholder` 时 accepted fingerprint 不变、不会被误判成新正文；
- Doctor 的 `MESSAGE_RECEIVED` 块不调用、包装或等待数据库入口。

这些是非浏览器、非宿主、非外部模型的受控回归；不能代替真实 TavernDB、SillyTavern/Tauri、浏览器、构建或正式发布门禁。

受控证据只把“同一进程内已有 pending settlement”和“重载后已持久 terminal settlement”证明为 world 启动前短路。若宿主恰在全新 captured barrier 尚未持久化、world 又尚未形成终态的窄窗口崩溃，P2 不声称进程级 exactly-once；恢复仍由先前 durable observation、现有 orphan/backlog 恢复与 continuity 事务幂等负责，允许恢复性重执行，但必须保持 stale/重复结果零写入。P2 没有为这个窗口增加第二种 receipt、队列或等待屏障。
