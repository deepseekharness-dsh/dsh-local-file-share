# 设计：共享范围与读写权限配置（目标版本 1.1.0）

> 状态：**已实现并发布为 v1.1.0**（实现纪要见文末"实现纪要"一节）
> 评审结论：Q1 沿用默认 `读写`；Q2 白名单模式下非会话调用者一律拒绝；Q3 提供"加入本会话"路径；
> Q4 不做临时策略；Q5 工具描述补策略提示 —— 均按设计文档的建议执行。
> 关联：[README](../README.md) · [CHANGELOG](../CHANGELOG.md) · 上游出处见 [LICENSE](../LICENSE)

## 1. 现状（已实测，非推断）

| 事实 | 证据 |
|---|---|
| 三个工具是**全局注册** | `src/index.ts` 的 `ctx.tools.register(...)` 在插件 apply 层，未传 agent 作用域（`:432 / :484 / :520`） |
| 工具执行**不读调用方会话** | `execute(args, exec)` 只用 `exec.signal`（`:475 / :511 / :542`）；`ToolRunContext.agent` 完全没用 |
| 执行者取「**最先接入**的持柄连接」 | `BrowserRelay.pickExecutor()` 遍历插入序返回第一个 `hasHandle`（`:285-293`） |
| 授权按**浏览器 origin** 存 | `IndexedDB DB_NAME = 'dsh-local-file-share'`，键里无 sessionId（`src/client/store.ts:7`） |
| 卡片是**根作用域**唯一实例 | `slots.register({ name: 'shell.overlay', id: 'local-file-share', order: 100 })`（`src/client/index.ts:454`） |
| 帧协议只有 5 种帧，无策略字段 | `src/wire.ts`：`CallFrame / CancelFrame / RosterFrame / ResultFrame / StateFrame`；`StateFrame = { hasHandle, dirName, label }` |

结论：**当前是"实例级共享"** —— 同一 dsh 实例内所有会话共用一个授权，且无法限制读写。

## 2. 目标与非目标

### 目标

1. **默认全局**：不配置时行为与 1.0.0 完全一致（全局共享、可读可写）。
2. **共享范围可配置**：`全局` 或 `仅指定会话`（白名单，多选）。
3. **读写权限可配置**：`只读` / `读写`。
4. **策略在 host 侧强制**，不只是 UI 提示：不满足策略的调用**不派发**，返回可操作、可审计的错误。
5. **向后兼容**：1.0.0 客户端连新 host、新客户端连旧 host 都不崩；策略缺省即现状。
6. **可解释**：拒绝时告诉模型/用户"为什么被拒、去哪改"。

### 非目标（本期不做）

- 按**文件路径**白名单（示例：只共享 `D:\pjs\doc`）→ 记为后续版本候选；
- 策略的服务端持久化（策略属于"授权"，跟浏览器走，见 §4）；
- 多用户/多租户隔离（不同浏览器天然各自授权，已满足）；
- 审计日志落库（本期靠工具结果天然进入会话日志，见 §9）。

## 3. 领域模型

```ts
/** 一次授权（= 一台浏览器上的一个目录句柄）所带的共享策略。 */
interface SharePolicy {
  scope: 'global' | 'sessions'      // 默认 'global'
  sessions: string[]                // scope='sessions' 时的会话白名单（SessionId 字符串）
  access: 'readwrite' | 'readonly'  // 默认 'readwrite'
}

const DEFAULT_POLICY: SharePolicy = { scope: 'global', sessions: [], access: 'readwrite' }
```

**归属**：策略与「目录授权」同生命周期，存在**浏览器**（与句柄同一 IndexedDB 库，或 `localStorage['dsh-local-file-share:share-policy']`；二选一在编码时定，倾向前者以便与句柄同事务、解除授权即清空）。host 侧**不持久化**，只按连接上报的策略做判定（无状态、重启不丢因为浏览器会重连上报）。

## 4. 判定矩阵（host 侧唯一权威）

设调用方会话 `S = exec.agent?.id`（可能为 `undefined`），操作为 `op`：

