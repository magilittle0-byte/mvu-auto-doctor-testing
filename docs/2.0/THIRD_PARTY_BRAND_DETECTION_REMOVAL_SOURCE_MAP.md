# 第三方品牌探测清理来源映射

## 已删除的生产耦合

| 旧耦合 | 原控制流 | 当前处理 |
| --- | --- | --- |
| 外部论坛品牌桥 | DOM 探测 → 来源切换 → 暂停 Doctor 论坛 → 跳转第三方按钮 | 完整删除；Doctor 内置论坛保持唯一所有者 |
| 第三方故事 provider | `window` 品牌 API → 读取对方 AUTO 设置 → 环境自检品牌状态 → provider route → 对方 `run()` | 完整删除；旧 provider 值迁移为 `direct` |
| 旧品牌 provider UI | 隐藏旧通道下拉、品牌说明和状态文案 | 删除品牌选项和品牌文案 |
| P3 导演品牌探测 | 扫描扩展设置、活动预设 tag 与第三方全局后决定是否运行 | 完整删除；`auto` 与 `on` 都运行，只有 `off` 关闭，新 checkpoint 只写 `doctor` |
| 数据库品牌与脚本树扫描 | 全局、扩展设置、TavernHelper 脚本名/正文签名 → 环境品牌卡/barrier 投影 | 完整删除；Doctor 不判断、不广告、不管理第三方数据库 |
| P4 外部 consumer provider | 外部注册、优先级与 callback 改变下一回合消费 | 完整删除；只使用 Doctor 自有 `setExtensionPrompt` slot，lease/consume/readback 继续 exact-once |

## 保留的中性能力

- `direct`：Doctor 自己的 OpenAI-compatible 连接、预设、槽位和连接健康。
- `tavern`：只有用户明确选择时使用宿主 `generateRaw`；只检测函数能力与 abort capability，不识别第三方品牌。
- MVU：读取、解析、精确写回和 busy 接口是 Doctor 完成功能所需的实际所有权接口。
- 聊天、角色卡、世界书与持久化：只读宿主通用上下文和保存能力。

## 仍保留的必要中性接口

| 优先级 | 位置 | 能力 | 保留理由 |
| --- | --- | --- | --- |
| P2 | `getMvu` 的 `window.TavernHelper.waitGlobalInitialized('Mvu')` | TavernHelper 全局 | 这是 MVU 延迟挂载的能力适配，不是品牌状态展示；可改成中性 capability adapter，但不能直接删除等待路径 |
| P2 | `usableContinuityWorldEntry` | SQL、表编辑、MVU schema 和机制代码特征 | 防止把机制指令当世界设定；不再使用第三方品牌词 |

源码参考文档中对成熟作品的署名、来源 commit 和许可证边界不是运行时探测，因此保留，不应为“去品牌”抹掉来源证据。
