# 阶段6：兼容迁移、旧路径停用与来源映射

适用版本：`2.0.0-rc.14`，聊天 namespace `v13`，人物主权迁移 `v3`

状态：阶段6实现说明；不构成真实模型、真实数据库、SillyTavern/Tauri 或正式发布证据。

## 1. 唯一生产边界

生产任务只允许沿下列顺序运行：

```text
宿主聊天/卡/世界书清单解析
  -> ensureActorSovereigntyMigrationPersisted()
  -> 完整 namespace 写入并按 payload digest + scope digest + rev 读回
  -> migration commit marker 写入并读回
  -> Observation WAL 逐条按当前聊天 strict target 证明并补入
  -> profile / actor / world 的 schedule、claim、restore
```

`readChatNamespace()` 只是兼容读取边界。它可以返回 `migrated_pending_persist` 候选供界面查看，但不得把内存规范化当成迁移提交，也不得据此消费旧任务。

## 2. 迁移与停用矩阵

| 旧数据/入口 | 历史如何保留 | 新运行资格 | 阶段6处理 |
| --- | --- | --- | --- |
| 无完整 chat/card/worldbook/runtime scope 的 namespace | 原对象进入 scope archive；已提交历史仍可读 | 无 | 活跃 task 全部 `migrationQuarantined`；checkpoint `compatibilityOnly/restorable=false` |
| 有完整、逐项相等 scope 且 task/checkpoint 自带相同 `scopeDigest` | 原位规范化并内容寻址读回 | 可恢复 | 仅在两阶段迁移提交和 marker 读回成功后开放 |
| `legacy_persisted` Profile V6 | 保留档案内容和来源 | 无 action-ready 资格 | 不补造 commitId、digest 或 readback；等待正式完整档案事务 |
| receipt 内嵌 `actionAttempt` | 提升为顶层 `actionAttempts` 历史项 | 无 settlement 资格 | 标记 `compatibilityOnly=true`、`settlementEligible=false`、`migratedFromLegacyReceipt=true`；删除内嵌副本；无效 receipt 外壳可丢弃 |
| 旧 `targetIndex` / 宽松 target checkpoint | 只读历史 | 不可恢复 | 不补造 message/swipe/generation/branch/hash |
| 旧 pending/retry/deferred task | 保留失败、重试和隔离原因 | 仅完整 scopeDigest 同值时可 claim | 缺证据或 mismatch 统一延后到最大 turn 并隔离 |
| 已 committed 历史 | 原样保留 | 不重放 | 不把历史完成重新物化为行动 |
| 规范化无法接纳的 actor/task/checkpoint/blob/receipt/未知字段 | 原始片段逐字段存入内容寻址 compatibility archive | 无 | archive 全局 `actionReady=false/settlementEligible=false/restorable=false`，重复迁移按条目摘要去重 |
| 迁移期间已接受正文 | 独立 Observation WAL（内存 + 可用的最小宿主持久层） | 仅 observation-only | 迁移成功后按 sourceKey 幂等补入；绝不补造人物或世界行动 |
| Continuity 根级 `actorProfiles` | ProfileInsertCandidate 解析器的外层包装兼容另行保留 | Continuity 无档案写权 | 从正常/修复提示、根模板和生产 ignore 分支移除；解析时显式拒绝 |

## 3. 作用域与内容证据

- chat、稳定 card ID/version、扁平去重排序后的世界书集合、世界书 manifest 和 runtime version 必须逐项相等。
- card ID 优先 `groupId`，否则使用 `characterId + avatar`；显示名不参与稳定身份。
- 世界书优先宿主明确 revision/version。缺 revision 时，对已加载 entry 的完整可序列化语义做稳定 JSON 摘要；包括匹配概率、选择逻辑、组、深度、role、sticky、cooldown、delay、大小写/全词匹配、vectorized 以及未来宿主字段。
- entry 顺序、对象键顺序和关键词集合顺序不改变摘要；同 ID 内容或语义变化、集合成员增删会改变 manifest。
- 外部书内容不可读且没有完全同 ID 集合的最后确认 manifest 时，scope 为 `unresolved`，人物/行动/世界任务保持 blocked。

## 4. Observation WAL 与收敛证明

迁移写失败不会返回 `observed:false` 丢弃正文。待持久 observation 记录完整 scope、sourceRef、sourceKey 和九字段 target。

Observation gap 只有收到 `current_chat_observation_convergence` proof 才能推进 `simulatedThrough`。proof 必须：

1. 从当前已接受聊天逐条重新捕获目标；
2. 逐项匹配 `chatId/logicalIndex/messageId/swipeId/generation/generationId/generationType/branchId/contentHash`；
3. 覆盖 metadata 记录的全部 sourceKey，且 latest sourceKey 一致；
4. 自身内容摘要正确，scopeDigest 与 runtime 完全相等。

缺 proof、正文变化、swipe/branch/generation 变化或覆盖不全都保持红色 gap。未收敛 WAL、任务和对应 observation 不受普通 240/600 历史容量裁剪；仅可压缩已终结历史。

## 5. 所有局部写入共用迁移守卫

`index.js` 现有 29 个普通 `writeChatNamespace()` 调用点全部经过同一守卫。守卫先等待当前 `chatId + scopeDigest` 的迁移 singleflight，重新读取宿主持久化的权威 namespace，再逐项验证 current marker、scopeDigest、namespace rev 和所写字段 revision。候选若来自旧 scope，或同字段已被不能归属于本次提交的并发写修改，统一拒绝并由调用者从最新状态重新规划；只有字段内容摘要（含“字段存在/不存在”位）完全相同才允许 revision rebase。