| scope | access | S 在白名单 | 判定 |
|---|---|---|---|
| global | readwrite | — | ✅ 允许 |
| global | readonly | — | `op=write` ❌ 拒绝（只读）；`list/read` ✅ |
| sessions | readwrite | 是 | ✅ 允许 |
| sessions | readwrite | 否 | ❌ 拒绝（会话不在范围） |
| sessions | readonly | 是 | `op=write` ❌（只读）；其余 ✅ |
| sessions | readonly | 否 | ❌ 拒绝 |
| sessions | 任意 | S 为 `undefined`（非 agent 调用者） | ❌ 拒绝：白名单模式无法覆盖非会话调用者 |

> **非目标/边界**：非 agent 调用者（如某些框架内驱动、批量任务）在 `sessions` 模式下**一律拒绝**，错误消息里说明"请改用全局共享或从会话内调用"。这一条需要你确认（见 §12 Q2）。

**子代理/团队会话**：子代理与团队成员的 `SessionId` 与发起会话不同 → 白名单默认**不覆盖**它们；UI 提供快捷加入（若 `useSessions` 能给出父子/团队关系，则提供"包含本会话的子代理"；否则退化为"从列表中手动勾选"，并在文档里写明）。**"本会话"的获取方式**是实现前置：卡片在 `shell.overlay`（root 作用域），拿不到 session props，需用槽位标准 props 的 hooks（`useSessions()` / `usePanelInfo()`）——编码前先用 `cordis_inspect`（Slots 目录 + Client `sessions` 服务契约）核实字段，不猜。

## 5. 执行者选择改造

```
pickExecutor(op, sessionId):
  候选 = hasHandle=true 的连接中，policyAllows(conn.policy, sessionId, op) 的那些
  取候选里插入序最靠前的（保留"先接入者先得"的确定性语义）
```

错误分档（**关键**：让用户知道是"没人授权"还是"被策略挡了"）：

| 情形 | 结果消息（示意） |
|---|---|
| 无任何持柄连接 | `local-file-share: 没有设备持有授权目录（请在 dsh 页面的「本地文件共享」卡片里授权）` |
| 有持柄但策略拒绝（白名单） | `local-file-share: 当前授权仅共享给会话 session-1a2b…，本会话 session-9f8e… 不在范围内（在卡片「共享范围」里加入本会话，或改为全局共享）` |
| 有持柄但策略拒绝（只读 + write） | `local-file-share: 当前授权为「只读」，已拒绝写入 <path>（在卡片里切换为「读写」后重试）` |

## 6. 协议变更（`src/wire.ts`）

保持"宽松解析、缺省即默认"的风格：

```ts
interface StateFrame {            // browser → host
  type: 'state'
  hasHandle: boolean
  dirName: string | null
  label: string
  policy?: SharePolicy            // 新增，可选；缺省 = DEFAULT_POLICY（1.0.0 客户端天然兼容）
}

interface CallFrame {             // host → browser
  type: 'call'; rpcId: string; op: FsOp; args: Record<string, unknown>
  caller?: string                 // 新增，可选：仅用于浏览器侧显示/日志，不参与判定
  policy?: { access: 'readwrite' | 'readonly' }   // 新增，可选：客户端二次拦截用
}

interface RosterExecutor {        // host → browser
  label: string; dirName: string | null
  scope: 'global' | 'sessions'    // 新增：让每台设备能看到彼此的共享范围
  access: 'readwrite' | 'readonly'
}
```

- 解析器对非法/缺失字段**回落默认**，绝不因为新字段让旧端硬失败；
- `parseBrowserFrame` 需新增对 `policy` 的字段级校验（`scope ∈ {global,sessions}`、`access ∈ {readwrite,readonly}`、`sessions` 只保留字符串且去重、长度上限如 200 条）。

## 7. 三层强制（defense in depth）

