# Local File Share · 本地文件共享

[中文](https://github.com/deepseekharness-dsh/dsh-local-file-share/blob/main/README.md) | [English](https://github.com/deepseekharness-dsh/dsh-local-file-share/blob/main/README.en.md) | [Gitee mirror](https://gitee.com/deepseekharness/dsh-local-file-share)

> Let the dsh agent work directly with files on **your** machine — nothing is copied into the
> container, nothing lands on the server's disk.

- npm: <https://www.npmjs.com/package/dsh-local-file-share>
- GitHub: <https://github.com/deepseekharness-dsh/dsh-local-file-share>
- Gitee: <https://gitee.com/deepseekharness/dsh-local-file-share>
- Curated list: <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>

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
dsh plugin --profile web add github:deepseekharness-dsh/dsh-local-file-share

# 3) from the Gitee mirror (same artifacts)
dsh plugin --profile web add git+https://gitee.com/deepseekharness/dsh-local-file-share.git

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

## Share scope and access

The default is **global sharing + read/write** (identical to 1.0.0 when left untouched). To tighten it,
edit it right on the card:

| Setting | Values | Meaning |
|---|---|---|
| Share scope | **Global** (default) | Every session in this dsh instance may use the three tools |
| | **Selected sessions** | Only the sessions ticked in the list may; the badge in the title row shows the current scope |
| Access | **Read/write** (default) | list, read and write |
| | **Read-only** | list and read only; every write is refused |

Key points:

- **Enforced in three layers**, not merely hinted in the UI: (1) with read-only the authorization asks for
  `mode: 'read'`, so the browser never grants write access at all; (2) the client refuses write frames by
  policy before touching the File System Access API; (3) the host — the single authority — does not
  dispatch a call that the policy forbids, and answers with an error that says what to change.
- **Changes take effect immediately**: the policy lives in your browser
  (`localStorage['dsh-local-file-share:share-policy']`) and travels in the state frame; the host keeps no
  state and a restart does not lose it. **Revoking the authorization clears the policy too** (the next
  authorization starts from the default).
- **Subagents and team members** have their own session ids and are **not** covered automatically by a
  selected-session scope; the list marks them, tick them by hand or stay on *Global*.
- **Non-session callers** (a call not originating from any session) are refused under a selected-session
  scope, with an error explaining how to allow them.
- **In-session chip**: once you switch to *Selected sessions*, a small chip above the composer of every
  session offers one-click "add/remove this session" — the root card cannot know which session is current,
  the chip can. It stays hidden in global mode.
- Upgrading to 1.1.0 needs **no re-authorization**.

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

Maintainer notes: the full checklist lives in [`docs/publishing.md`](https://github.com/deepseekharness-dsh/dsh-local-file-share/blob/main/docs/publishing.md).

1. **npm**: `npm run verify` → bump the version → commit → push a matching tag (e.g. `v1.0.1`).
   GitHub Actions (`.github/workflows/publish.yml`) verifies tag == version, runs the tests and
   publishes. Local manual fallback: see `docs/publishing.md`.
2. **GitHub**: <https://github.com/deepseekharness-dsh/dsh-local-file-share> (primary repository,
   tagged `dsh-plugin`).
3. **Gitee**: <https://gitee.com/deepseekharness/dsh-local-file-share> (code mirror and China-friendly
   distribution; the npm package still lives on npmjs, and the market installs by npm name).
4. **Plugin market**: dshmarket installs **only from the curated
   [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) registry** — open a
   PR there adding `data/plugins/deepseekharness-dsh__dsh-local-file-share.yml`
   (contents in `publish/awesome-dsh-plugin.yml`). Do **not** PR plugin entries against the
   dshmarket repo.

## License and provenance

MIT; upstream attribution and the derived-work note are kept in [`LICENSE`](LICENSE).

This repository is a derivative of [`dsh-browser-fs`](https://github.com/whitefirer/dsh-browser-fs)
by [whitefirer](https://github.com/whitefirer) (MIT): the WebSocket relay protocol, the two-sided
host/client design, the File System Access backend, the highlight chunk, the compat picker and the
multi-device roster all come from upstream. This version adds the rename, a theme-aware visual layer,
interaction and accessibility work, and the WebSocket session check. See [CHANGELOG.md](CHANGELOG.md).
