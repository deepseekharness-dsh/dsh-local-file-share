# 发布清单（npm · GitHub · Gitee · 插件市场）

> 面向维护者。用户面文档见 [README.md](../README.md)。
> 本仓库的实际账号：GitHub `deepseekharness-dsh`（主仓库）· Gitee `deepseekharness`（镜像）·
> npm 包 `dsh-local-file-share`（发布者 `helihuo919`）。

## 0. 每次发版前的门禁

```sh
cd /root/无分区/dsh-local-file-share
npm run verify     # build + typecheck + smoke
npm test           # node:test：manifest / patch / 产物品牌 / locale / smoke
npm pack --dry-run # 确认 files 清单（lib locale cordis.patch.yml icon.svg README* CHANGELOG LICENSE docs）
```

`lib/` 是入库产物：**任何源码改动都必须先 `npm run build`**，否则发布出去的是旧代码。
**同版本号不能重发** —— 文档类改动也要提一个 patch 版本（`1.0.0` → `1.0.1`）。

## 1. npm

### 首版（1.0.0）

npm 无法为“尚不存在的包名”配置 trusted publisher，所以首版必须手工发布，且必须用
**带 Bypass 2FA 的 granular token**（`npm login` 的会话令牌不算 2FA 凭据，必 403）：

```sh
printf '//registry.npmjs.org/:_authToken=%s\n' "$(cat /tmp/.npm-token)" > /tmp/.npmrc-gat && chmod 600 /tmp/.npmrc-gat
NPM_CONFIG_USERCONFIG=/tmp/.npmrc-gat npm whoami --cache /tmp/npm-cache      # 应为 helihuo919
NPM_CONFIG_USERCONFIG=/tmp/.npmrc-gat npm publish --access public --cache /tmp/npm-cache
```

发布后**立刻在网页端撤销该令牌**（<https://www.npmjs.com/settings/helihuo919/tokens>）。

### 后续版本（OIDC，零令牌）

1. 在 npm 包页 **Settings → Trusted Publishing → Add publisher**：

   | 字段 | 值 |
   |---|---|
   | Publisher | GitHub Actions |
   | Organization or user | `deepseekharness-dsh` |
   | Repository | `dsh-local-file-share` |
   | Workflow filename | `publish.yml`（逐字一致） |
   | Environment name | 留空 |

2. 之后发版：改 `package.json` 版本号 → `npm run verify` → 提交 →
   `git tag vX.Y.Z && git push origin main --tags`（Gitee 也 `git push gitee main --tags`）。
   `.github/workflows/publish.yml` 会校验 tag 与版本号一致、跑 typecheck/build/test，再用 OIDC 发布。

## 2. GitHub（主仓库）

```sh
git remote add origin https://github.com/deepseekharness-dsh/dsh-local-file-share.git
git push -u origin main
git push origin --tags
```

仓库设置：描述（≤350 字符、含检索关键词）、Topics
（`dsh` `dsh-plugin` `deepseek-harness` `cordis` `file-system-access` `websocket` `local-files`）。
Topics 可用 API 设置（需要 PAT 的 `administration: write`）：

```sh
node -e '
const fs=require("fs");const t=fs.readFileSync("/tmp/.github-token","utf8").trim();
const H={Authorization:"Bearer "+t,Accept:"application/vnd.github+json","User-Agent":"dsh"};
const R="https://api.github.com/repos/deepseekharness-dsh/dsh-local-file-share";
(async()=>{
 console.log("description:",(await fetch(R,{method:"PATCH",headers:H,body:JSON.stringify({description:"Local File Share / 本地文件共享: let the dsh agent list, read and write files on the machine running your browser over a private WebSocket relay + File System Access API. Zero bytes copied onto the dsh host."})})).status);
 const r=await fetch(R+"/topics",{method:"PUT",headers:H,body:JSON.stringify({names:["dsh","dsh-plugin","deepseek-harness","cordis","file-system-access","websocket","local-files"]})});
 console.log("topics:",r.status,JSON.stringify((await r.json()).names||{}));})();'
```

## 3. Gitee（镜像）

```sh
GT="$(cat /tmp/.gitee-token)"
git push "https://deepseekharness:${GT}@gitee.com/deepseekharness/dsh-local-file-share.git" main --tags
```