| 层 | 位置 | 作用 |
|---|---|---|
| L1 OS/FSA | 新增「只读授权」入口：`showDirectoryPicker({ mode: 'read' })` | 浏览器层面拿不到写权限，连插件都写不了（最强） |
| L2 客户端执行 | `src/client/fs.ts` / 帧处理 | 策略 `readonly` 时收到 `write` 帧直接回错误，不碰 File System Access |
| L3 host 派发 | §4 判定矩阵 | 不满足策略不派发；不依赖浏览器是否守规矩（唯一权威） |

## 8. UI 设计（`src/client/ui.tsx` + `styles.ts`）

卡片新增「共享范围」区块（默认折叠，展开后）：

```
┌─ 本地文件共享 ─────────────────── ● 读写 · 全局 ─┐   ← 标题行右侧策略徽标（非默认策略用警示色）
│ 本机：Windows · Chrome      已授权：pjs          │
│ 共享范围  [ 全局 ] [ 指定会话 ]                  │   ← 分段控件（segmented）
│ 权限      [ 读写 ] [ 只读 ]                      │   ← 分段控件；切到只读时徽标变警示色
│ ┌ 会话（仅"指定会话"时显示）───────────────────┐ │
│ │ ☑ session-1a2b  项目A · 运行中               │ │   ← 本会话置顶并标注「本会话」
│ │ ☐ session-9f8e  调试                          │ │
│ │ [全选] [清空] [加入本会话]                     │ │
│ └──────────────────────────────────────────────┘ │
│ 目录内容 ▸                                        │
└───────────────────────────────────────────────────┘
```

- 新增样式类走既有 `lfs-` 体系：`.lfs-seg`（分段控件）、`.lfs-switch`（若用开关）、`.lfs-chip`（徽标）、`.lfs-list`（会话列表）；
- 全部颜色用 `--dsw-alias-*` token + fallback；键盘可达（方向键在分段控件内切换、空格切换复选）、`aria-live` 播报策略变化；`prefers-reduced-motion` 已有全局降级；
- 文案走 `i18n.ts`（zh/en 键严格对齐，`npm test` 里已有 i18n 键奇偶校验）；
- 策略变化**即时生效**：写入本地存储 → 重新广播 `state` 帧。

## 9. 兼容与迁移

| 组合 | 行为 |
|---|---|
| 新 host + 1.0.0 客户端 | 客户端不上报 `policy` → host 按 `DEFAULT_POLICY` 判定（等于现状） |
| 旧 host + 新客户端 | host 忽略新字段；**L2 客户端拦截仍生效**（只读至少在本机有效），但白名单不会有 host 侧强制 → 文档明确提示"升级 host 后才完整强制" |
| 升级 | 无需重新授权：句柄键不变，新增策略字段缺省即默认；`CHANGELOG` 里写明"策略存储键新增" |
| 解除授权 | 策略一并清除（与句柄同库） |

## 10. 测试计划

**单测（`test/*.test.mjs`，CI 可跑，纯函数优先）**
- 判定矩阵全表（6 种组合 + `S=undefined` + `op` 三态）；
- `parseBrowserFrame`：无 `policy` 字段 → 默认；非法 `scope/access` → 回落默认；`sessions` 去重、非字符串过滤、超长截断；
- `pickExecutor`：多连接 + 白名单 + 只读的候选过滤与插入序稳定性；
- 错误消息：三类拒绝文案各含可操作指引（用断言锁住关键词）。

**smoke（`scripts/smoke.mjs`，现有 6 组之上新增）**
- 策略拒绝：host 收到 `state(policy=readonly)` → `write` 调用得到拒绝结果而非派发；
- 兼容：不发 `policy` 的 state → 调用照旧成功。

**人工验证（页面）**
- 切「只读」→ 调 `local_file_write` → 得到只读错误；切回「读写」→ 成功；
- 切「指定会话」且不勾本会话 → `local_file_list` 被拒并给出指引；勾上本会话 → 成功；
- 多设备同时在线时，roster 徽标显示各自的 scope/access。

## 11. 编码顺序（按可独立验证的切片）

