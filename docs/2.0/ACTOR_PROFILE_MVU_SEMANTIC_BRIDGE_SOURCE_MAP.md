# 人物档案语义前移与 MVU 权威接线来源映射

适用版本：`2.0.0-rc.34` 测试仓候选。rc.33 真实第2个 accepted 回复证明隐藏语义块已生成、P3 已 durable commit，但语义 P1 在保存失败人物恢复目标时访问未导入的 `actorProfileRecoverySourceDigest`，外层调度记录错误后留下 busy/waiting。rc.34 直接导出并导入成熟 V6 recovery digest helper，并让恢复持久化/终态诊断的意外异常收口为红色 `not_completed`；人物/accepted-final 定向检查 113/113 与唯一一次完整套件 668/668 通过。当前指纹十二回合门禁待执行；rc.33 真实结果仅为故障证据，不能续接当前候选。

## 生产链

1. 生成前继续复用现有 `characterCreationTicket` 和稳定 ActorId。P4 的唯一 next-turn consumer 同时承载本回合票据、上一回合世界事件/可见后果及最多六个相关 durable-ready MVU 档案摘要；不发送全部历史档案。票据载荷把每个实际消费的完整 ticketId 就近绑定到同一 accepted assistant 的隐藏六段回执；未消费任何票据且没有既有人物变化时也必须交回 `<!-- 人物档案无变化 -->`。
2. 配套预设 `dist/01_主预设_人物万花筒_可调篇幅_IZUMI0814作者更新_ARGO1.3最小融合候选版.json` 与 `npcDesignTicketPrompt()` 使用同一顺序：唯一 `<content>` 内先完成空的 `<luntan></luntan>`，闭合 `</content>`，随后恰好一个隐藏人物档案/无变化收据，再继续 options/UpdateVariable/其他辅助域。V6 上下文隔离条目在 `prompt_order` 中唯一启用且早于人物语义块，V5 回执终检仍为最后一项；只存在于 `prompts` 而未排序的对象不算生产接线。V4 已停用；V5/V6 不再声明“回执后再继续论坛”。新人物给齐六段 V6 自然叙事档案，`full_adult` 六个 physiology field 缺一不可。
3. accepted-final 适配器只读取当前最终 assistant 的精确 SourceRef；聊天、message、swipe、generation、content、scope 或 epoch 漂移均零写入。格式先本地宽容修复，再按 ticket/ActorId 逐人物绑定和隔离。解析器优先接受严格 whitespace-only post-content 插槽，也兼容旧聊天 true-EOF legacy tail；rc.27 额外把“唯一专用注释结束后只剩空白并立即 `</content>`”识别为可恢复 inner-tail 并本地 relocation。注释后继续正文、重复块、论坛/选项内伪块和语义校验失败仍 fail-closed。预留 ticket 只是可选池，不等于已消费；完整专用块和无变化收据都缺失时记录 `profile_block_missing + emptyOperations + repairable`，绝不伪装成功。无精确票据的旧聊天仍保留省略兼容。
4. 编译器在 working clone 上形成 `/人物档案/byActorId/<ActorId>` 操作，复用既有 MVU WAL、selected-field CAS、持久写、readback 与 touched-path rollback。第一次回读证明内容落地，第二次本地写入 ready 收据；最终操作合并回原消息 UpdateVariable，保留主回复原有变量操作。
5. ActorRegistry 仍是唯一 ActorId/name/aliases 索引。ActorLedger 只保存 profileRef、digest、revision、readiness、ActionAttempt/receipt 和世界字段；完整档案只在 MVU，不再双写稳定/演化副本。
6. P3 与人物档案事务独立启动，冻结启动时已经 durable-ready 的人物集合。缺档人物不参与该批人物行动，结构世界、其他 ready 人物和支线仍继续；人物尝试必须由世界单批裁决。accepted-final 只在 active P4 consumer 明确携带同 generation 的 `worldPackage` 时等待其清理；ticket-only consumer 即使仍 pending 也不阻断 P3。P1 的 idempotent wake 先原样 join 已有 P3，绝不在 pending owner 链内递归重开；semantic `no_candidates` 会把同一 exact-source coverage proof 作为结构世界准入证明，`not_completed` 不提供人物准入但也不阻断结构世界。所有模型前 stale 都携带 `module=world + zeroWrite=true + worldModelCalls=0` 和固定隐私码；无论初始 owner 在 P1 检查时仍 pending，还是已在前几个微任务中释放，只有第一次唤醒结果满足该证明、不是前台抢占，且重新 fresh-read 后仍是同一 accepted envelope，P1 才取得一次新 owner。已完成世界只返回 duplicate；任何已调用模型、正文/swipe/generation/scope/epoch 漂移都保持零自动重跑。
7. P4 仍只有一个 Doctor-owned exact-once 插槽，注入验证过的世界包、相关 ready 人物摘要和本回合票据。数据库仍只从最终正文独立填表，不参与档案事务、P3 或 P4 收据。
8. 原 Doctor 悬浮面板“人物档案”页从当前楼层 MVU durable 投影 hydrate：默认全折叠、单人展开、列表有界滚动；六段内容分成稳定档案与长期演化，故障分色优先于 busy。即使故障发生在 Actor 绑定前、当前没有卡片，持久 retry receipt 仍会把顶部摘要和空状态显示为红色。折叠偏好只进浏览器 localStorage，不进 MVU 或 Doctor 持久账本。

