# P5 人物人格与预设塑形收口：实施合同与来源映射

## 1. 阶段边界与当前输入

本合同只覆盖“正文生成前的原创人物塑形、同一 `characterCreationTicket` 的正文后绑定、权威设定保护、基线人格/动态状态分离、票池容量与耗尽语义”。不进入旧路径迁移、持久化新系统、前端重做、真实模型/数据库/宿主、构建、CI、正式门禁或发布。

当前权威预设是：

- 本轮授权的本地私有原件（绝对路径与账户目录未入库）：`01_主预设_人物万花筒_可调篇幅最小修复候选版(2).json`
- 570,663 bytes；SHA-256 `9C44071EC664BD2C03B1B181C669A4E70CBB768987EABB5177E5F7A0E658CE78`
- `name=01_主预设_人物万花筒_可调篇幅最小修复候选版`
- 215 个 prompt、183 个 order 条目、75 个启用 prompt、33 条 regex script；Node `JSON.parse` 通过。
- 已遍历全部 prompt，正文合计 143,782 字符；prompt 内容清单摘要 SHA-256 `7AB34BCBA005170557BC2720194C735084FABB25FB7F4B06015BE62494C1881E`，regex 数组摘要 SHA-256 `923541DDE2B95F0AB3A9C4FDD47DE5131A619E7C1F4C5144791EC55098844966`。

项目 `dist/01_主预设_人物万花筒_可调篇幅最小修复候选版.json` 是旧历史产物（540,828 bytes；SHA-256 `F77CFC6F…C83F7F`），不是本阶段输入，不得冒充 `(2)`。旧文件只用于结构差异对照；P5 输出必须从 `(2)` 变换得到，不覆盖用户临时原件。

## 2. 不变量与唯一生产链

本阶段必须保持一条链，不新增第二套票据编排器：

```text
GENERATION_STARTED（非 dryRun）
  -> 现有 prepareNpcDesignTicketBatch()
  -> 现有 issueCharacterCreationTicket() 的确定性有序票池
  -> 现有 applySocialInjection() 注入 <Original_NPC_Dice_Tickets>
  -> 预设在正文第一次落笔前按首次出现顺序塑形
  -> 最终接受正文
  -> P0 ActorRegistry UPSERT / promotion
  -> 现有 bindCharacterCreationTicketsToRegisteredActors()
  -> P1 完整档案批量事务只读同票，禁止重新发票
```

固定所有权：

1. 角色卡、世界书、原著、数据库、结构化 Actor/profile/MVU 是人物既有事实的权威来源。
2. 预设只在正文生成前消费已经掷出的票；不保存医生档案、不写数据库/MVU。
3. 医生只在最终正文后识别、绑定、补档和纠错；不得重新掷人格，不把本轮情绪写成长期基线。
4. 数据库继续从最终正文独立填表；本阶段只翻译 caikis 的机制，不调用或接管数据库。
5. 缝合怪只提供仍属草稿的剧情/人物方向；未成为正文的建议不能冒充经历或事实。

## 3. 成熟来源完整性证据

### 3.1 糖糖公司

本体（本地绝对路径未入库）：`【MoM】糖糖公司 V3.2正式版 (2).json`，321,717 bytes，SHA-256 `9F630BCFD609B173FD0514EB1220B73118A797D1756162FA493E882A3BCBBDFA`。

全文件结构遍历结果：205 个命名节点、197 个 prompt content、81,062 个 prompt 内容字符；已逐项读取本阶段相关的 `⭐群星闪耀`、MBTI 表、九型人格表、依恋人格表、MBTI 反刻板化、主观局限、反过度解读、防钻牛角尖、人物自主、去 MBTI/正文去 MBTI 化。

直接采用而不改写成新词池的结构/表格：

