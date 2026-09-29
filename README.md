# 本地文件共享 · Local File Share

[中文](https://github.com/deepseekharness-dsh/dsh-local-file-share/blob/main/README.md) | [English](https://github.com/deepseekharness-dsh/dsh-local-file-share/blob/main/README.en.md) | [Gitee 镜像](https://gitee.com/deepseekharness/dsh-local-file-share)

> 让 dsh 的 agent 直接读写**你电脑上**的文件 —— 不复制进容器，不落在服务器磁盘上。

- npm：<https://www.npmjs.com/package/dsh-local-file-share>
- GitHub：<https://github.com/deepseekharness-dsh/dsh-local-file-share>
- Gitee：<https://gitee.com/deepseekharness/dsh-local-file-share>
- 精选列表：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>

**一个悬浮卡片，一座桥：** 在 dsh 页面里授权一个本地目录，agent 就能用三个模型工具
（`local_file_list` / `local_file_read` / `local_file_write`）直接操作它 —— 文件字节经私有
WebSocket 通道在**内存**里转发，一个字节都不落 dsh 宿主的磁盘。

---

## 为什么需要它

dsh 通常跑在容器或远端服务器里，自带的 fs 工具只能摸到宿主机；而你的资料、图纸、手册、
代码都在**本机**。把整个目录塞进容器既慢又占空间（一个安装包镜像就 15 GiB）。

本插件补上这个缺口：浏览器既能看到本机文件，又能连上 dsh，于是让它当桥。

```
本机磁盘 ──File System Access API──► 你的浏览器页面
                                        │  私有 WebSocket（同源 + 会话校验）
                                        ▼
                              dsh 宿主进程（内存中转发）
                                        │
                                        ▼
                        agent 的三个工具：list / read / write
```

## 特性

| | |
|---|---|
| **零占用** | 不落盘、不缓存、不复制；只有一个在线标签页的内存开销 |
| **悬浮卡片** | 右下角圆钮（40px，跟随主题的 SVG 图标 + 状态点），点一下展开完整面板；可拖动、可拖底部手柄调高度、位置和高度记忆在浏览器本地 |
| **主题跟随** | 视觉全部走 dsh 的 `--dsw-alias-*` token，浅色/深色自动一致；`prefers-reduced-motion` 全量降级 |
| **键盘可用** | 标题行可 Tab 聚焦，方向键移动卡片（`Shift` 加速），`Esc` 收起，双击标题行收起；状态行 `aria-live` 播报 |
| **目录树** | 懒加载、递归搜索、hover 显形「复制路径」；点文件名弹预览窗（图片 / 文本 / 代码语法高亮） |
| **可读可写** | 完整模式下文本/代码可在预览窗里编辑保存回本机；兼容模式自动降级为只读 |
| **多设备** | 每台开页面的设备各自授权；工具结果带执行设备标签（如 `设备：Windows · Chrome`） |
| **安全** | WS 升级同时校验同源与浏览器会话（`connection.requestRejection`），不过即 401/403 关连接；不依赖任何第三方服务 |

## 界面

- **收起**：右下角圆钮，右上角状态点用颜色表达连接/授权状态（绿=已授权，黄=待确认，灰=未授权/离线）。
- **展开**：状态行 + 设备昵称（可编辑）+ 授权按钮组 + 「目录内容」树 + 底部高度手柄。
- **预览窗**：钉顶标题栏（文件名 / 大小 / 编辑 / 关闭）、路径行、独立滚动内容区，可拖动可缩放。

> 视觉截图：`docs/screenshot-upstream.png` 是上游版本（`dsh-browser-fs`）的界面，仅作功能示意；
> 本版本的主题化界面截图待补。

## 原理

双面插件（cordis 体系）：

- **host 半**（`src/index.ts`，跑在 dsh 宿主 Node 进程）
  - `ctx.webServer.registerUpgrade` 注册精确路径 `/local-file-share/ws` 的 WebSocket；
  - `ctx.tools.register` 注册 `local_file_list` / `local_file_read` / `local_file_write`；
  - 工具调用打包成 `{type:'call', rpcId, op, args}` 帧发给**持有授权句柄**的标签页，
    按 `rpcId` 配对 result 帧；`exec.signal` 接 abort（同时给浏览器发 cancel 帧）；
  - 同目录派生 `/local-file-share/highlight.mjs` 路由，按需供给语法高亮 chunk。
- **client 半**（`src/client/`，跑在浏览器）
  - 启动从 IndexedDB 读回目录句柄并 `queryPermission`，连回 host 的 WS（断线指数退避重连）；
  - 收到 call 帧后用 File System Access API 执行，回发 result 帧；
  - 在 `shell.overlay` 注册悬浮卡片，状态变化时广播 `{type:'state', hasHandle, dirName, label}`；
  - 多标签页在线时，host 只把调用派给 `hasHandle=true` 的标签页。

## 安装

```sh
# 1) 从 npm 安装（推荐：零脚本、无需构建授权）
dsh plugin --profile web add dsh-local-file-share

# 2) 直接从 GitHub 安装（lib/ 构建产物入库，安装零脚本）
dsh plugin --profile web add github:deepseekharness-dsh/dsh-local-file-share

# 3) 从 Gitee 镜像安装（同一份产物）
dsh plugin --profile web add git+https://gitee.com/deepseekharness/dsh-local-file-share.git

# 4) 本地开发：改代码后重装（改动需先 npm run build，产物 lib/ 已入库）
npm install && npm run verify
dsh plugin --profile web add file:/abs/path/to/dsh-local-file-share
```

安装后**重启 dsh**（宿主半需要重新加载模块与路由），重新打开页面即可看到右下角圆钮。

## 快速上手

1. 打开 dsh web 页面 → 右下角圆钮 → 「授权目录」→ 在系统对话框里选一个目录。
   浏览器会询问**读写**权限（插件请求 `mode: 'readwrite'`）—— 只打算让 agent 读，就别让它写。
2. 直接对 agent 说：*“列一下我授权目录里的内容”*，它会调用 `local_file_list`。
3. 之后可以：读某个文件（`local_file_read`）、写入或新建文件（`local_file_write`），
   也可以在卡片里点文件名自己预览。

## 工具参考

| 工具 | 参数 | 返回 |
|---|---|---|
| `local_file_list` | `path?`（相对授权根，省略=根）、`recursive?`（默认 false） | 目录条目：相对路径、类型、大小（递归时含全部层级） |
| `local_file_read` | `path`（必填）、`maxBytes?`（默认 256 KiB，超出标注截断） | 文本内容（UTF-8） |
| `local_file_write` | `path`、`content`（自动创建父目录；同名覆盖） | 写入字节数 |

三个工具的描述里都写明：**操作对象是浏览器所在机器的本地磁盘，不是 dsh 宿主机**。多设备同时
持柄时，结果会标注执行设备。

## 安全模型

- **授权范围**：只有你主动选中的那一个目录（及其子树）可见，插件拿不到目录之外的路径。
- **权限语义**：插件请求 `readwrite`；写入只在你（或 agent）明确调用时发生。File System Access API
  不允许插件在没有用户手势的情况下重新授权。
- **连接校验**：WS 升级先做同源（`Origin` 与 `Host` 一致）与浏览器会话
  （`connection.requestRejection`）双重校验，不通过直接 401/403 关闭 —— 别的站点无法挂在你的会话上。
- **数据流向**：字节只在「你的浏览器 ↔ 你的 dsh 宿主」之间流动，不经过任何第三方服务。
- **页面必须在场**：没有标签页在线时，工具调用**立即**返回明确错误，不会静默挂起。

## 兼容性与限制

| | 完整模式 | 兼容模式（自动降级） |
|---|---|---|
| 触发 | HTTPS 或 `localhost`（安全上下文） | 纯 HTTP 局域网访问等 |
| 选择方式 | `showDirectoryPicker` 系统目录选择器 | `input[webkitdirectory]` 选目录 / 多选文件 |
| list / read | ✅ | ✅（只读快照） |
| write | ✅ | ❌ 明确报错 |
| 授权持久化 | ✅ IndexedDB，刷新自动恢复 | ❌ 刷新需重选 |

- **句柄随刷新失效**是浏览器安全模型决定的（权限不跨会话持久时需重新授权），不是 bug；
- **跨域 iframe** 里不能弹目录选择器，被嵌套时请到顶层页面授权（卡片会给出直达链接）；
- **移动端**：华为浏览器等可能报"可用"但点击无反应，插件会自动退到兼容模式的多选入口；
- 只在 UTF-8 文本读写范围内工作（二进制写入不在范围；图片仅在卡片内预览）。

## 开发

```sh
npm install
npm run build       # node build.mjs → lib/（host ESM + client CJS 闭包 + 高亮 chunk）
npm run typecheck   # tsc --noEmit
npm run smoke       # 协议往返 / abort / 断连 / 跨源拒绝 / 钳位纯逻辑
npm run verify      # 上面三步串起来（prepublishOnly 也走它）
```

**`lib/` 是入库产物**：改完代码必须先 `npm run build` 再提交，否则发出的包是旧代码。

目录地图（`src/client/`）：

| 文件 | 职责 |
|---|---|
| `index.ts` | client 入口、WS 重连、帧分发、卡片数据源 |
| `ui.tsx` | 悬浮卡片 / 目录树 / 预览窗（React JSX） |
| `styles.ts` | 主题化样式层（注入式样式表 + `lfs-` 类名体系） |
| `fs.ts` / `files-backend.ts` | File System Access 操作与后端抽象 |
| `store.ts` | IndexedDB 句柄存取 |
| `preview.ts` / `highlight.ts` | 预览判定与代码着色 |
| `compat-picker.ts` | 无 File System Access API 环境的降级选择器 |
| `device.ts` / `i18n.ts` | 设备标签 / 跟随 dsh 语言的中英文案 |
| `panel-fit.ts` | 悬浮面板定位防出界 |

## 发布与上架

维护者文档：完整清单见 [`docs/publishing.md`](https://github.com/deepseekharness-dsh/dsh-local-file-share/blob/main/docs/publishing.md)。

1. **npm**：`npm run verify` → 改版本号 → 提交 → 打同号 tag（如 `v1.0.1`）→ GitHub Actions
   `.github/workflows/publish.yml`（校验 tag 与版本号一致 + 跑测试后 `npm publish`）。
   本机手动兜底见 `docs/publishing.md`。
2. **GitHub**：<https://github.com/deepseekharness-dsh/dsh-local-file-share>（主仓库，
   已带 `dsh-plugin` topic）。
3. **Gitee**：<https://gitee.com/deepseekharness/dsh-local-file-share>（代码镜像与国内分发；
   npm 包仍发布在 npmjs，插件市场按 npm 包名安装）。
4. **插件市场**：dshmarket 的安装来源**只认 curated registry**
   [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) ——
   往那个仓库提一个 PR，新增 `data/plugins/deepseekharness-dsh__dsh-local-file-share.yml`
   （内容见 `publish/awesome-dsh-plugin-投稿.yml`）。**不要**往 dshmarket 主仓库提插件条目。

## 许可与出处

MIT。[`LICENSE`](LICENSE) 里保留了上游署名与衍生说明。

本仓库是 [`dsh-browser-fs`](https://github.com/whitefirer/dsh-browser-fs)（作者
[whitefirer](https://github.com/whitefirer)，MIT）的衍生版本：WS 中继协议、host/client 双半结构、
File System Access 后端、语法高亮 chunk、兼容模式选择器、多设备 roster 均来自上游；
本版本在其上完成了更名、主题化视觉层、交互与可达性补强，以及 WS 会话校验加固。
详见 [CHANGELOG.md](CHANGELOG.md)。
