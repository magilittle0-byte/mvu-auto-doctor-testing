# MVU Auto Doctor 2.0 权威规格索引

状态：`2.0.0-rc.34-mvu-optimization-candidate / testing-main / real-twelve-turn-gate-pending`

适用范围：2.0 产品、数据协议、事务协议、真实故障回放与阶段交接

历史参考架构状态：`阶段1—6文档与旧证据保留／阶段7尚未实施`；当前维护阶段名称：`旧路径与迁移收敛`（不重新编号为阶段6）。

最后更新：2026-08-20

本目录是 2.0 实施的权威入口。阶段0冻结产品边界、协议、不变量、回放基线与交接规则；阶段1至6依次实现领域、事务、导演、领域事务、双入口和持久运行时。阶段7新增 `v2/release/` 的1.x升级/回滚演练、性能/容量/隐私、安全/恢复硬化门。阶段8—9提供 Actor Shard 领域核和宿主接线；rc.4 新增持久 Actor Ledger，rc.5 加入稳定身份揭示/异变谱系、生命周期、实际观察回写、人物/势力/环境三通道和共享压力/注入预算；rc.6 增加独立偶发许可证与防刷，并移除全部本地计费估算和金额门；rc.7 把人物账本升至 v3，增加证据化人物 DNA、反脸谱语义路由和独立“人物万花筒”预设，并让严格/轻量独立 API 通道分别使用可调 1—8 并发池（默认2/4）。rc.8 将账本升至 v4，引入动态人格证据和群像覆盖规则。rc.9 将账本升至 v5并增加语义状态事实和多连接接管；rc.10 引入双游标、不死任务、人物档案 V6 与人物/世界分权；rc.11 补齐人物档案可见界面与一次结构修复；rc.12 取消医生对后台模型的固定倒计时，以用户主动取消和最新状态重排替代静默超时；rc.13 统一后台调度时钟，并以最新状态覆盖收敛替代逐条重演旧积压；rc.14 引入 typed ActorRef、真实档案覆盖、逐人物持久任务、模型世界裁决、内容寻址检查点、注入正文回执、解析感知槽位健康与真实三轮生产链门禁。每一版真实模型、数据库与宿主结论只引用本版独立报告，不沿用旧版本成功记录。

## 本轮参考架构来源映射

- [`ACTOR_IDENTITY_REGISTRY_SOURCE_MAP.md`](ACTOR_IDENTITY_REGISTRY_SOURCE_MAP.md)：P0 身份 candidate/registered 双表、明确分隔符别名、accepted narrative 晋升触发与本地 Gate 的 A/T/X 来源映射。
- [`CHARACTER_CREATION_TICKET_SOURCE_MAP.md`](CHARACTER_CREATION_TICKET_SOURCE_MAP.md)：阶段4生成前人物票据、权威来源占轴和同票绑定的实际来源映射。
- [`ACTOR_PROFILE_MVU_SEMANTIC_BRIDGE_SOURCE_MAP.md`](ACTOR_PROFILE_MVU_SEMANTIC_BRIDGE_SOURCE_MAP.md)：最新版预设语义域、accepted-final MVU 原子提交、ready-only P3、P4 摘要、修复与旧档案迁移的 T/A/X 来源映射。
- [`MVU_RUNTIME_SOURCE_MAP.md`](MVU_RUNTIME_SOURCE_MAP.md)：rc.29/rc.30/rc.31/rc.32 的宿主静态事件证据、A/B/C/D 运行时所有权、存储边界、可配置 runtime binding 与验证边界。
- [`ACTOR_ACTION_WORLD_ADJUDICATION_SOURCE_MAP.md`](ACTOR_ACTION_WORLD_ADJUDICATION_SOURCE_MAP.md)：阶段5人物行动就绪、尝试先持久化、世界裁决和双轨独立性的实际来源映射。
- [`ACTOR_COMPATIBILITY_MIGRATION_SOURCE_MAP.md`](ACTOR_COMPATIBILITY_MIGRATION_SOURCE_MAP.md)：“旧路径与迁移收敛”的 v4 确定性兼容升级、pre-Registry 身份边界、作用域隔离、旧入口停用与来源映射；历史 `phase6Runtime`/阶段6文件名只作兼容旧名。

## 权威文件

