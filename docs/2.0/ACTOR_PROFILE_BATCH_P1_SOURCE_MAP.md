# P1 多人物票据与批量完整档案来源映射

## 范围与分类

本文件只覆盖 P1：同一回合的匿名生成前票池、接受正文后的同票绑定、已注册 ActorRef 的一次批量完整档案、本地修复、一次原子保存与一次回读。它不覆盖正文稳定门、世界裁决、人物行动、WAL/迁移、诊断收口、构建或发布。

- **A（可辨认骨架改名）**：保留成熟函数的扫描循环、深度状态与逐段切分边界，只替换输入和名称。
- **T（忠实翻译）**：保持成熟实现的阶段顺序、失败隔离、重试所有权、工作克隆和单次保存边界，但把 SQL/表行或插件状态翻译为 ActorRef/ProfileInsertCandidate/ledger。
- **X（Doctor 薄胶水）**：成熟参考没有 SillyTavern 目标、ActorRef、生成票据容量、namespace 回读或诊断接线时才补写。
- **保留的项目基线接口**：当前项目已有的票池、`ProfileInsertCandidate`、本地 repair/validate/materialize、digest/commit/readback。它们不是成熟参考的 A，也不进入 A/T 复用计数。

历史 bug、旧报告和私人预设只作为职责或回归证据，不作为设计来源；私人预设的路径、内容和样本没有写入本文件或生产提示。

## 已完整读取的成熟来源

| 来源 | 实际读取范围 | P1 采用的合同 |
|---|---|---|
| caikis `数据库模板-super自定义7.12总版-caikis.json`（SHA-256 `219e60…9742`） | `first_npc`、`second_npc`、`tracking_character_sheet`、`tracking_character_dynamic` 的 NOTE/INIT/INSERT/UPDATE/DELETE/DDL | 同轮允许多行 INSERT；每个人物一次生成完整行；正文缺项合理补全；既有事实优先；先候选后晋升。数据库仍独立填自己的表，Doctor 不写数据库。 |
| npc_tracker 固定源码 `51562dd3310114f7b7893b93e3c3b67a3fd2e05b` | `scripts/profile.js`、`gate.js`、`api.js`、`state.js` 全文件 | 一次 gate；人物结果互相隔离；收集结果后串行 apply；最后只 save 一次；传输重试只由 API/route 层拥有。 |
| shujuku 实际源码 | `json-sanitizer.ts`（blob `68bc1fd…`）、`table-edit-parser.ts`（blob `9ad4d82…`）、`sqlite-template-validation.ts`（blob `039e164…`）、`sql-table-service.ts`（blob `4e083f9…`）、`update-orchestrator.ts`（blob `07c49d3…`） | `sanitize → splitTopLevelSegments_ACU/逐行 parse → schema validate → working clone/apply → one commit`；一行损坏不能抹掉其他有效行。 |
| P0 身份来源映射 | `docs/2.0/ACTOR_IDENTITY_REGISTRY_SOURCE_MAP.md` | P1 只消费 P0 已注册且已回读的 ActorRef；不回退 `entries/state`，不重新合并身份，不绕过 candidate → registered。 |

## 逐函数来源合同