| 来源节点 | 原结构 | P5 处理 | 生产落点 |
|---|---|---|---|
| `🧇九型人格` `432bda8a-feaa-41d5-882b-250880d298ff` | 9 行；列为“能量中心 / 动态轴 / 核心轴（渴望 vs 恐惧）” | 只复制“核心轴（渴望 vs 恐惧）”单元格到语义同义的 `coreDesire`；去掉型号/类型名称。能量中心、动态轴不因“相关”而强行改名给其他轴 | `actor-profile-v6-core.mjs` 现有 `coreDesire`，且仅此一轴 |
| `🧇依恋人格` `e8e3eb00-a9f0-4bdb-a565-86ef8824b983` | 4 行；列为“自我认知 / 他人认知 / 核心特征/行为模式” | 只复制“核心特征/行为模式”单元格作为一个独立关系潜在轴；不复制/保存/注入类型名称，不把一次抽签解释为整体依恋类型 | 现有 `relationshipDistance`；不再把同一行复制到其他人格轴 |
| `⭐群星闪耀` `82e6a603-63e9-4aad-8316-a9bd9526d370` | 每个角色有独立欲望、行动逻辑、信息不对称；不同反应/贡献形成关系网 | 约束原样进入同一个 `CHARACTER_DIVERSITY_CONTRACT`，不建第二 prompt | `fair-director-preset-core.mjs` 现有人物万花筒 prompt |
| `🧇MBTI反刻板化` + `📚去MBTI` | 偏好不等于能力上限；经历优先；类型只能内化，不得输出 | 约束原样保留。P5 不把 MBTI 16 行代码作为人物票值，避免类型标签进入票据/档案 | 预设合同与档案提示的反标签边界 |
| `🍬人物自主` / `🍬主观局限` | NPC 有独立目标；有限信息会造成误判 | 约束原样保留 | 预设首次塑形；医生只记录可观察证据 |

为何不直接使用糖糖的 MBTI 16 行作为票值：其单元格是 `Ni/Se/Te/Fi` 等类型代码，而当前权威预设明确禁止运行/输出心理类型和代码。把代码重新解释成另一组自然语言会构成新词池，因此 P5 只复用其“偏好不等于能力、经历优先、不得输出类型”的约束，不生成平行解释表。

九型/依恋兼容铁律：这里不是在运行人格测试，也不为人物判定型号。脚本只把成熟表内已经存在的某一个单元格当作一个独立、低优先级、可被权威事实丢弃的潜在创作轴；不同轴独立取值，一张票不能携带“1号/2号/安全型/回避型”等类型身份，不能据一个潜在轴反推整个人格，更不能把类型名称写入正文或档案。这与当前预设“不运行或输出 MBTI、九型人格、Tritype、依恋类型”的规则同时成立。

### 3.2 caikis 数据库模板

本体（本地绝对路径未入库）：`数据库模板-super自定义7.12总版-caikis.json`，298,883 bytes，SHA-256 `219E60B9327D8CF28E18ABC3EABE675996CCF4F03F872A2A8CE424F6A7179742`。

全文件结构遍历结果：22 个顶层节点、21 个命名 sheet。已完整读取以下四表的 NOTE、INIT、INSERT、UPDATE、DELETE、DDL、updateConfig 和 exportConfig：

| 表 | 原样采用的机制 | 现有落点的最小适配 |
|---|---|---|
| `first_npc / NPC表 / sheet_oh2cjqkqn` | `name UNIQUE`；先查 NPC表与追踪角色表；均无记录才 INSERT；已有记录只 UPDATE | 已由 P0 Registry UPSERT/alias 索引承担；P5 只让“既有人物不消费票”沿同一 promotion 结果判断 |
| `second_npc / 追踪角色表 / sheet_important_npc` | aliases 与真名同步；晋升复用同一人物；一人一行 | 现有 `ActorRef` 和 alias，不新建身份层 |
| `tracking_character_sheet / 追踪人设基线 / sheet_exq8ru8cf` | 性格调色盘：主色是最常驱动行为，底色是稳定质地，点缀只在条件下激活；新生人物一人一行；建档后锁定，只同步姓名/别称 | 票据保持主色/底色/点缀的三个独立槽；档案 fact layer 只填真正空缺轴，已确认基线不改写 |
| `tracking_character_dynamic / 追踪人设偏移 / sheet_qzy5180nr` | 近期情绪、互动逻辑、强化/弱化侧面、行为偏移另表；仅重要大事记触发；不重写基线 | 现有 profile `dynamicState` 与 baseline modules 分离；一次紧张/愤怒/冷漠不得进入票据或长期基线 |

