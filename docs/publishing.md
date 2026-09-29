# 发布清单（npm · GitHub · Gitee · 插件市场）

> 面向维护者。用户面文档见 [README.md](../README.md)。

## 0. 发布前一次性替换

本仓库用 `OWNER` 作占位符（`package.json` 的 `repository`/`homepage`/`bugs`/`author`，README 与本文档的链接）：

```sh
grep -rl "OWNER" . --exclude-dir=node_modules --exclude-dir=.git | xargs sed -i 's/OWNER/你的账号/g'
npm run verify        # build + typecheck + smoke 全绿
```

`lib/` 是入库产物：**任何源码改动都必须先 `npm run build`**，否则发布出去的是旧代码。

## 1. npm

```sh
# 手动（首次）
npm login
npm run verify
npm publish --access public

# 或走 CI：改版本号 → 提交 → 打同号 tag
git commit -am "chore: release v0.4.0"
git tag v0.4.0
git push origin main --tags        # .github/workflows/publish.yml 校验 tag==version 后发布
```

要点：

- `publishConfig.access: public` 已固定；`prepublishOnly` 会跑 `npm run verify`；
- CI 需要仓库 secret `NPM_TOKEN`（npm → Access Tokens → Automation）；
- `--provenance` 只在 CI 路径可用（Sigstore OIDC），手动发布没有 provenance，属正常。

## 2. GitHub

```sh
git init                                  # 若尚未初始化
git add -A && git commit -m "feat: initial release"
git remote add origin git@github.com:OWNER/dsh-local-file-share.git
git push -u origin main --tags
```

建议在仓库设置里补：描述、Topics（`dsh` `dsh-plugin` `deepseek-harness` `file-system-access`）、
以及 `README` 里的徽章链接。

## 3. Gitee（镜像）

```sh
git remote add gitee git@gitee.com:OWNER/dsh-local-file-share.git
git push gitee main --tags
```

- Gitee 只做**代码镜像 + 国内下载**；npm 包仍发布在 npmjs（市场按 npm 包名安装）；
- 若同时维护两边，建议 GitHub 为唯一真源，Gitee 用 `git push gitee --mirror` 或 Gitee 的
  "仓库镜像"功能自动同步；
- Gitee 的 Release 附件可以挂 `npm pack` 产物（`dsh-local-file-share-0.4.0.tgz`），
  方便用户 `dsh plugin --profile web add file:...tgz` 离线安装。

## 4. 插件市场（dshmarket）

市场的安装来源**只认 curated registry**：[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。
市场页面每次打开都实时拉 `https://awesome-dsh-plugin.com/plugins.json`（curated entries + npm 映射 + star 数），
所以流程是：

1. 先把包**发布到 npm**（市场按 npm 包名安装）；
2. 往 `awesome-dsh-plugin` 仓库提 PR：在合适的分类（如 *Tools & Capabilities*）下加**一条** entry，
   写清 npm 包名、仓库地址与一句话说明；
3. 等 CI 同步（通常一天内），市场与 awesome 站点会自动出现；
4. **不要**往 dshmarket 主仓库提插件条目（它只是市场 App）。

## 5. 版本与兼容性

- 语义化版本：破坏性改动（包名、WS 路径、工具名、存储键）→ major；新功能 → minor；修复 → patch；
- `peerDependencies` 目前钉 `@deepseek-ai/dsh-tools: ^0.1.0-rc.6`：dsh 发布正式版时记得放宽/更新；
- 改包名、WS 路径、工具名或存储键前缀，都必须在 [CHANGELOG.md](../CHANGELOG.md) 里写明
  「需要重启 dsh」「需要重新授权目录」。

## 6. 发布后自检

```sh
npm view dsh-local-file-share version dist.tarball
npm pack --dry-run                      # 确认 files 列表：lib/ locale/ icon.svg cordis.patch.yml README* LICENSE
dsh plugin --profile web add dsh-local-file-share   # 干净 profile 里装一次，重启后授权目录、跑一次 local_file_list
```