## T / A / X

### T：直接复用

- `characterCreationTicket` 发行、同票绑定、ActorRef/ActorRegistry 与生成生命周期。
- accepted-final 的 message/swipe/generation/content/scope/epoch 身份和 `GENERATION_ENDED` 后最终读取路径。
- MVU `commitCandidateUnlocked` 的 WAL、selected-field CAS、持久 readback、touched-path rollback 与消息保存入口。
- P3 本地 Recall、ready-only 人物调度、ActionAttempt/WorldAdjudication 分权和结构世界独立推进。
- P4 单一 next-turn consumer、lease、consume proof 和清理语义。
- Doctor repair center 的固定隐私安全码、刷新后终态诊断和按模块人工修复入口。

### A：最小适配

- TavernDB 成熟填表结构只复用“有界目标、working clone、整批提交、回读失败不算成功”的事务形状；没有复制其表格、SQL 或内容权威。
- 糖糖公司成熟多轴人物差异继续由同一 ticket 提供；最新版 Izumi/ARGO 融合预设增加正文后第一隐藏语义域，并只把原“你感到”模板最小修正为客观感官表达与明确的玩家主观感受禁写，不改写作者提示词主结构。终检 V5 只增加最终顺序适配层，明确覆盖旧 options 合同的漏项；未改第三方核心结构、未新建提示词通道。
- 既有 `profileV6` 自然叙事六段和锁/人工覆盖规范作为 MVU schema 内容形状；ActorLedger 改为单向 reference-only 投影。
- 既有 P3/P4 注入只增加 MVU readback 摘要投影，不新增并行世界状态机或第二插槽。

### X：必要新写