本阶段不复制 SQL 写入口，也不让医生写 caikis。唯一语法翻译是 `name UNIQUE / aliases / SELECT -> UPDATE or INSERT` 对应已有 Registry 判断，以及“基线表/偏移表”对应现有 profile baseline/dynamicState 所有权。

### 3.3 Izumi

当前本体（本地绝对路径未入库）：`Izumi 0707.json`，459,102 bytes，SHA-256 `D84EB5EF43EB382D70031DE5DD319871C99759027645696626EC504F26DE6691`；同时核对历史归档的 0713/0714 版本。

全文件结构遍历结果：204 个命名节点、196 个 prompt content、105,702 个 prompt 内容字符。本阶段完整读取多语言性格锚定、有限认知、反猜人设/防情绪化、COT 中逐人知识边界，以及 `setvar/getvar` 进入既有生成链的注入机制。

| 原机制 | P5 处理 | 落点 |
|---|---|---|
| 性格锚点只引导表现，锚点词绝不能直接出现在正文 | 原样采用；票据不得作为属性表输出 | 现有预设人物万花筒 prompt |
| 未明确性格不事后猜成强结论；角色只按自己知道的信息行动 | 原样采用；医生的推断仍标 `hypothesis/designed_seed` | 档案 fact layer 与正文约束 |
| 用 `setvar/getvar` 接入既有提示链 | 机制等价使用当前已有 extension injection，不另建调度器/状态机 | `applySocialInjection()` |

### 3.4 PrismFox

本体（本地绝对路径未入库）：`双人成行v11.0—PrismFox 正式版（数据库变量版）.json`，1,342,388 bytes，SHA-256 `32071A9D6B3516D5CF2FC42A1A83264F8B38E26DDCE5DAE34E7345572D07D2FC`。

全文件结构遍历结果：308 个命名节点、259 个 prompt content、513,778 个 prompt 内容字符。本阶段完整读取 `😀丨活人感与动作塑造基准`、`😀丨人格补充（中）`、NPC 引入、反极端、Char 主动、群像文风和群像视角。

直接采用的现成机制；下列示例不冒充同义离散轴：

| 原节点 | 原文已有的离散选择/机制 | P5 落点 |
|---|---|---|
| `😀丨活人感与动作塑造基准` `0a989020-3030-4c5c-bdcc-cb6af78c8c60` | 不完全表达可“顾面子、绕开话题、装没听见、用玩笑糊过去” | 原样保留为正文表现机制；这是表达策略，不是说话密度、句长、停顿组成的 `speechRhythm` 池 |
| 同上 | 动作选择为“改了主意、换了做法、中断或继续某件事” | 原样保留为“动作要改变局面”的正文机制；这是即时动作功能，不是反复出现的 `actionHabit` 池 |
| 同上 | 每轮反应由“当下处境、信息差、身体状态、利益压力和前文经历”共同决定 | 原样进入预设合同；不把动态处境固化成票据人格 |
| 同上 | 处境优先于标签、认知有边界、记得前文、同人对不同对象分寸不同 | 原样进入同一人物万花筒 prompt |
| `😀丨人格补充（中）` `e0c6ef75-a84b-4012-a3c8-d85e27a55a25` | 情绪有余温但状态会改变表现；关键决定回到人物底色 | 与 caikis 基线/偏移分离合并为同一合同，不另建审查层 |

`NPC引入` 中“主动引入 NPC”不原样采用，因为本阶段产品合同明确“不知道最终人数、没有新人物不消费、不得为了使用票强行加人”。这是具体产品语义冲突，不是另造替代机制。

## 4. 当前权威预设中的直接选项池

当前 `(2)` 的 `🎭人物万花筒V2`（ID `cf9b6278-b776-4c56-b02d-d34f0f0f7d31`）包含下列词项。P5 先判断它是否完整同义于现有 ticket 轴，不能因为已经列成选项就一律当作可替换池：