- Gitee **空仓库不能设为公开**：先推送，再 `PATCH private=false`（`PATCH` 必须带 `name`）；
- Gitee 只做代码镜像与国内分发；npm 包仍在 npmjs（市场按 npm 包名安装）；
- 两仓历史根不同时的处理见交接任务书 §3.4 ④（**不要 force push**）。

## 4. 插件市场（dshmarket）

市场的安装来源**只认 curated registry** [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。
流程：① 先发布到 npm → ② 往该仓库提一个“只新增一个文件”的 PR：
`data/plugins/deepseekharness-dsh__dsh-local-file-share.yml`（内容见仓库 `publish/` 目录）→
③ CI 校验通过后合并，站点与市场次日自动同步。

硬性要求（CI 自动检查）：`package.json` 声明 `dsh.bundle`、根目录有 `cordis.patch.yml`、
**仓库创建满 1 天**、有真实代码、仓库带 `dsh-plugin` topic；描述不许营销夸大；
含 `: `（冒号+空格）的 YAML 行要加引号；两个 README 由脚本生成，不要手改。

其余注册表（自动采集，无需手动提）：
[imsai-sh/awesome-deepseek-harness-plugins](https://github.com/imsai-sh/awesome-deepseek-harness-plugins)、
[dshworks/awesome-dsh-plugins](https://github.com/dshworks/awesome-dsh-plugins)、
[kejixiaoliang/awesome-dsh-plugins](https://github.com/kejixiaoliang/awesome-dsh-plugins)。

## 5. 分发件（`dist/`）

| 文件 | 生成方式 |
|---|---|
| `dsh-local-file-share-<ver>.tgz` | `npm pack --pack-destination dist` |
| `dsh-local-file-share-<ver>-source.tar.gz` | `tar --exclude=.git --exclude=node_modules --transform 's,^\.,dsh-local-file-share-<ver>,' -czf … .` |
| `dsh-local-file-share-<ver>-source.zip` | 无 `zip` 命令时用 Node 手写 deflate zip |
| `SHA256SUMS` | `sha256sum` 三件，`sha256sum -c SHA256SUMS` 复核 |

## 6. 发布后自检

```sh
# 注册表元数据
node -e 'fetch("https://registry.npmjs.org/dsh-local-file-share").then(r=>r.json()).then(d=>{const v=d.versions[d["dist-tags"].latest];console.log("latest:",d["dist-tags"].latest,"| files:",v.dist.fileCount,"| dsh.bundle:",JSON.stringify(v.dsh&&v.dsh.bundle),"| keywords:",(v.keywords||[]).length);})'

# tarball 真能装
rm -rf /tmp/inst && mkdir -p /tmp/inst && cd /tmp/inst && printf '{"name":"c","private":true,"version":"0.0.0"}\n' > package.json \
 && npm install --no-audit --no-fund --cache /tmp/npm-cache /root/无分区/dist/dsh-local-file-share-*.tgz \
 && node -e 'const p=require("./node_modules/dsh-local-file-share/package.json");console.log(p.name,p.version,JSON.stringify(p.dsh.bundle))'

# CI 最近三次
node -e 'const fs=require("fs");const H={Authorization:"Bearer "+fs.readFileSync("/tmp/.github-token","utf8").trim(),Accept:"application/vnd.github+json","User-Agent":"dsh"};fetch("https://api.github.com/repos/deepseekharness-dsh/dsh-local-file-share/actions/runs?per_page=3",{headers:H}).then(r=>r.json()).then(d=>d.workflow_runs.forEach(r=>console.log(r.name,r.head_sha.slice(0,7),r.status,r.conclusion)))'
```

## 7. 安全善后（每次用完一次性凭据都要做）

1. 撤销 npm 的 bypass-2FA granular token；GitHub PAT 收窄/吊销；Gitee 私人令牌吊销或换成最小权限；
2. 删除本机临时凭据：`rm -f /tmp/.gitee-token /tmp/.github-token /tmp/.npm-token /tmp/.npmrc /tmp/.npmrc-gat`；
3. 长期方案是 OIDC（§1 后半）；令牌一旦出现在聊天/日志里就视为已泄露，必须重置；
4. **绝不**把令牌写进仓库文件、`git remote` URL、CI secrets 或 README。