| 步骤 | 内容 | 验证 |
|---|---|---|
| S1 | `wire.ts` 策略类型 + 解析（含默认/校验）+ host 判定纯函数 + 单测 | `npm test` 绿 |
| S2 | host：执行者选择改造 + 三类错误消息 + smoke 新用例 | `npm run smoke` 绿 |
| S3 | 客户端：策略存储 + `state` 上报 + L2 拦截 + 「只读授权」入口 | 页面手测 |
| S4 | UI：共享范围区块 + 徽标 + i18n + 无障碍 | 页面手测（需要你截一张图） |
| S5 | 文档：README/README.en 增"共享范围与权限"章节、CHANGELOG 1.1.0、本设计文档定稿 | 审阅 |
| S6 | 发布：`npm run verify` → `npm test` → 提交 → **推 GitHub + Gitee** → npm 1.1.0 | §4 验收同款脚本 |

**版本号**：默认行为不变 + 纯新增字段 ⇒ **1.1.0**（minor）。

**发布依赖**：npm 发布需要凭据 —— 目前 OIDC Trusted Publisher 尚未配置，bypass-2FA 令牌按 §7 已撤销/待重置。二选一：(a) 你先配好 Trusted Publisher，之后打 `v1.1.0` tag 由 CI 发布；(b) 临时生成一枚新 granular token（用完即撤）。

## 12. 需要你拍板的 5 个问题

| # | 问题 | 我的建议 |
|---|---|---|
| Q1 | 新授权（选目录后）的**默认权限**：沿用 `读写` 还是改为 `只读`？ | 沿用 `读写`（保持 1.0.0 行为），但开关放显眼位置 + 首次切「指定会话」时提示一次 |
| Q2 | `sessions` 白名单模式下，**非 agent 调用者**（`exec.agent` 缺失） | 一律拒绝，并在错误里说明如何放开 |
| Q3 | 是否需要「**包含本会话的子代理/团队成员**」快捷加入？ | 需要，但以 `useSessions` 是否提供父子关系为前提；拿不到就退化为手动勾选 + 文档说明 |
| Q4 | 是否要「**临时策略**」（仅本次页面会话有效，刷新回落默认） | 本期不做，保持模型简单 |
| Q5 | 只读时 `local_file_write` 的**工具描述**是否也改成"当前可能被策略拒绝" | 改：在三个工具描述里加一句策略提示，减少模型无效重试 |

---

**下一步**：你确认上述问题（或直接说"按建议来"）后，我按 §11 的 S1→S6 实施，并在最后把代码提交到 GitHub 与 Gitee（以及按你选择的方案发布 npm）。


## 实现纪要（与设计稿的差异）

| 项 | 设计稿 | 实现 | 原因 |
|---|---|---|---|
| 策略存储 | 倾向 IndexedDB（与句柄同库） | **localStorage** `dsh-local-file-share:share-policy` | 策略只有几十字节，且**启动时就要同步进 state 帧**；句柄继续留在 IndexedDB。解除授权时一并清除，语义与设计一致 |
| `CallFrame` 附加字段 | `caller` + `policy: { access }` | 同设计 | host 注入调用方会话 id 与生效权限，客户端据此做 L2 判定与显示 |
| `RosterExecutor` | `scope` + `access` | 同设计 | 卡片与多设备场景能看到彼此的共享范围 |
| "加入本会话" | 卡片里的按钮 | **会话内小条**（注册在 `conversation.input.dock`） | 根作用域的卡片拿不到 `sessionId`（`shell.overlay` props 里没有），会话作用域槽位才有；两者共用同一数据源与 action。小条只在"指定会话"模式下渲染 |
| 调用方会话 id 读取 | `exec.agent.id` | `callerSessionId(exec.agent)`（兼容 `{id}` 与 `{session.id}` 两种运行时形状） | `dsh-tools` 的 `agent` 类型面在 0.1.0-rc.6 → 0.1.7-rc.2 之间变过，peer 范围同时覆盖两者 |

验证：`npm test`（12 例，含策略归一化、判定矩阵全表、协议向后兼容、smoke 全量）；
smoke 新增只读拒写 / 白名单拒外会话 / 非会话调用者 / 旧客户端缺省 / roster 策略摘要 / 调用帧携带策略等用例。