| 分类 | 成熟函数/阶段 | P1 生产块 | 保留与适配边界 |
|---|---|---|---|
| A | shujuku `table-edit-parser.ts/splitTopLevelSegments_ACU` | `actor-profile-v6-core.mjs:3180-3227 splitTopLevelProfileSegments` | 保留引号、转义、花/方括号深度和只在顶层分隔的循环骨架；仅把 SQL 参数段改成 JSON 数组行。 |
| T | caikis `tracking_character_sheet INSERT` 的同轮多行完整行 | `actor-profile-v6-core.mjs:2162-2205 buildActorProfileCompletionMessages` | 一份共享正文/世界书材料加多张目标表；输出一个简单 JSON array。共享材料不在每个人物块重复。 |
| T | shujuku sanitizer、top-level segment 与逐行 parse | `actor-profile-v6-core.mjs:3228-3261 salvageProfileArrayRows`；`3262-3316 parseProfileObjectsLocally` | 先整批解析和本地标点/围栏修复，再逐行救回；坏数组中的完整对象仍可接受；不调用 JSON 修复模型。 |
| T | npc_tracker `runGate/profile/api/state`；shujuku `execute → export/parse → validate → working clone/apply → commit` | `actor-profile-batch-core.mjs:56-346 completeActorProfileBatchTransaction` | 一次批量调用；逐 ActorRef 隔离；仅缺失子集可有一次完整替换；串行 apply 到一个克隆；一次 persist；回读全部 commit 后才报告成功。运输失败不在本层重试。 |
| X | ActorRef 严格映射 | `actor-profile-v6-core.mjs:3317-3422 parseActorProfileCompletionBatchOutput` | 未知 ActorRef 单独拒绝；重复 ActorRef 拒绝并进入唯一一次 subset replacement；输入 ActorId 重复 fail-closed；绝不按姓名或数组位置猜。 |
| X | 本回合档案批容量与优先级 | `actor-profile-v6-core.mjs:1961-2031 selectActorProfileCompletionCandidates`；`index.js:338`、`916-921`、`931-939`、`10397-10435`、`18023-18031`、`18429-18440`、`12834-12856` | `actorProfileBatchCapacity` 独立控制一次 P1 档案模型批次，范围 1–24、默认 8；P5 的生成前 `characterCreationTicketPoolCapacity` 另为 1–64、默认 32，二者不绑定。并发 worker 和行动预算不作为叙事人数上限；已绑定票的新建人物优先，其余新建人物次之，最后才是历史欠账。 |
| X | 事实来源分类 | `actor-profile-v6-core.mjs:2032-2145 actorProfilePromptContext`；`2900-2915 existingProfileCandidateFactLayers` | 只有非空且 `fieldSource=confirmed` 的旧值是硬锚点；hypothesis/designed_seed 进入 editableDraft。空 confirmed 脚手架不压过新补全。 |
| X | 完整档案到行动投影 | `actor-profile-v6-core.mjs:3462-3550 canonicalProfile*`；`3558-3565`、`3589-3594`、`3611-3622 materializeActorProfileBaseline` | 把完整关系、常识和普通资源归一到 actor 可读形状；hypothesis/designed_seed 不冒充 confirmed，但仍完整投影、参与整张 digest/readback 并可 action-ready。 |
| X | 混合标记真实位置 | `actor-ledger-core.mjs:1750-1792 structuredContentActorFacts` | `<actor>/<npc>` 与方括号标记统一用同一 accepted narrative 的真实字符位置排序，不按扫描器类型拼接。 |
| X | namespace 与生产接线 | `index.js:12329-12431 completeActorProfilesForTurn`；`12750-12768` | 显式读取 `worldContext.text`；连接自己的 token/timeout 所有权；单次 durable `actorLedger` 保存与单次回读；读取 P5 的本地 `ticketPool.exhaustedActorRefs` 耗尽收据并复用现有 model diagnostic，不新增第二套持久队列或状态机。 |
| X | 单次回读参数 | `index.js:469`、`473`、`3460`、`3638`、`12405` | 通用 writer 保留默认回读策略；P1 批次显式 `readbackAttempts: 1`，并用 `expectedCommits.every(actorProfileCommitMatchesLedger)` 同时核对整批。 |

## 保留的项目基线（不计 A）

