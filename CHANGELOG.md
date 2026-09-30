# Changelog

本文件记录 `dsh-local-file-share`（本地文件共享）的全部变更。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.0] — 2026-09-30

### Added

- **共享范围（scope）**：一次授权可以限定给「指定会话」白名单，默认仍是`全局`。
  卡片新增「共享范围」区块（全局 / 指定会话 + 会话复选列表 + 全选/清空），
  会话列表来自 `shell.overlay` 标准 props 的 `useSessions`。
- **会话内小条**：注册在 `conversation.input.dock`（session 作用域）的小条提供
  「加入本会话 / 移出本会话」—— 根作用域的卡片拿不到当前会话 id，两者互补；
  只在「指定会话」模式下渲染。
- **读写权限（access）**：`读写` / `只读` 可配置，默认`读写`。三层强制：
  L1 选「只读」时用 `showDirectoryPicker({ mode: read })` 让浏览器根本不给写权限；
  L2 客户端收到 write 帧时按策略直接拒绝（不碰 File System Access）；
  L3 host 侧不满足策略**不派发**并返回可操作错误（唯一权威）。
- **策略随授权走**：存在浏览器 `localStorage[dsh-local-file-share:share-policy]`，
  启动即随 `state` 帧上报；解除授权时一并清除。host 侧无状态，重启不丢。
- **错误分档**：无授权 / 被白名单挡 / 只读拒写三类错误各带"去哪改"的指引；
  工具描述里也补了策略提示，减少模型无效重试。
- 单测：策略归一化与判定矩阵（含非会话调用者）、协议向后兼容；smoke 新增
  只读拒写、白名单拒外会话、旧客户端缺省兼容、roster 策略摘要等用例。

### Changed

- `StateFrame` 新增可选 `policy`；`CallFrame` 新增可选 `caller` 与 `policy.access`；
  `RosterExecutor` 新增 `scope`/`access`。解析保持"宽松 + 缺省即默认"，
  1.0.0 客户端连新 host 行为不变（默认全局 + 读写）。
- 客户端选择器按当前权限选择 `mode`：`只读` → `read`，`读写` → `readwrite`。

### Notes

- 升级到 1.1.0 **无需重新授权**（句柄键不变；策略键缺省即默认）。
- 白名单**不自动覆盖子代理/团队成员**（它们的会话 id 不同）；卡片列表里子代理会标注，
  需要时手动勾选，或直接用「全局」。

## [1.0.0] — 2026-09-29

首个公开发布版（**Local File Share / 本地文件共享**，上游 `dsh-browser-fs@0.2.0` 的衍生版）：
发布到 npm `dsh-local-file-share`，代码公开于 GitHub `deepseekharness-dsh/dsh-local-file-share`
与 Gitee `deepseekharness/dsh-local-file-share`。

### Added

- **发布工程**：`test/*.test.mjs`（node:test，覆盖 manifest / patch / 产物品牌 / locale /
  smoke 全链路）、`.github/workflows/ci.yml`（Node 20/22/24：typecheck + build + test + pack 清单）、
  `.github/workflows/publish.yml`（tag 校验 + npm Trusted Publishing / OIDC，零令牌发布）。
- **主题化视觉层**：新增 `src/client/styles.ts`，注入式样式表 + `className` 体系；
  卡片、圆钮、预览窗、目录树全面改用 dsh 的 `--dsw-alias-*` token，浅色/深色主题自动跟随
  （token 缺失时退回原深色配色）。
- **交互补强**：标题行双击收起；`Esc` 收起卡片（预览窗打开时交给预览窗处理）；
  标题行可 Tab 聚焦并用方向键移动卡片（`Shift` 加速），位置照旧落盘记忆；
  状态行 `aria-live` 播报、图标按钮补 `aria-label`；目录树标题键盘 `Enter`/`Space` 展开。
- **动效与可达性**：进入动画、hover/active/focus-visible 态、细滚动条、
  `prefers-reduced-motion` 全量降级。
- **悬浮球重做**：36px → 40px，emoji 换成跟随主题的内联 SVG 图标，hover 放大、active 回弹。
- **插件元数据**：`icon.svg`、`locale/zh.json`、`locale/en.json`（标题/描述），
  npm 关键词、仓库字段、`engines`、`publishConfig.access`，以及 `npm run verify` 一键门禁。
- **文档**：README 重写（安装/快速上手/工具参考/安全模型/兼容矩阵/发布流程），
  新增 CHANGELOG、LICENSE 出处说明。

### Changed

- **更名**：包名 `dsh-browser-fs` → `dsh-local-file-share`；插件行 id `browser-fs` → `local-file-share`；
  CSS 前缀 `.dbfs-` → `.lfs-`；localStorage/IndexedDB 键前缀同步更名。
- **模型工具改名**：`browser_fs_list/read/write` → `local_file_list/read/write`。
- **WS 路径**：`/browser-fs/ws` → `/local-file-share/ws`（高亮 chunk 同目录派生）。

### Security

- **WS 升级会话校验**：`registerUpgrade` 处理器在原有同源校验之外，追加
  `connection.requestRejection`（Host/Origin 信任 + 浏览器 cookie）；未通过返回 401/403
  并直接关闭 socket。`connection` 服务缺失（非 web 组合）时跳过，不影响无头部署。

### Notes

- 由于包名、WS 路径与工具名同时变更，**升级本版本需要重启 dsh**；
- 句柄库与设备昵称等本地状态的键前缀已更名，授权目录**需要重新授权一次**。

## [0.2.0] — 上游版本

见 [dsh-browser-fs CHANGELOG / 仓库历史](https://github.com/whitefirer/dsh-browser-fs)。
本仓库自 0.2.0 的产物（`lib/` 三个文件经本地重新构建后 sha256 与 npm 版逐字节一致）分叉。
