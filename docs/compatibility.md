# 版本兼容（DSH / 后续版本适配）

> 目标：**不必跟着 DSH 每个版本改代码**，同时在上游真发生破坏性变更时能立刻发现、而不是等用户报错。

## 支持范围

| 项 | 值 |
|---|---|
| `peerDependencies` | `@deepseek-ai/dsh-tools: >=0.1.0-rc.6`（**无上界**，接受 0.2/0.3/1.x …） |
| Node | `>=20` |
| 实测通过 | DSH `0.1.7-rc.2`（1.0.0 时代）、DSH `0.2.0-rc.2`（1.1.1 时代） |
| 产物契约 | `lib/index.js`（ESM host 半）+ `lib/client.js`（CJS 闭包，`window.__ModuleLoader__.load`） |

## 我们实际依赖的上游 API（薄面）

| 面 | 用法 | 缺失/变更时的行为 |
|---|---|---|
| `@deepseek-ai/dsh-tools` | `defineTool`、`ToolRunContext`（仅 `signal` 与 `agent`） | 类型门禁会挡住；`agent` 形状已做双形状兼容（`{id}` / `{session.id}`） |
| `ctx.tools.register` | 注册三个模型工具 | 缺失则插件激活失败（这是硬能力，无降级意义） |
| `ctx.webServer.register` / `registerUpgrade` | WS 通道 + 高亮 chunk 路由 | 同上 |
| `connection.requestRejection` | WS 升级的浏览器会话校验 | **可选**：服务缺失时跳过校验（无头部署仍可用） |
| `ctx.slots.inject` / `register` + `shell.overlay` | 浮动卡片 | 槽位缺失则卡片不渲染（硬能力），但不会抛错影响其它插件 |
| `useSessions`（overlay 标准 props） | 共享范围的会话列表 | **可选**：缺失时列表降级为空，并提示"还没有会话列表" |
| `conversation.input.dock` | 会话内"加入/移出本会话"小条 | **可选**：整段 `try/catch` 静默降级，卡片不受影响 |
| `window.__ModuleLoader__` | 客户端产物加载格式 | 缺失则客户端不加载（硬契约） |

## 已做的防御（为什么能"跟着版本走"）

1. **peer 范围无上界**：不再把 0.2 / 0.3 挡在 `^0.1.0-rc.6` 之外。
2. **客户端 inject 只保留 `@deepseek-ai/dsh-client-ui-slots`**：会话小条改走运行时动态等待槽位，
   上游若重命名 `dsh-client-ui-conversation` 不会让整块客户端模块加载失败。
3. **所有可选服务/槽位/hook 都做存在性判断或 try/catch**，失败只降级、不炸卡片。
4. **协议宽松解析**：`policy` 等新字段缺失即默认值，旧客户端/旧 host 组合不会硬失败。

## 兼容门禁（升级 DSH 后跑一条命令）

```sh
npm run check:harness     # 用本机安装的 DSH 自带类型面跑 tsc
# 或显式指定安装位置：
DSH_INSTALL=/path/to/@deepseek-ai/dsh npm run check:harness
```

- 脚本：`scripts/harness-types.mjs`。它**不改 node_modules、不改依赖**：在仓库根生成一个临时
  `tsconfig`（把 `@deepseek-ai/dsh-tools` 映射到 DSH 安装里的类型入口），跑完即删。
- 找不到 DSH 安装时**跳过并退出 0**（CI 里没有 harness 安装属正常）。
- `npm run verify` 已把这条门禁串进去（build → typecheck → smoke → check:harness）。

## 升级 DSH 后的标准动作

1. 升级 DSH → 重启；
2. `npm install && npm run check:harness`；
3. 若通过：`npm run verify`，然后页面实测三件事（授权目录 / `local_file_list` / 卡片上的共享范围与只读开关）；
4. 若不通过：按报错改类型面（通常是 `dsh-tools` 的导出或 `ToolRunContext` 字段），改完重跑；
5. 按需发 patch（`1.1.x`）——`lib/` 必须一起提交。

## 已知的、与版本无关的限制

- 浏览器侧需要安全上下文（HTTPS 或 localhost）才有目录选择器，否则自动降级为只读兼容模式；
- 句柄随刷新失效是浏览器权限模型的特性，不是版本问题；
- 文本（UTF-8）读写范围，二进制写入不在支持内。