| 写入族 | 实际字段/用途 | 迁移失败时的行为 |
| --- | --- | --- |
| checkpoint restore / swipe restore | `sovereigntyRuntime`、`continuity`、`actorLedger`、`worldPressure`、`forum` 及检查点字段 | 不恢复旧 scope；保留当前权威状态 |
| Observation WAL / replay / convergence | `actorSovereigntyObservationWAL`、`sovereigntyRuntime` | 留在同 scope 会话 overlay/WAL，不能 claim 旧任务 |
| profile / Registry / attempt / receipt | `actorLedger` | 不生成 action-ready、attempt 或 settlement 成功 |
| continuity / world cycle | `continuity`、checkpoint/blob、`actorLedger`、`worldPressure`、world lane receipt、director/source receipt | 整个 cycle fail closed；不能以旧候选覆盖迁移后的新 scope |
| repair / opening resource / social / serendipity | `repairJournal`、`openingResourceSync`、`socialAudits`、`serendipity`、`worldPressure` | 仅记录同 scope 失败，不把内存兼容视图当 current |
| forum | `forum`、`forumCheckpoint` | 不把旧聊天/卡/世界书帖子写回新 scope |
| injection receipt | continuity queue/batch、`worldPressure`、`actorLedger` | 未读回不宣称正文消费或人物回执成功 |
| diagnostics / operation log | `operationLog`、`modelCallStats`、`modelDiagnostics`、custom-instruction diagnostics | 诊断写也不享有迁移旁路 |
| legacy phase6 runtime adapter | `phase6Runtime` | 只经普通守卫写；不拥有 raw 迁移能力 |
| manual clear / profile edit | 对应 continuity/forum/actor 字段 | 保存失败不向界面返回已清空/已编辑 |

底层 `enqueueChatNamespaceWrite()` 在 `index.js` 只剩 3 个源码引用：函数定义、受守卫的普通写入口、以及 `runActorSovereigntyMigrationPersisted()` 内部闭包。raw 闭包要求函数局部且不可导出的 `Symbol('actor-sovereignty-migration-write')`；只有迁移 payload 和 marker 两阶段提交能够持有该 token，因此不会递归进入 guard，也不能被其他模块调用。

迁移和普通局部写并发时，migration singleflight 只合并同一 chat + scopeDigest。后来的普通写必须基于迁移 marker 的实际读回重新构造/验证；scope 变化不会复用旧 promise。测试同时证明旧 `repairJournal`、旧 profile/ledger 和旧世界状态不能复活，而新 scope 的 forum/observation 可以在 marker 读回后保存。

## 6. World 风声衰减的独立重写

阶段1审计发现旧四组参数及 `base + linear*n + quadratic*n² - strength*10` 与未发现许可证的 World 参考实现重合。阶段6没有复制或微调该实现，而是独立改为本项目的分段耐久模型：

- 每类风声有自己的静默保护期；
- strength 提供有限的“可承受沉寂回合”缓冲；
- 缓冲耗尽后按 cadence 分段增加消散风险，段内小步递增；
- 概率上下界固定，随机函数仍可注入，以便生产随机和测试确定性共存。

保留的只有产品语义：“沉寂会衰减、强风声更耐久、随机可注入”。参数结构、数值和公式均为本项目新写。

## 7. 复用分类

| 分类 | 实际内容 |
| --- | --- |
| 原样复用 | 阶段1—5已落地的 ActorRef/Registry、ProfileInsertCandidate 原子事务、strict action target、顶层 actionAttempts journal、world adjudication 分权、现有 namespace 写队列和内容读回能力 |
| 最小适配 | 现有 runtime task/checkpoint 增加 scopeDigest、compatibility/restorable 标记；现有聊天/卡/世界书宿主读取只负责生成纯核心 manifest 输入；现有 namespace 写队列外包统一 migration guard；现有健康投影增加 migration/gap 红色诊断 |
| 本阶段新写 | 迁移 v3 两阶段证据、scope manifest、坏状态隔离和原始片段 archive、Observation WAL、严格当前聊天 convergence proof、字段 revision/digest 并发守卫、只裁剪终结历史的容量策略、独立风声分段耐久模型 |

阶段4/5文档已记录糖糖公司、Izumi、PrismFox、caikis、World 和 Story Oracle 的实际读取与许可证边界。本阶段没有复制其源码或提示词；兼容层仅围绕本项目既有公开接口独立实现。

## 8. 验证边界

阶段6测试覆盖迁移幂等、断电/写失败/读回不一致、旧版本和缺字段、跨聊天/卡/世界书/runtime scope、迟到和多人物恢复、容量、严格 observation proof、worldbook 真实内容摘要、Continuity 旧宏拒绝、风声确定性衰减，以及生产浏览器接线。

2026-08-10 当前源码的本地受控结果：

- 阶段6定向（迁移/runtime/root invariant/frontend/QC/continuity）：72/72；
- 阶段2—5人物档案、Registry、Ledger、Shard、票据和世界裁决核心：125/125；
- 全部非浏览器测试：59 个文件，429/429；
- 纯本地 headless 浏览器完整链：1/1，185.36 秒；
- 关键模块 `node --check`：13/13；仓库可见 JSON 用 Node 实际解析：93/93；`git diff --check` 通过。

旧 `qc-evidence-integrity` 的源码变量名/正则形状断言已替换成 panel、floating orb、diagnostics、public API 共用语义投影的行为取证，本轮完整非浏览器回归为零失败。

本阶段不运行真实外部模型、真实数据库、真实 SillyTavern/Tauri、构建、CI 或正式发布门；这些属于阶段7及正式发布流程。