| 当前 `(2)` 条目 | 原样内容 | 语义判定 |
|---|---|---|
| 社交办法 | `直说`、`绕开`、`交易`、`观察`、`玩笑`、`礼貌疏离`、`照顾细节` | 与 `socialMethod` 同义，可完整替换旧 `SOCIAL_SEEDS`；票值只保存其中一项，不顺带决定幽默、关系距离或冲突方式 |
| 决策办法 | `先核价`、`凭经验`、`问人`、`试错`、`留退路`、`服从程序`、`看心情` | 与 `decisionMethod` 同义，可完整替换旧 `DECISION_SEEDS` |
| 信息取样偏好 | `亲历`、`权威`、`数字`、`气氛`、`熟人` | 只是 thinking 的信息来源子维度，不包含推理、校验、归因方式；不得内嵌 `decisionMethod`，也不足以完整替换 `THINKING_STYLE_SEEDS`。原句只作为 `thinkingStyle` 的表现约束/档案证据 |
| 受压第一反应 | `控制`、`回避`、`求助`、`讨价还价`、`僵住`、`加快行动` | 只有首反应，没有恢复路径；不足以替换完整 `pressureAndRecovery`，保留 `PRESSURE_RECOVERY_SEEDS` |
| 普通人表现示例 | `低效率`、`走神`、`犯小错`、`先完成手边工作`、`在别处继续生活`、`暂时对玩家没有特别反应` | 混合临时状态、叙事许可和即时行为，不是稳定日常习惯池；不足以替换 `EVERYDAY_SEEDS` |
| 首次显露带宽 | `一个当下目标或小事`、`一个决定办法`、`一个普通身体/语言细节` | 是正文展示数量规则，不是人物轴或随机池 |

### 4.1 定向检索与语义阈值

在完整遍历四份本体后，针对 `幽默/玩笑/调侃/自嘲`、`权威/服从/反抗/规训`、`自欺/合理化/盲点/偏见`、`受压/压力/恢复/缓解`，并追加 `冲突/争执/对抗/协商/让步/退让/谈判/讨价还价`，定向复核全部 prompt content。结论按“是否能直接成为通用人物票的独立同义离散值”判断，而不是按关键词命中判断：

| 本体 | 实际命中内容 | 语义结论 |
|---|---|---|
| 糖糖公司 | 砂糖/果糖人格、无厘头和吐槽文风含幽默示例；九型动态轴描述高压/放松；主观局限说明偏见；群像、战斗、恋爱和文风条目涉及冲突/对抗 | 特定元人格、文风、情节冲突或带型号动态机制均不是任意原创人物的独立通用池；没有独立 `conflictStyle` 表，也没有完整幽默、权威、自欺、恢复池 |
| Izumi | 入间人间、伏见司、王小波等文风含自嘲、合理化、反权威、压力或冲突示例；其他命中是战斗/节奏/文风规则 | 拆出这些词会把作者文风强加给人物；Izumi 可移植的是有限认知、目标—选择—后果与既有链注入机制，不提供上述独立人物池 |
| PrismFox | `活人感与动作塑造基准` 有“用玩笑糊过去”；`人格补充（中）` 有偏见、自我怀疑和失态后回到底色；叙事推进列出拒绝、让步、隐瞒等即时动作 | 这些是正文表现、即时动作或保护机制；不是说话节奏、长期行动习惯或冲突方式池，也没有完整权威、自欺、恢复池 |
| 当前 `(2)` | 社交办法含“玩笑”；信息来源含“权威”；有 6 项受压首反应；其他 prompt 允许 NPC 拒绝、谈判、撤退、攻击或呼援 | 社交办法不能派生幽默，信息来源不能派生权威态度，首反应不能派生恢复；拒绝/谈判/撤退等是本回合可选行动，不是稳定 `conflictStyle` |

“成熟来源相关”不等于“字段同义”。复用比例不能凌驾于字段语义、独立性和自然中文完整性；没有完整同义池时，按用户规定的最后顺序保留现有最小 `*_SEEDS`，不从相关示例另编 catalog。

## 5. 原始池到现有 20 字段的逐项映射

P5 保留 `issueCharacterCreationTicket()` 的现有字段名和单一消费路径。每个顶层轴只保存本轴的语义值；禁止一个轴的结果对象嵌入另一个独立轴的值。`coreDesire` 的“渴望 vs 恐惧”原单元格是一个核心动机整体，`pressureAndRecovery` 的“受压反应 + 恢复路径”是同一动态生命周期；除此之外不把两个独立概念拼成复合对象。

选择仍使用现有唯一规则：

```text
index = fingerprint(匿名票槽身份 + generation entropy + 目标轴自己的 salt) % 原池长度
```