- `actor-profile-mvu-core.mjs` 的专用 post-content/legacy-tail 块解析、逐人物 quarantine、完整 ticket reservation 校验、锁门、单一档案根编译、消息补丁合并和 runtime fingerprint。旧生产链没有“正文模型语义 → MVU 档案”的适配器。
- accepted-final 两阶段 MVU readback 收据与无前端中间写。原因是直接复用普通变量提交会提前覆盖主回复 UpdateVariable，并使第二次精确目标回读失效。
- 单人物 AI 定向补缺。原因是旧 P1 会重新识别/生成整批人物，不满足“只修坏人物、不重跑正文和好人物”的边界。
- 显式旧 profileV6 → MVU 逐 Actor 迁移按钮。原因是自动破坏性迁移和双向维护都不允许。
- `v2/surface/actor-profile-view.mjs` 的 MVU 投影、状态优先级、紧凑 accordion 与脱敏诊断。旧页面只读取 profileV6，且六段长文会平铺，不能满足当前唯一权威和多人物可读性要求。
- P3 模型前 stale 的统一 fixed-code 零写收据与 fresh exact-target 单次接棒。旧分支只有泛 `world.stale`，无法区分可安全接棒的零调用竞态与真实失败。
- 生成前票据的逐票隐藏档案回执及其 runtime fingerprint。rc.20 真实证据证明通用预设合同在长上下文中可能与具体已消费票据脱节；新合同只闭合既有同一载荷，不引入第二识别器或第二档案权威。
- 严格 post-content/legacy-tail 位置判定、票据回合缺失回执 fail-closed、P3 settled-before-wake 单次接棒和 `worldPackage` 屏障判定。rc.21 证明“完全省略等于成功”会掩盖主模型漏交；rc.22 又证明严格尾部会被大型辅助域截断，ticket-only P4 不能代表必须阻塞 P3 的世界包。旧路径没有这些本地证明。
- P3 空/旧 ActorRegistry 的 scoped comparison projection。rc.24 真实新聊天证明：没有任何人物时 Registry 尚未持久化 scopeDigest，直接拿它与已验证 scope 比较会把稳定空账本永久误报成 `actor_ledger_changed`；rc.25 只在只读比较投影中补齐该 scope，真实 chat/scope 冲突仍 fail-closed。
- accepted-final 后宿主机制尾规范化的静稳地板。rc.25 真实 swipe 7 证明：人物块和 accepted 正文不变时，宿主仍会重写 MVU/辅助尾，使“整条消息哈希”不是可直接写入的稳定 floor。rc.26 等待 accepted content、专用人物块和精确 MVU 基线连续稳定，再把规范化后的同一 SourceRef 交给既有事务；人物块、正文、swipe、generation、scope 或 epoch 变化仍 fail-closed。
- fresh-chat 机械时钟 safe-held 适配。`turn 0 → nextTurn 1` 本身不是世界语义进展；rc.26 仅在线程/world/scenario 无变化、所有 ATT 已裁决或不存在时把 turn 降回基线并写可验证 held 收据，绝不制造人物行动结果。
- 当前 accepted assistant 的唯一 inner-tail 人物回执本地 relocation。rc.26 真实 swipe 19 证明模型可能遵守“隐藏且紧邻正文末尾”却把注释放在 `</content>` 内侧；rc.27 只接受注释后没有任何正文、紧接容器关闭的形状，并继续用完整解析、ticket/ActorId、六段、SourceRef 与 MVU readback 门阻止数据库/世界书相似标记取得权威。
- 成功终态与前端故障摘要的双重收口。rc.27 真实第二个 accepted 回复证明 `atomic_readback` 后若曾保存恢复材料，旧语义适配器仍可能留下 `canRetry`，使绿色 durable 卡片与红色顶部摘要冲突。rc.28 在生产适配器清除此成功态标志，并在纯视图层拒绝把成功状态的过期 `canRetry` 当故障；真实 `not_completed/failed` 仍保持红色和单人物修复入口。
- `full_adult` 仍直接复用 `actor-profile-v6-core.mjs` 的六项生理覆盖合同与本地规范化器；语义桥只做最小接线。生成前票据提示与配套预设写自然中文语义，本地编译器传入当前完成模式、生成合同版本并把 physiology 纳入 ready/readback；前端只展示通过本地合同版本的自然段，空 legacy 模块和布尔开关绝不充数。AI 只在真实缺项时由已有单人物 repair adapter 定向补该人物，之后仍使用同一 MVU 事务。

## rc.29 至 rc.34 A/B/C/D production map

| Contract | Production path and owner | T/A/X decision |
| --- | --- | --- |
| A context isolation | `prompt-context-core.mjs` (`sanitizeOutgoingChatCopy`, `sanitizeFlatPromptByExactAssistantSource`, `inspectFlatPromptAfterAssistantChatSanitized`, `selectBoundedRelevantActorIds`) plus `bindEvents()` in `index.js`; Doctor reads the raw accepted assistant, while the host receives only an outgoing copy. | T reuses the mature prompt-ready event boundary and existing mechanism sanitizer. A adds exact assistant-role/source ownership, multimodal text normalization, residual fail-closed checks and bounded projection. X is the semantic receipt parser because no prior path owned this accepted-final domain. Display regexes never substitute for prompt filtering. |
| B chat disposal/GC | `doctor-chat-scope-core.mjs` plans exact Doctor-owned keys; `disposeDoctorChatScope()` in `index.js` performs epoch invalidation, owner-scoped task/UI/repair cleanup and exact hashed localStorage cleanup. It does not perform durable readback or write MVU/chat namespace. | T reuses the existing namespace/write-chain and repair-center lifecycle. A adds precise owner records, preview/confirm cleanup and host `CHAT_DELETED(chat_file_name)` glue. X is the safe non-current Doctor cache preview because no authoritative host chat-ID enumeration was available; it is not proof that a chat is orphaned. No database, MVU, chatMetadata, IndexedDB, external file or third-party settings are touched. |
| C three world lanes | `scheduleWorldLanes`, `classifyWorldPressureCandidate`, `admitDoctorWorldCandidates`, `stage3StructuralLaneRowSafe`, `stage3PositiveStructuralWorldDelta`, `stage3IsolateHeldActorWorldDelta`, `compressResolvedContinuityHistory` in `continuity-core.mjs`/`index.js`; one CAS/readback batch owns actor, faction and environment receipts. | T reuses the mature single-batch scheduler, held fallback, continuity CAS/readback and undo/checkpoint path. A adds lane-keyed positive provenance admission, pressure budgeting, actor-dependent delta isolation and newly-resolved-only compaction. X is only the missing structural admission/compaction adapter; it does not create a second world model or state machine. |
| D operational state | `composeActorOperationalState`, `operationalActorEligible`, `actorOperationalPromptProjection` in `actor-operational-state-core.mjs`, consumed by `scheduleActorTurns`, P3 recall and P4 summary. MVU runtime is read only through configured ActorId JSON-Pointer rules. | T reuses ActorLedger action receipts/history and the MVU current-state authority. A adds the bounded ephemeral projection, attemptId-aware pending gate and explicit `unbound` diagnostics. X is the configurable runtime adapter because the controlled host supplied no universal character-card runtime schema; no Doctor-owned location/resource mirror is written. |

