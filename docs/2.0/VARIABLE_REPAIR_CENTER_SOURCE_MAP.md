# 独立 MVU 变量修复中心来源映射

## 冻结边界

本模块只处理 MVU 当前变量，不导入、等待或写入人物档案、世界连续性、数据库、
世界书、角色卡和缝合怪状态。按钮在正文生成期间不启动；正文完成后才复用既有
变量审计链。未知故障只记录脱敏故障包，不自行修改插件源码，也不把空值算成功。

## T / A / X 映射

| 分类 | 成熟来源与实际控制流 | 当前实现 |
|---|---|---|
| T | 既有 `runTarget -> commitCandidateUnlocked`：读取当前 MVU、写前 repair journal、目标 guard、`replaceMvuData`、回读校验、按触碰路径回滚、正文状态栏刷新、撤销 | 原样复用，不另建 MVU store，不改数据库或 Doctor 其他模块 |
| T | 既有 `writeRepairJournal -> writeChatNamespace`：选字段写、durable save、readback、失败回滚 | 故障包继续写入同一 `repairJournal`，没有第二套持久化 |
| A | 既有开局资源同步属于 MVU 派生变量修复 | 只有主变量审计成功/无需修改后才顺序执行；失败立即停止 |
| A | 既有动态对象缺失成员机械合并 | rc.35 从最近父对象开始，最多沿已存在普通对象祖先逐级重组；每一级仍走原 MVU parser、Schema、触碰路径与未触碰字段验证，首个全通过候选才进入原事务。数组、只读、混合失败、缺失祖先和无关字段损失继续 fail-closed |
| X | 原实现缺少独立手动编排、固定失败码和长期脱敏故障证据 | `v2/repair/variable-repair-center.mjs` 只提供计划、顺序执行、故障包、日志压缩和诊断投影；通过注入的 `variable_audit` / `opening_resource_sync` 适配器调用成熟实现 |

## 持久证据

每次手动“安全修复变量”最多保留一条小型故障包，字段仅含：当前运行指纹、聊天
作用域摘要、目标楼层、固定动作/结果码、输入输出长度、排队/模型/解析/持久化耗时、
是否零写与是否读回。不得保存正文、人物名、提示词、模型原文、URL或凭据。

`repairJournal` 保留最近 5 条可撤销业务记录和 25 条故障包。故障包状态不使用
`prepared/applied`，因此不会被现有“撤销上次修复”误当成 MVU 快照。

## 用户界面与 API

- 设置页与悬浮工具页统一显示“安全修复变量”。
- 普通语言说明：独立 MVU 修复，不启动人物/世界/数据库。
- API v9：`runVariableSafeRepair()`、`getVariableRepairHistory()`。
- 脱敏诊断包新增 `variableRepair` 汇总，只含数量、固定结果码、耗时与读回布尔值。

## 验收边界

自动测试、语法和静态检查只能阻止候选无法加载，不能证明真实可用。任何运行代码
变化后，仍必须按 `MVU_REAL_TAVERN_ACCEPTANCE_PROTOCOL.md` 使用当前指纹完成真实
酒馆门禁，完整通过前不得推送或声称可用。

rc.34 当前指纹的第3个真实回复证明：两个同父、深度三的新成员在叶子 insert 与最近父对象 replace 两种形态下都被宿主 MVU 静默丢弃。该证据只用于冻结 rc.35 修复根因；运行代码已变化，旧聊天不能续接当前验收。`doctorRuntimeCriticalFingerprint()` 已包含 `coalesceMissingObjectTargetsPatch` 与 `parseCandidate` 的函数体，祖先策略变化会改变运行指纹。