20 个顶层轴必须各自使用不同的稳定 salt：`value/temperament/core-desire/thinking-style/social-motive/social/interest-orientation/decision/conflict-style/moral-boundary/speech/action-habit/humor/authority/relationship/friction/self-deception/pressure-recovery/everyday/life-focus`。任何两个轴都不得共享一次 `diceEntry`、共享抽中的行号、读取对方的结果或由另一个轴派生。

糖糖九型核心轴只供 `coreDesire` 使用；依恋行为单元格只供 `relationshipDistance` 使用。绝不先抽一个类型行再扩散，不保存型号/类型名/代码，不保存“本票属于某类型”的中间值。这样同一概念不会在多轴重复抽取，也不会产生隐藏类型相关性。

| ticket 轴 | 生产选择源 | 判定 | 逐项语义/接口理由 |
|---|---|---|---|
| `valuePriority` | `VALUE_SEEDS` | **fallback 保留** | 糖糖核心“渴望/恐惧”描述动机，不等于“承诺、公平、选择权、现实回报”等规范性价值优先级；拆出渴望侧强行改名会丢语义 |
| `temperament` | `TEMPERAMENT_SEEDS` | **fallback 保留** | 糖糖能量中心是关注/处理领域，不是松弛、慢热、精力、情绪速度等基础气质；两者接口语义不兼容 |
| `coreDesire` | 糖糖九型 `核心轴（渴望 vs 恐惧）` 9 个原单元格 | **成熟来源完整替换** | 原表字段与核心欲望/畏失同义；只保存原单元格，不带型号，不供其他轴读取。`PERSONAL_GOAL_SEEDS` 仍保留给 `independentLifeFocus` |
| `thinkingStyle` | `THINKING_STYLE_SEEDS` | **fallback 保留** | 当前 `(2)` 的信息取样偏好只是一个子维度；`decisionMethod` 已是独立轴，绝不内嵌或重复抽取。完整思考/校验/归因方式继续由本池承担 |
| `socialMotive` | `SOCIAL_MOTIVE_SEEDS` | **fallback 保留** | 糖糖“每人有自己目标”与当前“不围着玩家转”是机制要求，不是社交动机离散值；核心欲望也不必然是社交动机 |
| `socialMethod` | 当前 `(2)` `社交办法` 7 项 | **成熟来源完整替换** | 字段同义；一票只保存一个原词项，不包含幽默、关系距离、冲突或权威结果 |
| `interestOrientation` | `INTEREST_ORIENTATION_SEEDS` | **fallback 保留** | 核心渴望/恐惧不等于资源、收益、控制权、生活质量等利益取向；不得把 `coreDesire` 复制或拆分到本轴 |
| `decisionMethod` | 当前 `(2)` `决策办法` 7 项 | **成熟来源完整替换** | 字段同义；仅由本轴 `decision` salt 抽取，不进入 `thinkingStyle` |
| `conflictStyle` | `CONFLICT_STYLE_SEEDS` | **fallback 保留** | 四份本体定向检索只有情节冲突、即时拒绝/谈判/撤退动作或文风规则，没有稳定人物冲突方式池；不得拼接 `socialMethod` 与受压反应 |
| `moralBoundary` | `MORAL_BOUNDARY_SEEDS` | **fallback 保留** | 核心“想保护/害怕失去”是动机，不说明允许隐瞒、欺骗、牺牲或越权到什么程度；不能改名为道德边界 |
| `speechRhythm` | `SPEECH_SEEDS` | **fallback 保留** | Prism“顾面子/绕开/装没听见/用玩笑糊过去”是表达策略，不是说话密度、句长、停顿与节奏；语义不兼容 |
| `actionHabit` | `ACTION_HABIT_SEEDS` | **fallback 保留** | Prism“改主意/换做法/中断/继续”是动作对局面的功能，不是长期反复的行动习惯；语义不兼容 |
| `humorMethod` | `HUMOR_SEEDS` | **fallback 保留** | 成熟本体只有特定人格/文风的幽默或“用玩笑”这一表达策略，没有通用独立幽默池；不得从 `socialMethod` 派生 |
| `authorityAttitude` | `AUTHORITY_SEEDS` | **fallback 保留** | “权威”作为信息来源不等于服从、质疑、程序观或权力关系态度；不得从 `thinkingStyle` 派生 |
| `relationshipDistance` | 糖糖依恋表 `核心特征/行为模式` 4 个原单元格 | **成熟来源完整替换** | 行为单元格与靠近、独处、沟通、回避等关系距离模式同义；只供本轴独立抽取，去掉类型名，不保存/输出依恋类型，不向其他轴扩散 |
| `ordinaryFriction` | `FRICTION_SEEDS` | **fallback 保留** | 核心恐惧不是日常弱点、误读或摩擦；把恐惧侧改名会把强动机病理化，也会与 `coreDesire` 重复 |
| `selfDeception` | `SELF_DECEPTION_SEEDS` | **fallback 保留** | 当前 `(2)` 提供“自我形象与行为缝隙”的证据规则但没有离散值；本池提供非空潜在轴，P1 以可修订推断完整填写而不冒充权威事实 |
| `pressureAndRecovery` | `PRESSURE_RECOVERY_SEEDS` | **fallback 保留** | 当前 `(2)` 只有 6 个首反应，Prism 只有状态/收尾机制，糖糖动态轴依赖型号；均不能提供完整无类型的“首反应 + 恢复路径”对 |
| `everydayTexture` | `EVERYDAY_SEEDS` | **fallback 保留** | 当前 `(2)` 混合走神、犯错、手边工作和“不对玩家反应”等状态/叙事许可，不是稳定生活纹理的完整池 |
| `independentLifeFocus` | `PERSONAL_GOAL_SEEDS.map(longTerm)` | **fallback 保留** | “不围着玩家转”只是所有权规则，糖糖核心欲望也不等于一个可独立推进的生活焦点；现有长期目标池仍是最小完整来源 |

