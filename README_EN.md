# Local File Share · 本地文件共享

[中文](README.md) | **English**

> Let the dsh agent work directly with files on **your** machine — nothing is copied into the
> container, nothing lands on the server's disk.

[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin#tools--capabilities)
[![npm](https://img.shields.io/npm/v/dsh-local-file-share)](https://www.npmjs.com/package/dsh-local-file-share)
[![license: MIT](https://img.shields.io/npm/l/dsh-local-file-share)](LICENSE)

**One floating card, one bridge:** authorize a local directory in the dsh page and the agent can
drive it with three model tools — `local_file_list`, `local_file_read`, `local_file_write`.
Bytes travel in memory over a private WebSocket relay: not a single one is written to the dsh host.

---

## Why

dsh usually runs in a container or on a remote server, so its built-in fs tools only see the host
machine — while your documents, drawings, manuals and code live on **your** machine. Copying a whole
directory into the container is slow and expensive (a single installer image can be 15 GiB).

The browser, however, can see both sides, so it becomes the bridge:

```
local disk ──File System Access API──► your browser tab
                                         │  private WebSocket (same-origin + session check)
                                         ▼
                              dsh host process (in-memory relay)
                                         │
                                         ▼
                        the agent's three tools: list / read / write
```

## Features

| | |
|---|---|
| **Zero footprint** | No disk writes, no cache, no copies — only the memory of one open tab |
| **Floating card** | A 40px orb (theme-aware SVG icon + status dot) that expands into the full panel; draggable, resizable via the bottom handle, position and height remembered locally |
| **Theme-aware** | Every surface uses dsh's `--dsw-alias-*` tokens, so light and dark match the host; full `prefers-reduced-motion` fallback |
| **Keyboard ready** | The title row is focusable; arrow keys move the card (`Shift` to speed up), `Esc` collapses, double-click collapses; the status line is announced via `aria-live` |
| **Directory tree** | Lazy loading, recursive search, hover-revealed "copy path"; click a file name for a preview window (images / text / syntax-highlighted code) |
| **Read and write** | In full mode, text and code can be edited and saved back to your machine from the preview window; compat mode degrades to read-only |
| **Multi-device** | Every connected device authorizes its own directory; tool results carry the executing device label (e.g. `device: Windows · Chrome`) |
| **Secure** | The WebSocket upgrade validates same-origin *and* the browser session (`connection.requestRejection`), answering 401/403 otherwise; no third-party service involved |

## UI

- **Collapsed** — the orb in the bottom-right corner; its status dot encodes connection/authorization
  state (green = authorized, amber = pending, grey = none/offline).
- **Expanded** — status line, editable device nickname, action buttons, the "directory contents" tree,
  and a bottom height handle.
- **Preview window** — pinned header (name / size / edit / close), a path row and an independently
  scrolling body; draggable and resizable.

> Screenshot: `docs/screenshot-upstream.png` shows the upstream (`dsh-browser-fs`) UI for reference;
> a fresh screenshot of this theme-aware version is still to be added.

## How it works

A two-sided cordis plugin:

- **Host half** (`src/index.ts`, in the dsh host's Node process)
  - registers the exact WebSocket path `/local-file-share/ws` via `ctx.webServer.registerUpgrade`;
  - registers `local_file_list` / `local_file_read` / `local_file_write` on `ctx.tools`;
  - sends `{type:'call', rpcId, op, args}` frames to the tab that **holds a handle**, pairing result
    frames by `rpcId`; `exec.signal` drives aborts (a cancel frame goes to the browser too);
  - serves the lazy syntax-highlight chunk at the sibling route `/local-file-share/highlight.mjs`.
- **Client half** (`src/client/`, in the browser)
  - restores the directory handle from IndexedDB and calls `queryPermission` on start, then connects
    back to the host WebSocket with exponential-backoff reconnects;
  - executes File System Access operations for incoming call frames and replies with result frames;
  - registers the floating card in `shell.overlay` and broadcasts `{type:'state', hasHandle, dirName, label}`;
  - when several tabs are online, the host only dispatches to `hasHandle=true` tabs.

## Install

```sh
# 1) from npm (recommended: no install scripts, no build approval)
dsh plugin --profile web add dsh-local-file-share

# 2) straight from GitHub (lib/ artifacts are committed; still zero scripts)
dsh plugin --profile web add github:OWNER/dsh-local-file-share

# 3) from the Gitee mirror (same artifacts)
dsh plugin --profile web add git+https://gitee.com/OWNER/dsh-local-file-share.git

# 4) local development: rebuild then reinstall (lib/ is committed)
npm install && npm run verify
dsh plugin --profile web add file:/abs/path/to/dsh-local-file-share
```

**Restart dsh afterwards** (the host half must reload its module and routes), then reopen the page to
see the orb in the bottom-right corner.

## Quick start

1. Open the dsh web page → the orb → **Authorize directory** → pick a directory in the system dialog.
   The browser asks for **read/write** permission (the plugin requests `mode: 'readwrite'`) — if the
   agent should only read, simply never ask it to write.
2. Tell the agent *"list what's inside my authorized directory"* and it calls `local_file_list`.
3. From there: read a file (`local_file_read`), write or create one (`local_file_write`), or click a
   file name in the card to preview it yourself.

## Tool reference

| Tool | Arguments | Returns |
|---|---|---|
| `local_file_list` | `path?` (relative to the authorized root; omit for the root), `recursive?` (default false) | Directory entries: relative path, kind, size (all levels when recursive) |
| `local_file_read` | `path` (required), `maxBytes?` (default 256 KiB, truncation is marked) | UTF-8 text content |
| `local_file_write` | `path`, `content` (parent directories created; existing files overwritten) | Number of bytes written |

All three descriptions state plainly that they operate on **the browser machine's local disk, not the
dsh host**. With several devices holding handles, results name the executing device.

## Security model

- **Scope**: only the directory you selected (and its subtree) is reachable; paths outside it are not.
- **Permission semantics**: the plugin requests `readwrite`; a write happens only when you (or the
  agent) explicitly ask for one. The File System Access API does not let a plugin re-authorize without
  a user gesture.
- **Connection checks**: the WebSocket upgrade verifies same-origin (`Origin` matching `Host`) *and*
  the browser session (`connection.requestRejection`), closing with 401/403 otherwise — another site
  cannot ride on your session.
- **Data path**: bytes move only between your browser and your dsh host; no third-party service is used.
- **The page must be online**: with no tab connected, tool calls fail immediately with a clear error
  instead of hanging.

## Compatibility and limits

| | Full mode | Compat mode (automatic) |
|---|---|---|
| Trigger | HTTPS or `localhost` (secure context) | plain-HTTP LAN access, etc. |
| Selection | `showDirectoryPicker` system picker | `input[webkitdirectory]` directory / multi-file picker |
| list / read | ✅ | ✅ (read-only snapshot) |
| write | ✅ | ❌ explicit error |
| Persistence | ✅ IndexedDB, restored after reload | ❌ re-select after reload |

- **A handle expiring on reload** is the browser's security model (permissions are not always
  persistent), not a bug;
- **Cross-origin iframes** cannot open the directory picker — authorize from the top-level page (the
  card offers a direct link);
- **Mobile**: some browsers (e.g. Huawei) report the picker as available but ignore the tap; the plugin
  falls back to the compat multi-file entry;
- Text (UTF-8) only for read/write; binary writes are out of scope and images are preview-only.

## Development

```sh
npm install
npm run build       # node build.mjs → lib/ (host ESM + client CJS closure + highlight chunk)
npm run typecheck   # tsc --noEmit
npm run smoke       # protocol round trip / abort / disconnect / cross-origin refusal / pure geometry
npm run verify      # all three (also wired to prepublishOnly)
```

**`lib/` is committed**: always `npm run build` before committing, or you ship stale code.

`src/client/` map:

| File | Responsibility |
|---|---|
| `index.ts` | client entry, WS reconnect, frame dispatch, card data source |
| `ui.tsx` | floating card / directory tree / preview window (React JSX) |
| `styles.ts` | theme-aware style layer (injected stylesheet + `lfs-` class system) |
| `fs.ts` / `files-backend.ts` | File System Access operations and backend abstraction |
| `store.ts` | IndexedDB handle storage |
| `preview.ts` / `highlight.ts` | preview classification and syntax highlighting |
| `compat-picker.ts` | fallback picker without the File System Access API |
| `device.ts` / `i18n.ts` | device labels / zh+en strings following dsh's language |
| `panel-fit.ts` | viewport clamping for the floating panel |

## Releasing and publishing

**Replace the placeholder first** (this repo uses `OWNER`):

```sh
grep -rl "OWNER" . --exclude-dir=node_modules --exclude-dir=.git | xargs sed -i 's/OWNER/your-account/g'
```

1. **npm**: bump `package.json`, commit, then push a matching tag (e.g. `v0.3.0`). GitHub Actions
   (`.github/workflows/publish.yml`) publishes with `NPM_TOKEN` and `--provenance`; the workflow
   verifies that the tag equals the package version. Manual fallback: `npm publish --access public`.
2. **GitHub**: create the repository, `git remote add origin …`, `git push -u origin main --tags`.
3. **Gitee (mirror)**: `git remote add gitee git@gitee.com:OWNER/dsh-local-file-share.git` then
   `git push gitee main --tags`. Gitee is a code mirror and China-friendly distribution channel —
   the npm package still lives on npmjs (the market installs by npm name).
4. **Plugin market**: dshmarket installs **only from the curated
   [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) registry** — open a
   PR there adding one entry (npm package name + repository URL) and both the site and the market pick
   it up automatically, usually within a day. Do **not** PR plugin entries against the dshmarket repo.

## License and provenance

MIT; upstream attribution and the derived-work note are kept in [`LICENSE`](LICENSE).

This repository is a derivative of [`dsh-browser-fs`](https://github.com/whitefirer/dsh-browser-fs)
by [whitefirer](https://github.com/whitefirer) (MIT): the WebSocket relay protocol, the two-sided
host/client design, the File System Access backend, the highlight chunk, the compat picker and the
multi-device roster all come from upstream. This version adds the rename, a theme-aware visual layer,
interaction and accessibility work, and the WebSocket session check. See [CHANGELOG.md](CHANGELOG.md).
