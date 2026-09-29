# Changelog

本文件记录 `dsh-local-file-share`（本地文件共享）的全部变更。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.0] — 2026-09-29

首个以 **Local File Share / 本地文件共享** 名义发布的版本（上游 `dsh-browser-fs@0.2.0` 的衍生版）。

### Added

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