完整替换仅有四处：`SOCIAL_SEEDS -> 当前 (2) 社交办法`、`DECISION_SEEDS -> 当前 (2) 决策办法`、`coreDesire` 的旧 `PERSONAL_GOAL_SEEDS.map(longTerm) -> 糖糖核心轴原单元格`、`RELATIONSHIP_SEEDS -> 糖糖依恋行为原单元格`。其中 `PERSONAL_GOAL_SEEDS` 常量不能删除，因为 `independentLifeFocus` 继续使用。

其余 16 个轴全部保留现有项目 fallback：`VALUE_SEEDS/TEMPERAMENT_SEEDS/THINKING_STYLE_SEEDS/SOCIAL_MOTIVE_SEEDS/INTEREST_ORIENTATION_SEEDS/CONFLICT_STYLE_SEEDS/MORAL_BOUNDARY_SEEDS/SPEECH_SEEDS/ACTION_HABIT_SEEDS/HUMOR_SEEDS/AUTHORITY_SEEDS/FRICTION_SEEDS/SELF_DECEPTION_SEEDS/PRESSURE_RECOVERY_SEEDS/EVERYDAY_SEEDS/PERSONAL_GOAL_SEEDS.map(longTerm)`。它们不是为了提高复用率而重写的新 catalog，而是成熟来源语义/接口确实不完整时必须保留的现有最小池。

因此现有 20 个字段全部保留、每轴独立 salt、每轴直接返回非空可用结果。不能删除字段、降低必填标准、共享抽签、把另一轴塞入结果对象、从其他轴派生，或把同一成熟概念在多轴重复抽取。不同轴可以形成可共存的性格张力，但不能在同一概念上给出互斥值。

## 6. 替换边界、最小适配、确需新写

### 6.1 删除/保留边界

