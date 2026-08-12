# 阶段一最终接受正文入口来源映射

## 当前边界

阶段一只调整医生的运行入口与模块所有权。SillyTavern 的真实最终 assistant 回复被接受后，变量、开局资源、人物关系、论坛、人物与世界模块分别启动；入口不等待、汇总或声明整链成功。旧人物动机、连续性与偶发事件预生成注入暂时停用，不在本阶段迁移或重建。

## 精确来源合同

| 来源文件 / 函数 / 事件 | 复用分类 | 当前生产合同 |
|---|---|---|
| SillyTavern `script.js` 的 `Generate`、工具递归、`showStopButton / hideStopButton` 与 `GENERATION_STARTED / GENERATION_STOPPED / GENERATION_ENDED`；医生 `bindEvents` | 最小适配 | 宿主工具递归会产生多个 STARTED，但可见停止按钮只在一次可见→隐藏转换时产生一个 ENDED，因此不做虚假的逐层配对。医生只保留一个 active session、一个 epoch 标量和一个 500ms timer：根 STARTED 冻结类型与正文基线；活动期间后续 STARTED 只标记嵌套，不升级不合格根；唯一 ENDED 原子取走并清空 session，timer 只持冻结 session；STOPPED 终止。只接受 normal/regenerate/swipe/continue，拒绝 dry/quiet/impersonate/未知生成；`automatic_trigger` 最终仍由 live assistant 事实裁定。 |
| 数据库作者固定源码 `tauritavern-system-knowledge-archive/checkpoints/2026-07-23_database-history-v4/database-patches-v4/shujuku-spv8.4-index.test-fixture.js` 中 `GENERATION_ENDED → handleNewMessageDebounced_ACU → loadAllChatMessages_ACU → getChatArray_ACU → evaluateNewMessageAction_ACU` | 忠实翻译 | 事件参数不是正文权威；延迟后重新读取当前 chat 的真正末项，要求非 system assistant 且正文存在，再以正文变化决定是否启动独立消费者。医生不复制数据库表格、模型、持久化或防抖实现。 |
| 医生 `currentFinalAssistant / mechanismFreeAcceptedContent / sovereigntyNarrativeEligible / acceptedContentFingerprint` | 必要薄胶水 | 纯 StatusPlaceHolder、UpdateVariable、JSONPatch、options、branches 或标签没有叙事正文时，在任何 scope 解析、身份保存、busy 或模块分发前短路；闭合块与从开始标签悬空到正文尾都只读剥离，不把结果写回正文，也不改变 MVU 标签解析。相对根 STARTED 正文指纹未变化的同内容 regenerate/swipe 零触发。 |
| 医生 `captureTarget / capturedTargetKey` 与各模块原有 pending/completed 集合 | 最小适配 | 上游只传 chat/message/swipe/generation 目标。变量立即独立分发；其他 scoped 模块在该次 accepted-final 中共享一次 lazy scope 解析，并把 frozen scope、scope digest 与 identity scope 固化到模块目标和各自幂等键。没有共享总任务、任务池、成功屏障或第二持久层。 |
| 医生公开 `registerBarrierProtocolClient / getBarrierProtocolStatus / waitForTargetSettled / runAfterTargetSettled / acknowledgeBarrierReceipt` 与 ready 事件 | 兼容保留 | 公开签名统一立即返回 `unmanaged / independent_modules_no_global_settlement`；不注册、不 reader、不等待、不读取旧 receipt，也不宣称 cooperative。内部 `currentDownstreamBarrierProtocol`、`phase6Runtime` 与人物/世界真实事务收据不改成 stub。 |
| 医生 `resolveCurrentActorSovereigntyScope / ensureActorSovereigntyMigrationPersisted / writeChatNamespace` | 最小适配 | scope 使用 `{chatId, cardId, worldbookSelectorKeys, runtimeVersion}`。selector 只接受宿主真实 string 选择键；内容、摘要、更新时间、revision、hash、manifestDigest 与 embedded worldbook 内容不参与。写前 fresh resolve 与 frozen digest 不同即 stale，零 reread/archive/write；聊天加载、切换和 initialize 不运行迁移或保存。 |
| 医生 `writeRepairJournal` → 既有 `enqueueChatNamespaceWrite / performChatNamespaceWrite` | 新写白名单薄包装，底层原样复用 | 变量 `repairJournal` 独立于 actor scope migration，只允许写 chat-level `repairJournal`，继续复用既有 fieldRevisions、串行 durable save、readback 与失败回滚，不建立第二存储。selector 迁移保留 active top-level 原始 journal；prepared 未持久并回读即零 MVU，MVU 已验证后标记失败只留恢复诊断。 |
| `ActorRegistry.scopeDigest`、ledger `sourceRef.scopeDigest`、`actorActionTarget.scopeDigest` 与 observation/checkpoint/WAL | 最小适配 | accepted-final 事务以 frozen canonical digest 贯穿注册、来源去重、人物尝试、世界裁决和读回。旧缺 digest 数据只读兼容且不能取得 current readiness/settlement；非空 digest 不匹配 fail-closed，缺失 digest 只能在外层 scope fresh 相同的 accepted-final scoped 事务补入，actorId 不变。 |
| 医生 `enqueue / enqueueOpeningResourceSync / runSocialAuditTarget / enqueueContinuity / enqueueForum` | 原样复用各模块所有权，补最小终态清理 | 各模块保留自己的结果和手动重试边界，彼此不等待。模块一旦结束，stale/disabled/duplicate/cancel 为中性，failed 为红色，所有路径都退出 busy。诊断蓝色只来自真实 pending/controller/running。 |

## 阶段依赖

`applySocialInjection`、`applyContinuityInjection`、`registerSerendipityInjection` 及其旧提示词和持久历史保留，但阶段一没有生产事件调用它们。相关设置只读保留并禁用，等待批准的后续阶段经唯一提示词入口重接。

正文硬合同、格式检查与规划前缀清洗已从生产事件、设置、界面、提示词、诊断和公开状态退出。MVU `UpdateVariable`、JSONPatch、变量写入、数据库独立填表与人物/世界真实结算不属于该删除面。

## 验证边界

本阶段只进行静态源码与差异审查。没有运行单测、语法/JSON检查、真实 API、宿主、浏览器、构建、CI 或发布验证；本文不声称功能通过、可发布或可更新。