- 生成前匿名有序票池及生成后同票绑定继续由现有 `issueCharacterCreationTicket`、batch 缓存和 `bindCharacterCreationTicketsToRegisteredActors` 承担；P1 没有生成后补掷、重掷或票据复用。
- `ProfileInsertCandidate`、`repairActorProfileInsertLocally`、`validateActorProfileInsertCandidate`、`materializeActorProfileBaseline`、`actorProfileBaselineDigest`、`replaceActorProfileBaselineInLedger`、`actorProfileCommitMatchesLedger` 保留原接口。P1 只把它们放进成熟批处理时序并修正来源分类/完整投影。
- 现有 parser 的旧骨架不是成熟来源 A。只有上表可辨认的 shujuku segment 循环计 A；其余按 T 或 X 如实分类。
- `binding.skipped`、`ticketPool.exhaustedActorRefs`、原有失败数组与 `recordModelDiagnostic` 表达“没有生成前随机票”；这不等于档案不完整。耗尽人物仍进入同一 P1 完整档案候选，整档原子保存并回读，且保持 `designRolls=null`，禁止事后补票。`profileV6.backgroundPending` 只表达独立的档案批容量、模型失败或档案尚未完成，不能由 `ticket_pool_exhausted` 单独推出；没有新增第二套持久队列或状态机。

## 行数口径

以下按当前生产文件中的闭区间代码块跨度计数（含块内注释和空行；不计声明、测试、文档及保留基线）。不以名称给既有自写代码抬高成熟复用比例。

| 分类 | 精确块 | 行数 |
|---|---|---:|
| A | `3180-3227` | 48 |
| T | `2162-2205`（44）+ `3228-3261`（34）+ `3262-3316`（55）+ `actor-profile-batch-core.mjs:56-346`（291） | 424 |
| X | batch helpers 41；严格 ActorRef parser 106；容量/优先 selector 71；prompt 来源分类 114；旧事实来源段 16；canonical projection 89；materialize P1 段 26；混合顺序 43；readback 薄参数 5；settings/票池/UI 76；生产 batch adapter 103；失败诊断 19；新人优先接线 23 | 732 |

X 较多来自宿主作用域、ActorRef、设置/UI、诊断和持久化接线，并不代表重新设计了批处理时序。成熟 A/T 总计 472 行；保留基线另列，不计入任一比例。

## 行为与所有权结论

1. 正文人物数量不受票数限制。生成前票池耗尽的人物仍按 P0 注册、正常出场并进入同一 P1 完整档案候选；`ticket_pool_exhausted` 可在 `binding.skipped`、`ticketPool.exhaustedActorRefs` 与现有诊断聚合中看到，只表示该人物没有生成前随机票。P1 仍依据权威事实、已接受正文与不冲突的创意补全整档原子保存和回读，`designRolls=null`，不得事后补票。一般人物数超过独立 `actorProfileBatchCapacity` 时，仍沿用既有档案批次积压/`backgroundPending` 语义；这与票池耗尽无关。
2. 正常 N 人批次只有一次档案模型调用；本地格式修复仍一次；只有语义不可恢复的缺失子集允许第二次完整替换。模型运输重试归 `callModel/route`，批处理层不叠加。
3. 有效人物先串行写入同一个 ledger 克隆，再一次 namespace save、一次 readback。局部坏人物不拖累有效人物；save/readback 失败时本批无人被宣称成功。
4. 数据库继续从最终接受正文独立填表；预设继续在正文生成时使用匿名票塑造首次出场；Doctor 只在正文接受后绑定同票、补档和持久化，不修改数据库或接受后的正文。

## 合成验收边界

P1 定向测试覆盖 0/1/3/6/8 新人物、3 人/2 票耗尽后仍同批完成三张整档且耗尽人物 `designRolls=null`、混合标记顺序、独立档案批容量溢出、registered-before-profile、新人优先、共享证据只出现一次、坏数组逐行救回、重复/未知 ActorRef、局部失败、一次缺失子集替换、运输失败不外层重试、一次保存/回读、stale 零写入、save/readback fail-closed，以及 confirmed/empty-confirmed/hypothesis 的来源和完整投影。未运行真实模型、数据库、SillyTavern、Tauri、浏览器、构建或发布门禁。