- 只替换四个语义完整同义的旧选择源：`coreDesire` 改读糖糖核心轴原单元格，`socialMethod` 改读当前 `(2)` 社交办法，`decisionMethod` 改读当前 `(2)` 决策办法，`relationshipDistance` 改读糖糖依恋行为原单元格。不保留这四处的新旧双轨，不在旧池外只包一层“来源标签”。`SOCIAL_SEEDS/DECISION_SEEDS/RELATIONSHIP_SEEDS` 后续可删除；`PERSONAL_GOAL_SEEDS` 本体必须保留给 `independentLifeFocus`，只有 `coreDesire` 不再读取它。
- 其余 16 个轴的现有独立池和原内容必须保留：`VALUE_SEEDS/TEMPERAMENT_SEEDS/THINKING_STYLE_SEEDS/SOCIAL_MOTIVE_SEEDS/INTEREST_ORIENTATION_SEEDS/CONFLICT_STYLE_SEEDS/MORAL_BOUNDARY_SEEDS/SPEECH_SEEDS/ACTION_HABIT_SEEDS/HUMOR_SEEDS/AUTHORITY_SEEDS/FRICTION_SEEDS/SELF_DECEPTION_SEEDS/PRESSURE_RECOVERY_SEEDS/EVERYDAY_SEEDS/PERSONAL_GOAL_SEEDS.map(longTerm)`。四份参考没有语义完整同义的等价池，这是 existing project fallback / 确实不存在部分。不得删轴、删项、改写、由其他轴推断、缩成空值或降低 V3 完整票据标准。
- V1/V2 已保存的全部 20 轴兼容读取，不迁移、不重掷；V3 也继续输出同一 20 轴键集合。

### 6.2 最小适配

- 在同一 `issueCharacterCreationTicket()` 内只为上述四个完整替换轴读取成熟原表/原选项；其余 16 轴继续读取现有 fallback。确定性 `fingerprint -> index` 机制和每轴独立 salt 不变。
- 票据版本从 V2 升到 V3；V1/V2 仅为已持久化兼容读取。绑定函数继续保持同一 `ticketId`、完整 20 轴与原轴结果，不重掷。
- prompt 展示继续稳定表达每轴自己的值；糖糖 `coreDesire` 保留一个“渴望 vs 恐惧”原字符串，`pressureAndRecovery` 保留同一轴的二元组，其余轴不新建包含别轴字段的结果对象，也不重述成新自然语言词池。
- `CHARACTER_DIVERSITY_CONTRACT` 在同一 ID 上升级，加入 caikis 基线/偏移分离和明确耗尽语义；不新增第二人物 prompt。

### 6.3 确需新写及原因

| 新写 | 原因 | 边界 |
|---|---|---|
| 独立的 `characterCreationTicketPoolCapacity` 配置（默认 `32`，允许 `1–64`） | 当前 `actorProfileBatchCapacity` 同时承担生成前票池与正文后档案批量，两个所有者和时序不同；扩大票池不应把一次档案模型批次同步扩大 | 唯一生产入口仍是 `prepareNpcDesignTicketBatch()`；它只把 capacity 来源改成 `getSettings().characterCreationTicketPoolCapacity`，继续调用同一个 `issueCharacterCreationTicket()`/同一个 batch map，不创建第二编排器。`actorProfileBatchCapacity` 继续独立控制 P1 一次档案模型批次 |
| 票池摘要/耗尽收据 | 成熟来源不认识本项目 `chat/message/swipe/generation/branch/hash/ActorRef` 身份约束；必须在既有绑定 API 上表达耗尽人物 | 只报告 `capacity/eligible/consumed/exhaustedActorRefs`；人物仍登记，不合并、不删除、不延迟、不事后发票 |
| `pool_exhausted` 档案标记与提示 | 医生必须知道该人物没有生成前票，才能 fail-closed 地禁止事后随机人格 | P1 仍从权威事实、已接受正文和不冲突的创意补全生成全字段非空、原子提交、可读回的完整档案；禁止调用任何出票函数，创意补全不得伪称来自生成前票 |

## 7. 身份、消费与恢复合同