Projection recovery is also part of the rc.29 through rc.34 transaction path: `recoverSemanticProfileRegistryProjection()` derives a new or existing Registry candidate from the exact receipt SourceRef, stable ActorId, MVU natural identity, local readback metadata and committed profile digest. It may replace an old ledger `profileRef`; it does not require the ref to match before recovery. It removes only recovered `registry_projection_pending:*` codes and preserves same-batch `failedActorTargets`/ticket owners. Any digest, source, identity or save/readback mismatch remains repairable and zero-write where rollback is verified. rc.34 的 `actorProfileRecoverySourceDigest` 仍由 `actor-profile-v6-core.mjs` 单点实现；`index.js` 只导入复用，不另造摘要算法。

The current exact paired preset is the IZUMI file named above; its candidate SHA-256 is recorded in `TESTING_CHANNEL.md` and bound into `doctorRuntimeCriticalFingerprint()`. Historical rc.27 through rc.33 observations and suites do not substitute for rc.34 current-fingerprint evidence.

## 不变量与失败语义

- 新人物六段完整且一次提交；已有角色仅 delta；坏人物不能留下半档案，也不能拖垮其他人物或结构世界。
- 模型不拥有 revision/version/status/digest/SourceRef/readback/MVU path/JSONPatch。中文业务“状态、版本、摘要”只有在形状和值明确属于技术控制面时才拒绝。
- `emptyOperations`、partial、unverified 和 readback mismatch 都不算完整成功。partial 中已读回的好人物可 ready，坏人物保持 repairable。
- 初次解析、绑定、完整性、持久化、readback、消息 replay、Registry projection 和旧迁移失败均使用固定码；诊断不保存姓名、正文、模型原文或凭据。
- 旧 verified profileV6 可只读；显式迁移失败保留旧副本。成功后 MVU 是权威，旧副本只作兼容备份；来源路径设置可显式回滚。

## Storage inventory and retention boundary

| Storage | Doctor ownership | Delete/GC boundary |
| --- | --- | --- |
| `chatMetadata[mvu_auto_doctor]` | Host chat metadata and Doctor durable namespace | Follows host chat deletion; Doctor does not clear it during disposal and never deletes MVU or database data. |
| Per-chat hashed fold `localStorage` keys | Doctor-owned UI fold/temporary cache | Exact key only on matching `CHAT_DELETED`; manual non-current cleanup is preview/confirmation and is not proof that a chat is deleted. |
| Global floating page/position and extension settings | User/extension preference, not per-chat Doctor ownership | Never removed by chat disposal or non-current cache cleanup. |
| Doctor memory maps, queues, timers, controllers, P4 leases, repair/UI owners | Doctor-owned with exact `chatId`/scope owner | Matching scope is invalidated and removed; late callbacks fail their owner/epoch guard. |
| IndexedDB and external files | No Doctor-owned namespace found in this candidate (0 items) | No guessing, enumeration-based deletion, or cleanup. |

Diagnostics and repairJournal keep bounded fixed-code projections; checkpoints
keep bounded undo/readback records. Newly resolved detail is compacted on the
transition and older detail rolls into a bounded effects/rumors/triggers/source
tombstone rollup. Active and dormant threads are not display-truncated, and
the rollup prevents a resolved event from being reopened after its individual
ID leaves the bounded list.

## 非验收说明

rc.27 的提交、loaded hash 与 runtime fingerprint 均匹配，并在真实第二个 accepted 回复完成一张六段基础 MVU 档案；真实取证随后证明其 `full_adult` 生理内容未完成，绿色无效，同时顶部摘要被过期 `canRetry` 染红。rc.28 的自动检查只能证明代码回归，不能替代新 loaded fingerprint 在同一接受正文上的单人物恢复、durable readback、刷新 hydrate 与后续单聊天十二个有效回复。正式仓与正式 main 仍须等待完整协议。