1. [`ACTOR_SOVEREIGNTY_ENGINE.md`](ACTOR_SOVEREIGNTY_ENGINE.md)：本次七阶段参考架构重构的人物权威合同；固定母版逐项映射、四层职责、事实优先级、目标数据流及阶段2精确入口。
2. [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md)：产品定位、设计原则、导演模式、口胡四级、模块和版本边界。
3. [`DATA_TRANSACTION_PROTOCOL.md`](DATA_TRANSACTION_PROTOCOL.md)：核心数据模型、事务状态机、分支隔离、稳定屏障和1.x兼容策略。
4. [`REAL_REPLAY_ACCEPTANCE_MATRIX.md`](REAL_REPLAY_ACCEPTANCE_MATRIX.md)：历史故障到机器回放用例的验收映射。
5. [`PHASE_ROADMAP.md`](PHASE_ROADMAP.md)：仓库既有阶段1至阶段10的输入、输出、完成门和交接入口；与本次七阶段重构编号相互独立。
6. [`PHASE_HANDOFF_TEMPLATE.md`](PHASE_HANDOFF_TEMPLATE.md)：每阶段必须填写的无聊天记忆交接模板。
7. [`handoffs/PHASE_0_HANDOFF.md`](handoffs/PHASE_0_HANDOFF.md)：阶段0实际交接、测试证据与阶段1准确入口。
8. [`handoffs/PHASE_1_HANDOFF.md`](handoffs/PHASE_1_HANDOFF.md)：阶段1领域核公开 API、测试证据与阶段2准确入口。
9. [`handoffs/PHASE_2_HANDOFF.md`](handoffs/PHASE_2_HANDOFF.md)：阶段2事务/分支公开 API、测试证据与阶段3准确入口。
10. [`handoffs/PHASE_3_HANDOFF.md`](handoffs/PHASE_3_HANDOFF.md)：阶段3导演层公开 API、测试证据与阶段4准确入口。
11. [`handoffs/PHASE_4_HANDOFF.md`](handoffs/PHASE_4_HANDOFF.md)：阶段4领域事务公开 API、测试证据与阶段5准确入口。
12. [`handoffs/PHASE_5_HANDOFF.md`](handoffs/PHASE_5_HANDOFF.md)：阶段5双入口、导演台、移动端与真实环境证据，以及阶段6准确入口。
13. [`handoffs/PHASE_6_HANDOFF.md`](handoffs/PHASE_6_HANDOFF.md)：阶段6稳定屏障、下游、看门狗、数据库与真实回放证据，以及阶段7准确入口。
14. [`handoffs/PHASE_7_HANDOFF.md`](handoffs/PHASE_7_HANDOFF.md)：阶段7迁移、发布硬化、候选包、真实QC与维护者审阅入口。
15. [`handoffs/PHASE_8_HANDOFF.md`](handoffs/PHASE_8_HANDOFF.md)：Actor Shard领域核、确定性选择/汇合、隔离worker和提示词插槽。
16. [`handoffs/PHASE_9_HANDOFF.md`](handoffs/PHASE_9_HANDOFF.md)：Actor Shard宿主接线、自动化集成证据及阶段10真实QC入口。
17. [`handoffs/PHASE_10_HANDOFF.md`](handoffs/PHASE_10_HANDOFF.md)：阶段10真实QC、阻断证据、候选包与发布门结论。
18. [`PHASE_6_REAL_QC_TEMPLATE.json`](PHASE_6_REAL_QC_TEMPLATE.json)：不含密钥、原始载荷或私人正文的阶段6真实环境报告模板。
19. [`MIGRATION_ROLLBACK_GUIDE.md`](MIGRATION_ROLLBACK_GUIDE.md)：1.x惰性升级、可读回退和保守恢复步骤。
20. [`USER_GUIDE_2.0_RC.md`](USER_GUIDE_2.0_RC.md)：RC安装、日常使用、伴生脚本共存测试和回滚说明。
21. [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md)：2.0.0 RC自动门、真实门、隐私门与发布门。
22. [`2.1_OPEN_ITEMS.md`](2.1_OPEN_ITEMS.md)：明确推迟到2.1的未决范围。
23. [`replay-fixture.schema.json`](replay-fixture.schema.json)：阶段0回放语料的机器可读 JSON Schema。
24. [`../../fixtures/2.0/replay-cases.json`](../../fixtures/2.0/replay-cases.json)：脱敏、最小化的真实故障回放基线。

## 冲突处理

- 人物发现、登记、四层数据职责、完整档案提交、人物行动与世界裁决，以 `ACTOR_SOVEREIGNTY_ENGINE.md` 为准。
- 通用数据形态、状态机、写入顺序或迁移冲突，以 `DATA_TRANSACTION_PROTOCOL.md` 为准。
- 产品体验、导演职责、自然语言与 UI 的关系，以 `PRODUCT_SPEC.md` 为准。
- 可验收结果和历史事故覆盖，以 `REAL_REPLAY_ACCEPTANCE_MATRIX.md` 为准。
- 仓库既有阶段范围与“何时可以进入下一阶段”，以 `PHASE_ROADMAP.md` 为准；本次七阶段参考重构的阶段边界以 `ACTOR_SOVEREIGNTY_ENGINE.md` 为准。
- 若规范与已发布的1.x运行时行为冲突，2.0实现必须通过兼容适配器迁移，不能直接覆盖旧数据。

## 阶段0—7验证

```powershell
node --test tests/v2-replay-fixtures.test.mjs
node --test tests/v2-domain-core.test.mjs tests/v2-domain-replays.test.mjs
node --test tests/v2-transaction-core.test.mjs tests/v2-transaction-replays.test.mjs
node --test tests/v2-director-core.test.mjs tests/v2-director-replays.test.mjs
node --test tests/v2-domain-transaction-core.test.mjs tests/v2-domain-transaction-replays.test.mjs
node --test tests/v2-surface-core.test.mjs tests/v2-surface-browser.test.mjs
node --test tests/v2-runtime-core.test.mjs tests/v2-runtime-replays.test.mjs
npm.cmd run qc:phase6:replay
npm.cmd run qc:phase7:replay
```

前六条命令保持阶段0—5全部不变量。第七条验证持久幂等/恢复、`captured → repairing → state-committing → settled`、failed/stale零下游、TaskLease硬超时、迟到结果零写入，以及数据库长度/参数化/修订冲突联合拒绝。阶段6报告保留历史证据；阶段7命令执行全部V2测试并生成17/17行为矩阵，真实环境失败会正式阻断候选。