1. 票池在 `GENERATION_STARTED` 且非 dryRun 时一次生成；不知道最终人数，不调用第二 AI。
2. 每张票的发行身份继续包含 `chatId/generation/generationId/generationType/order`；绑定时补齐 `messageId/index/swipeId/branchId/hash/ActorRef/firstAppearanceOrder`。
3. 只有 P0 promotion 返回 `created=true`、来源为当前 accepted narrative、且不属于权威保护人物的 Actor 才消费。
4. 既有人物、玩家、角色卡/世界书/原著/数据库/MVU 已有人物均不消费；部分轴已知时绑定同票但把精确轴写入 `discardedAxes`，其余票轴只填充真正空缺的轴，不覆盖已知轴，也不留下必填空值。
5. 多人按 P0 promotion 的首次出现顺序消费，不按姓名排序。
6. 0 人消费 0；1/3/6/超过 3 人均使用同一预生成批次，不存在三人上限。
7. 默认票池容量为 32，可配置 1–64；容量只是生成前可用票数，不是人物出场上限，更不存在三人上限。
8. 票池耗尽时，超出人物仍注册和出场；返回 `ticket_pool_exhausted`，不合并、不删、不延迟人物，不在正文后补发/重掷。`pool_exhausted` 只表示“没有生成前随机票”，不表示允许半张档案。P1 仍必须依据角色卡/世界书/原著/数据库/结构化 Actor/profile/MVU、已接受正文和不冲突的创意补全生成一张完整、原子提交、读回可用的档案；只是创意补全不能伪称来自人物票，也不能调用出票函数。
9. swipe/regenerate 使用酒馆原生 generation type 产生新 generation/新票池；旧 generation 不得跨分支绑定。
10. 精确重放已经持久化的 Actor/ticket 时，`created=false` 或 `ticket_already_bound`，消费 0；不得因 map 缓存被清理而重新出票。
11. 切换聊天清空内存票池；持久 Actor/profile 仍由聊天 namespace 隔离。

## 8. 基线人格与动态状态

直接采用 caikis 两表所有权：

- `tracking_character_sheet`：主色/底色/点缀是建档基线；只从权威事实、同一生成前票和已接受正文形成；建档后不因普通波动重写。
- `tracking_character_dynamic`：近期情绪、互动逻辑、被强化/弱化侧面、行为变化是动态层；只在事件证据成立时更新。
- PrismFox 的“当下处境、信息差、身体状态、利益压力、前文经历”只决定本轮表现。
- 一次紧张、愤怒、冷漠、恐惧、顺从、善意均不得反推 `temperament/coreDesire/valuePriority` 等长期票轴。

## 9. 受控验收合同

必须在生产调用点而非只测 helper：

1. 0/1/3/6/超过 3 个新人物；不设三人上限。
2. 已知人物和无新人物不消费。
3. 多人物按首次出现顺序绑定同一批生成前票。
4. 角色卡/世界书/原著/数据库/结构化 Actor/profile/MVU 保护；部分轴只丢弃冲突轴。
5. swipe/regenerate、旧分支、新聊天隔离；精确重放消费 0。
6. 票池耗尽返回精确收据；人物不合并/删除/延迟，医生不事后出票。
7. 基线人格与动态情绪分离。
8. 预设输入必须是当前 `(2)`；输出 JSON、prompt order、启用状态、regex 与未触碰内容可核验。
9. JSON/语法检查、直接相关快速回归、完整非浏览器回归；断言不得为造绿而降低。

## 10. 当前 `(2)` 预设保真与输出结构

P5 必须从 SHA-256 `9C44071E…658CE78` 的 `(2)` 本体生成候选输出，不从旧 `dist` 文件二次加工。变换只允许更新既有 ID `cf9b6278-b776-4c56-b02d-d34f0f0f7d31` 的人物万花筒内容；不得新建第二人物 prompt，不得删除现有 prompt。

保真断言：

1. 输出仍为 215 个 prompt、183 个 prompt-order 条目、75 个启用 prompt、33 条 regex script。
2. 215 个 prompt 的 identifier、顺序、role、启用状态全部不变；除人物万花筒 ID 外，其余 214 条 prompt 的完整对象逐字节等价。
3. 33 条 regex script 的完整数组逐字节等价；`extensions.baibaiToolkit.regexGroups` 也不得被重排或补写。
4. 顶层采样参数、token、reasoning、扩展配置和根 `name` 保持当前 `(2)`；不为了 P5 追加版名破坏用户当前文件身份。
5. 人物万花筒继续只输出正文，不输出 `characterCreationTicket`、骰面、心理类型名称/代码、属性表或设计过程。
6. 票据运行时结构继续是完整 20 轴：`valuePriority/temperament/coreDesire/thinkingStyle/socialMotive/socialMethod/interestOrientation/decisionMethod/conflictStyle/moralBoundary/speechRhythm/actionHabit/humorMethod/authorityAttitude/relationshipDistance/ordinaryFriction/selfDeception/pressureAndRecovery/everydayTexture/independentLifeFocus`。任何 V3 票缺少其中一轴均为无效票，不能降低阈值造绿。
