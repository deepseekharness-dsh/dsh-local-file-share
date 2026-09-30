/**
 * 授权入口 UI：注册在 shell.overlay 槽位，但卡片/圆球/预览窗一律
 * createPortal 到 document.body 渲染——shell.overlay 层自身 z-20 的层叠
 * 上下文会封顶内部一切 z-index，压不过应用侧 fixed 层（better-sidebar
 * 面板 z-50/弹件 z-60）；body 级自立层级：卡片/球 z-100、预览窗 z-200，
 * 均低于 dsh 自身模态/toast（1000/1100）。无 Shadow DOM，同层叠上下文
 * 直接比 z-index。默认 fixed 右下角小卡，标题行可作拖拽把手自由定位，
 * 位置存 localStorage 并在拖动结束/窗口 resize 时 clamp 进视口。
 *
 * 两种形态（共用同一 pos 锚点 = 球位/卡片左上角）：
 *  - 展开：状态点 + 目录名 + 授权按钮组 + 「目录内容」懒加载树 + 「—」收起钮；
 *    展开面板从未拖过时以球位为锚推导初始位（允许翻转方向，出界 clamp 进
 *    10px 边距，宽高上限收到视口内）；一旦被拖过就停在拖放处（只 clamp 不
 *    翻转），面板位跨收起/展开与刷新记忆（与锚点同一个 localStorage key）；
 *  - 收起：36px 圆钮（📁 + 状态点），点一下展开；圆球同样按住可拖（与卡片
 *    把手同一套 4px 阈值 + window 全程监听逻辑，不移动就松手才当点击）。
 *    折叠状态由 apply 闭包持久化到 localStorage（本文件只读快照）。
 *
 * 目录树状态（展开集合/已加载层级）是组件内的 useState —— 纯 viewing state，
 * 不进共享快照；rootVersion 作 key，换目录/解除授权时整树重置。文件名可点击
 * 弹出预览窗（FilePreview：固定尺寸窗口 + 钉顶标题栏；图片走 blob URL，文本
 * 取前 64KB，已映射语言经懒加载高亮 chunk 做语法着色）；授权行的「↻」
 * 刷新按钮经 apiRef 调 DirTree 的清缓存重拉（兼容模式改为重开选择器）。
 * @module dsh-local-file-share/client/ui
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, ReactElement } from 'react'
import { DEFAULT_HIGHLIGHT_PATH, type RosterExecutor, type SharePolicy } from '../wire.js'
import type { FsBackend } from './fs.js'
import { STRINGS, type Lang, type Strings } from './i18n.js'
import { FAB_SIZE, clampPanelToViewport, fitPanelToViewport } from './panel-fit.js'
import { ensureStyles } from './styles.js'
import {
  MAX_IMAGE_PREVIEW_BYTES,
  TEXT_PREVIEW_BYTES,
  imageMimeFor,
  langFor,
  looksBinary,
  previewKindFor,
} from './preview.js'

/** 卡片可见的全部状态（apply 闭包里的单一数据源）。 */
export interface BrowserFsState {
  /** 到 host 半的 WS 是否在线。 */
  wsConnected: boolean
  /** 当前目录句柄的 readwrite 权限状态；none 表示尚未选过目录。 */
  permission: 'none' | 'prompt' | 'granted' | 'denied'
  /** 已授权根目录名（兼容模式为所选目录/「N 个文件」）。 */
  dirName: string | null
  /** 授权交互进行中（系统选择器/权限弹窗开着）。 */
  busy: boolean
  /** 最近一次授权错误。 */
  error: string | null
  /** 卡片是否折叠成圆钮。 */
  collapsed: boolean
  /** 当前文件后端（完整模式句柄 / 兼容模式 File 映射；未授权为 null）。 */
  backend: FsBackend | null
  /** 后端代际：每次换目录/解除授权 +1，作目录树的重置 key。 */
  rootVersion: number
  /** 生效中的设备标签（昵称 ?? UA 派生）。 */
  label: string
  /** 用户设置的昵称（null 表示用 UA 派生）。 */
  nickname: string | null
  /** host 广播的执行者名单（仅持有授权的设备；本机持柄时也含本机）。 */
  executors: RosterExecutor[]
  /** showDirectoryPicker 是否可用（特性检测结果；false 即兼容模式语境）。 */
  pickerAvailable: boolean
  /** 当前是否处于兼容模式（File 映射、只读、无持久化）。 */
  compat: boolean
  /** 当前 UI 语言（跟随 dsh 页面的 <html lang>）。 */
  lang: Lang
  /** 当前共享策略（共享范围 + 读写权限）。 */
  policy: SharePolicy
}

/** 卡片动作（授权必须经过用户手势，全部挂按钮点击）。 */
export interface CardActions {
  /** 完整模式：请求权限/弹目录选择器；兼容模式：弹 input 选目录。 */
  authorize(): void
  /** 换一个新目录（两模式各自的选择器）。 */
  pickNew(): void
  /** 清除授权/兼容选择，回到未授权状态。 */
  revoke(): void
  /** 收起成圆钮 / 展开回卡片。 */
  toggleCollapsed(): void
  /** 保存共享策略（共享范围 + 读写权限），即时生效并广播给 host。 */
  setPolicy(policy: SharePolicy): void
  /** 设置设备昵称（空串清除，回落 UA 派生）。 */
  setDeviceName(name: string): void
  /** 兼容模式：选目录（webkitdirectory；有失效前科时自动退多选）。 */
  pickCompatDir(): void
  /** 兼容模式：多选文件（multiple）。 */
  pickCompatFiles(): void
  /** 兼容模式 ↻ 刷新：按上次成功选择的形态重开选择器。 */
  pickCompatRefresh(): void
}

/** 卡片数据源：订阅 + 快照 + 动作。 */
export interface CardSource {
  subscribe(listener: () => void): () => void
  getSnapshot(): BrowserFsState
  readonly actions: CardActions
}

/**
 * 卡片定位与尺寸。外观（surface/边框/圆角/阴影/字体）一律见 styles.ts 的
 * `.lfs-card`：内联样式表达不了 :hover / :focus-visible / 媒体查询，视觉留在
 * 样式表里才能跟主题、能键盘操作；这里只负责定位与尺寸约束。
 */
const cardStyle: CSSProperties = {
  position: 'fixed',
  right: '16px',
  bottom: '16px',
  // 层级调研（2026-08 真机）：shell.overlay 层本身 z-20，better-sidebar 面板
  // fixed z-50/弹件 z-60 会盖住层内任何值——故卡片 portal 到 body 自立层级。
  // 100：压过侧边栏（50/60），远低于 dsh 自身模态/toast（1000/1100）。
  zIndex: 100,
  pointerEvents: 'auto',
  minWidth: '248px',
  maxWidth: '352px',
}

/** 按钮外观统一由 `.lfs-btn` 承担，组件里不再保留内联按钮样式。 */

/** 收起后的圆钮（层级与卡片同档，见 cardStyle 注释）；尺寸跟随 FAB_SIZE。 */
const fabStyle: CSSProperties = {
  position: 'fixed',
  right: '16px',
  bottom: '16px',
  zIndex: 100,
  pointerEvents: 'auto',
  width: `${String(FAB_SIZE)}px`,
  height: `${String(FAB_SIZE)}px`,
}

/** 状态点配色：跟随主题 token，token 缺失（兼容模式）时退回旧版硬编码色。 */
function statusColor(state: BrowserFsState): string {
  if (!state.wsConnected) return 'var(--dsw-alias-state-idle-primary, #9aa0a6)'
  if (state.permission === 'granted') return 'var(--dsw-alias-state-success-primary, #34a853)'
  if (state.permission === 'none') return 'var(--dsw-alias-state-idle-primary, #9aa0a6)'
  return 'var(--dsw-alias-state-warn-primary, #fbbc04)'
}

function statusText(state: BrowserFsState, s: Strings): string {
  if (!state.wsConnected) return s.statusNoHost
  switch (state.permission) {
    case 'granted': return state.compat
      ? s.statusGrantedCompat(state.dirName ?? '', state.label)
      : s.statusGranted(state.dirName ?? '', state.label)
    case 'prompt': return s.statusPrompt
    case 'denied': return s.statusDenied
    case 'none': {
      // 本机没授权但 roster 里有持柄设备：告诉用户授权落在哪台设备上。
      if (state.executors.length > 0) {
        const whom = state.executors
          .map(executor => `${executor.label}${executor.dirName === null ? '' : `（${executor.dirName}）`}`)
          .join('、')
        return s.statusGrantElsewhere(whom)
      }
      return s.statusNone
    }
  }
}

/** 圆钮右上角的状态点（与卡片标题行同一配色语义）。 */
function StatusDot({ color }: { color: string }): ReactElement {
  return (
    <span
      className="lfs-dot"
      style={{ position: 'absolute', top: '-1px', right: '-1px', background: color }}
    />
  )
}

/** 圆钮图标：内联 SVG 取代 emoji —— 颜色/线宽跟随主题，跨平台渲染一致。 */
function FolderIcon(): ReactElement {
  return (
    <svg
      width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2c.7 0 1.36.3 1.83.83l1.1 1.24c.46.53 1.13.83 1.82.83h4.05A2.5 2.5 0 0 1 20 10.4v6.1A2.5 2.5 0 0 1 17.5 19h-12A2.5 2.5 0 0 1 3 16.5z" />
    </svg>
  )
}

// ---------- 共享范围：会话列表 ----------

/** `useSessions` 契约里本文件用到的最小面（SessionListState 的宽松视图）。 */
interface SessionListLike {
  ids?: unknown
  byId?: unknown
}

/** 一行会话（共享范围列表用）。 */
interface SessionRow {
  id: string
  title: string
  short: string
  running: boolean
  subagent: boolean
}

const EMPTY_SESSION_ROWS: readonly SessionRow[] = []

/** 会话短显示：`session-1a2b3c4d…` → `1a2b3c4d`。 */
function shortSession(id: string): string {
  const trimmed = id.startsWith('session-') ? id.slice('session-'.length) : id
  return trimmed.length > 8 ? trimmed.slice(0, 8) : trimmed
}

/**
 * 把 `SessionListState` 投影成列表行：标题优先 `displayTitle`，其次 `title`，最后 id；
 * `origin === 'subagent'` 或带 `parentId` 的标为子代理（提醒用户白名单不自动覆盖它们）。
 * @param snapshot - `useSessions` 选出的列表快照。
 * @returns 列表行（无快照时为空数组）。
 */
function sessionRows(snapshot: SessionListLike | null | undefined): readonly SessionRow[] {
  if (snapshot === null || snapshot === undefined) return EMPTY_SESSION_ROWS
  const ids = Array.isArray(snapshot.ids) ? snapshot.ids : []
  const byId = (typeof snapshot.byId === 'object' && snapshot.byId !== null ? snapshot.byId : {}) as Record<string, {
    displayTitle?: unknown
    title?: unknown
    running?: unknown
    parentId?: unknown
    origin?: unknown
  }>
  const rows: SessionRow[] = []
  for (const rawId of ids) {
    if (typeof rawId !== 'string') continue
    const row = byId[rawId]
    const title = typeof row?.displayTitle === 'string' && row.displayTitle !== ''
      ? row.displayTitle
      : (typeof row?.title === 'string' && row.title !== '' ? row.title : rawId)
    rows.push({
      id: rawId,
      title,
      short: shortSession(rawId),
      running: row?.running === true,
      subagent: row?.origin === 'subagent' || typeof row?.parentId === 'string',
    })
  }
  return rows
}

/**
 * 订阅会话列表。`shell.overlay` 的标准 props 里恒有 `useSessions`（见槽位目录），
 * 但为兼容缺失该 hook 的上下文，这里做了存在性判断 —— 同一槽位内该判断稳定，
 * 因此 hooks 调用顺序不会变化。选择器返回快照本身（引用稳定），避免每次渲染新数组。
 * @param props - 槽位注入的 props。
 * @returns 会话列表行。
 */
function useSessionRows(props: unknown): readonly SessionRow[] {
  const hook = (props as { useSessions?: unknown } | null | undefined)?.useSessions
  if (typeof hook !== 'function') return EMPTY_SESSION_ROWS
  const snapshot = (hook as (selector: (state: SessionListLike) => SessionListLike) => SessionListLike)(state => state)
  return sessionRows(snapshot)
}

// ---------- 目录内容树 ----------

/** 每级条目上限。 */
const LEVEL_LIMIT = 200

interface TreeNode {
  name: string
  /** 相对授权根的路径。 */
  path: string
  kind: 'file' | 'directory'
  size?: number
}

/** 搜索结果的扁平条目（来自 backend.list 的递归扫描）。 */
interface SearchEntry {
  path: string
  kind: 'file' | 'directory'
  size?: number
}

interface LevelData {
  entries: TreeNode[]
  total: number
}

function humanSize(size: number): string {
  if (size < 1024) return `${String(size)} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

// ---------- 文件预览层 ----------

/** 预览内容状态机（加载中/各类结果/错误）。 */
type PreviewResult =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'too-big'; size: number }
  | { status: 'binary'; size: number }
  | { status: 'image'; url: string; size: number }
  /** highlighting=true：语言已映射，高亮 chunk 加载中（先出纯文本，到位后换 code）。 */
  | { status: 'text'; text: string; size: number; truncated: boolean; highlighting?: boolean }
  | { status: 'code'; html: string; size: number; truncated: boolean }

/** 高亮 chunk（lib/highlight.mjs）的导出契约。 */
interface HighlightModule {
  highlightCode(code: string, lang: string): string
}

/**
 * 按需加载语法高亮 chunk：模块级缓存 import Promise，只拉一次；失败也缓存
 * （路由缺失是持续状态，后续预览直接退回纯文本，不反复打请求）。
 * 绝对路径 specifier esbuild 在 cjs 产物里同样原样保留 import()（已实测）。
 */
let highlightModulePromise: Promise<HighlightModule> | null = null
function loadHighlighter(): Promise<HighlightModule> {
  highlightModulePromise ??= import(DEFAULT_HIGHLIGHT_PATH) as Promise<HighlightModule>
  return highlightModulePromise
}

/** 遮罩：只留定位与布局，配色见 `.lfs-mask`（主题 token + 半透明压暗）。 */
const previewMaskStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  // 预览窗压过卡片/球（100），仍低于 dsh 自身模态（1000）。
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

/** 预览窗可拖动/缩放时的最小尺寸。 */
const MIN_PREVIEW_WIDTH = 320
const MIN_PREVIEW_HEIGHT = 200

/** 预览窗：布局/尺寸留在这里，surface/圆角/阴影/字体见 `.lfs-preview`。 */
const previewCardStyle: CSSProperties = {
  // 窗口形态：默认尺寸不随内容伸缩；flex 列布局，标题栏钉顶、内容区独立滚动。
  // 实际 left/top/width/height 由组件内 win state 控制，这里只保留基础样式。
  width: 'min(720px, 92vw)',
  height: 'min(70vh, 560px)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  padding: 0,
}

/**
 * 文件预览层：遮罩 + 固定尺寸窗口（min(720px,92vw) × min(70vh,560px)，不随
 * 内容伸缩）。标题栏钉顶不滚动：文件名（左，过长截断）+ 大小/截断标注（中）
 * + ✕（右）；其下是相对路径行；内容区独立滚动。图片（按扩展名）读
 * arrayBuffer 建 blob URL 用 <img> 展示（>8MB 不拉取，直接提示太大）；其余
 * 按文本只取前 64KB UTF-8 解码，等宽 <pre> 展示；解码后含 NUL 视为二进制。
 * 文本经 langFor 映射到语言时再做语法着色（高亮 chunk 按需加载，loading 态
 * 先出纯文本，失败退回纯文本）。
 * 文本/代码预览支持编辑（仅完整模式后端可写）：点「编辑」会载入完整文件内容
 * 到 textarea（左侧行号 + 透明 textarea 叠加高亮 <pre>，随输入同步重算语法着色），
 * 保存走 FsBackend.write（兼容模式只读，不显示编辑入口）；保存后重新拉取预览。
 * 编辑态下 ESC 先退出编辑，再按一次才关闭窗口。
 * ✕ / 点遮罩 / ESC 关闭，关闭（卸载）时 revokeObjectURL。
 * @param props.backend - 当前文件后端（两模式同路径，readBlob 各自实现）。
 * @param props.path - 相对授权根的文件路径。
 * @param props.onClose - 关闭回调。
 */
function FilePreview({ backend, path, onClose, s }: { backend: FsBackend; path: string; onClose(): void; s: Strings }): ReactElement {
  const [result, setResult] = useState<PreviewResult>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  /** 组件卸载后不再触发 setState（异步读全文/保存可能跨关闭）。 */
  const aliveRef = useRef(true)
  /** 编辑态语法高亮：透明 textarea 叠加高亮 <pre>，需要同步滚动。 */
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const highlightPreRef = useRef<HTMLPreElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)
  const [editHtml, setEditHtml] = useState<string | null>(null)
  const [editHighlightFailed, setEditHighlightFailed] = useState(false)
  /** 预览窗位置/尺寸（初始居中，之后由拖拽/缩放更新）。 */
  const [win, setWin] = useState(() => {
    const width = Math.min(720, Math.max(MIN_PREVIEW_WIDTH, window.innerWidth * 0.92), window.innerWidth)
    const height = Math.min(560, Math.max(MIN_PREVIEW_HEIGHT, window.innerHeight * 0.7), window.innerHeight)
    return {
      left: Math.max(0, Math.floor((window.innerWidth - width) / 2)),
      top: Math.max(0, Math.floor((window.innerHeight - height) / 2)),
      width,
      height,
    }
  })
  /** 预览窗拖拽/缩放手势状态。 */
  const previewDragRef = useRef<{
    type: 'move' | 'resize'
    startX: number
    startY: number
    startLeft: number
    startTop: number
    startWidth: number
    startHeight: number
  } | null>(null)
  const previewDragCleanupRef = useRef<(() => void) | null>(null)
  const name = path.split('/').pop() ?? path

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    void (async () => {
      try {
        const blob = await backend.readBlob(path)
        if (previewKindFor(path) === 'image') {
          if (blob.size > MAX_IMAGE_PREVIEW_BYTES) {
            if (!cancelled) setResult({ status: 'too-big', size: blob.size })
            return
          }
          const buffer = await blob.arrayBuffer()
          objectUrl = URL.createObjectURL(new Blob([buffer], { type: imageMimeFor(path) }))
          if (!cancelled) setResult({ status: 'image', url: objectUrl, size: blob.size })
        } else {
          const truncated = blob.size > TEXT_PREVIEW_BYTES
          const text = await (truncated ? blob.slice(0, TEXT_PREVIEW_BYTES) : blob).text()
          if (cancelled) return
          if (looksBinary(text)) {
            setResult({ status: 'binary', size: blob.size })
            return
          }
          const lang = langFor(path)
          if (lang === null) {
            setResult({ status: 'text', text, size: blob.size, truncated })
            return
          }
          // 已映射语言：先出纯文本（标注着色加载中），chunk 到位后对截断文本
          // 着色并换成 code 态；加载/着色失败静默退回纯文本。
          setResult({ status: 'text', text, size: blob.size, truncated, highlighting: true })
          try {
            const mod = await loadHighlighter()
            const html = mod.highlightCode(text, lang)
            if (!cancelled) setResult({ status: 'code', html, size: blob.size, truncated })
          } catch {
            if (!cancelled) setResult({ status: 'text', text, size: blob.size, truncated })
          }
        }
      } catch (error) {
        if (!cancelled) {
          setResult({ status: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
    }
  }, [backend, path, reloadToken])

  useEffect(() => () => {
    aliveRef.current = false
    previewDragCleanupRef.current?.()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (editing) {
          setEditing(false)
          setEditError(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose, editing])

  /** 文本/代码结果且后端可写时，显示编辑入口。 */
  const canEdit = (result.status === 'text' || result.status === 'code') && !backend.readOnly

  /** 进入编辑：重新读完整文件（预览只展示前 64KB，编辑必须载入全文）。 */
  const startEdit = async (): Promise<void> => {
    setEditing(true)
    setEditLoading(true)
    setEditError(null)
    try {
      const blob = await backend.readBlob(path)
      const fullText = await blob.text()
      if (!aliveRef.current) return
      if (looksBinary(fullText)) {
        setEditError(s.binary(humanSize(blob.size)))
        return
      }
      setDraft(fullText)
    } catch (error) {
      if (aliveRef.current) {
        setEditError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (aliveRef.current) setEditLoading(false)
    }
  }

  /** 保存：用 textarea 全文覆盖目标文件，成功后重新拉取预览。 */
  const save = async (): Promise<void> => {
    if (backend.readOnly || saving || editLoading) return
    setSaving(true)
    setEditError(null)
    try {
      await backend.write({ path, content: draft }, new AbortController().signal)
      if (!aliveRef.current) return
      setEditing(false)
      setDraft('')
      setEditError(null)
      setResult({ status: 'loading' })
      setReloadToken(token => token + 1)
    } catch (error) {
      if (aliveRef.current) {
        setEditError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (aliveRef.current) setSaving(false)
    }
  }

  /** 编辑态语法高亮：仅在已映射语言且全文载入后，随 draft 变化重算。 */
  useEffect(() => {
    if (!editing || editLoading || editError !== null) {
      setEditHtml(null)
      setEditHighlightFailed(false)
      return
    }
    const lang = langFor(path)
    if (lang === null) {
      setEditHtml(null)
      setEditHighlightFailed(false)
      return
    }
    let cancelled = false
    setEditHighlightFailed(false)
    // 轻量防抖：连续输入时不每次立刻重算整文件高亮。
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const mod = await loadHighlighter()
          if (cancelled) return
          setEditHtml(mod.highlightCode(draft, lang))
        } catch {
          if (!cancelled) setEditHighlightFailed(true)
        }
      })()
    }, 120)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [editing, editLoading, editError, path, draft])

  /** 编辑态行号：按当前 draft 计算，空文件也保留第 1 行。 */
  const lineCount = Math.max(1, draft.split('\n').length)
  const lineNumbers = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join('\n')
  const lineGutterWidth = `calc(${String(Math.max(2, String(lineCount).length))}ch + 16px)`

  /** textarea 滚动时让背后高亮层与左侧行号同步滚动，保证文字、高亮、行号对齐。 */
  const syncEditScroll = (): void => {
    const textarea = textareaRef.current
    const pre = highlightPreRef.current
    const gutter = gutterRef.current
    if (textarea === null) return
    if (pre !== null) {
      pre.scrollTop = textarea.scrollTop
      pre.scrollLeft = textarea.scrollLeft
    }
    if (gutter !== null) gutter.scrollTop = textarea.scrollTop
  }

  /** 将预览窗位置限制在视口内（尺寸大于视口时允许贴左/贴上）。 */
  const clampPreviewWin = (left: number, top: number, width: number, height: number): { left: number; top: number; width: number; height: number } => {
    const maxLeft = Math.max(0, window.innerWidth - width)
    const maxTop = Math.max(0, window.innerHeight - height)
    return {
      left: Math.min(Math.max(left, 0), maxLeft),
      top: Math.min(Math.max(top, 0), maxTop),
      width,
      height,
    }
  }

  /** 预览窗拖动/缩放：window 级监听，移动/缩放过程中持续 clamp 在视口内。 */
  const startPreviewDrag = (event: React.PointerEvent<HTMLElement>, type: 'move' | 'resize'): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (type === 'move') {
      const target = event.target as HTMLElement
      if (target.closest('button') !== null) return
    }
    previewDragCleanupRef.current?.()
    const drag = {
      type,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: win.left,
      startTop: win.top,
      startWidth: win.width,
      startHeight: win.height,
    }
    previewDragRef.current = drag
    const onMove = (e: PointerEvent): void => {
      if (previewDragRef.current !== drag) return
      if (drag.type === 'move') {
        setWin(prev => clampPreviewWin(
          drag.startLeft + e.clientX - drag.startX,
          drag.startTop + e.clientY - drag.startY,
          prev.width,
          prev.height,
        ))
      } else {
        const width = Math.min(
          Math.max(drag.startWidth + e.clientX - drag.startX, MIN_PREVIEW_WIDTH),
          window.innerWidth - drag.startLeft,
        )
        const height = Math.min(
          Math.max(drag.startHeight + e.clientY - drag.startY, MIN_PREVIEW_HEIGHT),
          window.innerHeight - drag.startTop,
        )
        setWin(prev => ({ ...prev, width, height }))
      }
    }
    const finish = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
      previewDragCleanupRef.current = null
      previewDragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', finish)
    previewDragCleanupRef.current = finish
  }

  /** 标题栏中部标注：大小 + 截断（加载中/错误无标注）。 */
  const meta = ((): string => {
    switch (result.status) {
      case 'image':
      case 'too-big': return s.metaImage(humanSize(result.size))
      case 'text':
      case 'code': return `${humanSize(result.size)}${result.truncated ? ` · ${s.metaTruncated}` : ''}`
      case 'binary': return humanSize(result.size)
      default: return ''
    }
  })()

  // 预览窗同样 portal 到 body（与卡片同一层级策略，z-200 压过卡片 z-100）。
  const appliedPreviewCardStyle: CSSProperties = {
    ...previewCardStyle,
    position: 'absolute',
    left: `${String(win.left)}px`,
    top: `${String(win.top)}px`,
    width: `${String(win.width)}px`,
    height: `${String(win.height)}px`,
  }
  return createPortal(
    <div className="lfs-mask" style={previewMaskStyle} onClick={onClose}>
      <div className="lfs-preview" style={appliedPreviewCardStyle} onClick={(event) => { event.stopPropagation() }}>
        {/* 固定标题栏：文件名（左，过长截断）+ 大小/截断标注（中）+ ✕（右钉住），不随内容滚动。 */}
        <div className="lfs-preview-head">
          <div
            className="lfs-preview-handle"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', touchAction: 'none', userSelect: 'none' }}
            title={s.moveTip}
            onPointerDown={(event) => { startPreviewDrag(event, 'move') }}
          >
            <strong className="lfs-title lfs-name" style={{ flex: 1, minWidth: 0 }} title={path}>📄 {name}</strong>
            {meta !== '' && (
              <span className="lfs-size" style={{ fontSize: '11px', whiteSpace: 'nowrap', flexShrink: 0 }}>{meta}</span>
            )}
            {editing ? (
              <>
                <button
                  className="lfs-btn lfs-btn--mini"
                  onClick={() => { void save() }}
                  disabled={saving || editLoading || editError !== null}
                  title={s.save}
                >
                  {saving ? s.saving : s.save}
                </button>
                <button
                  className="lfs-btn lfs-btn--mini"
                  onClick={() => {
                    setEditing(false)
                    setEditError(null)
                  }}
                  disabled={saving}
                  title={s.cancel}
                >
                  {s.cancel}
                </button>
              </>
            ) : canEdit && (
              <button
                className="lfs-btn lfs-btn--mini"
                onClick={() => { void startEdit() }}
                title={s.edit}
              >
                ✏️ {s.edit}
              </button>
            )}
            <button
              className="lfs-btn lfs-btn--icon"
              onClick={onClose}
              title={s.closeTip}
              aria-label={s.closeTip}
            >
              ✕
            </button>
          </div>
          <div className="lfs-preview-path lfs-name" title={path}>
            {path}
          </div>
        </div>
        {/* 内容区独立滚动（minHeight:0 让 flex 子项可收缩出滚动条）。 */}
        <div className="lfs-preview-body">
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: '8px' }}>
              {editLoading ? (
                <span style={{ opacity: 0.6 }}>{s.loading}</span>
              ) : (
                <>
                  <div style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%' }}>
                    <div
                      ref={gutterRef}
                      aria-hidden="true"
                      style={{
                        flexShrink: 0, overflow: 'hidden', boxSizing: 'border-box',
                        minWidth: lineGutterWidth,
                        padding: '9px 8px 9px 8px',
                        background: 'rgba(0,0,0,0.25)',
                        textAlign: 'right', color: 'rgba(255,255,255,0.35)',
                        fontFamily: 'monospace', fontSize: '11px', lineHeight: 1.5,
                        userSelect: 'none',
                      }}
                    >
                      <pre style={{ margin: 0, fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit', whiteSpace: 'pre', textAlign: 'right' }}>
                        {lineNumbers}
                      </pre>
                    </div>
                    <div style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0 }}>
                      <pre
                        ref={highlightPreRef}
                        aria-hidden="true"
                        className="hljs"
                        style={{
                          position: 'absolute', inset: 0, margin: 0,
                          boxSizing: 'border-box', padding: '8px',
                          border: '1px solid rgba(255,255,255,0.25)', borderRadius: '6px',
                          background: 'rgba(0,0,0,0.25)', color: '#e8eaed',
                          fontFamily: 'monospace', fontSize: '11px', lineHeight: 1.5,
                          whiteSpace: 'pre', overflow: 'hidden', pointerEvents: 'none',
                          tabSize: 2,
                        }}
                      >
                        {editHtml !== null && !editHighlightFailed
                          ? <code style={{ fontFamily: 'inherit' }} dangerouslySetInnerHTML={{ __html: editHtml }} />
                          : draft}
                      </pre>
                      <textarea
                        ref={textareaRef}
                        value={draft}
                        onChange={(event) => { setDraft(event.target.value) }}
                        onScroll={syncEditScroll}
                        disabled={saving}
                        wrap="off"
                        spellCheck={false}
                        style={{
                          position: 'absolute', inset: 0,
                          width: '100%', height: '100%', boxSizing: 'border-box',
                          resize: 'none', background: 'transparent',
                          border: '1px solid rgba(255,255,255,0.25)', borderRadius: '6px',
                          color: 'transparent', caretColor: '#e8eaed',
                          fontFamily: 'monospace', fontSize: '11px', lineHeight: 1.5,
                          padding: '8px', whiteSpace: 'pre', overflow: 'auto',
                          outline: 'none', zIndex: 1, tabSize: 2,
                        }}
                      />
                    </div>
                  </div>
                  {(result.status === 'text' || result.status === 'code') && result.truncated && (
                    <div style={{ opacity: 0.6, fontSize: '11px' }}>{s.editFullFile}</div>
                  )}
                </>
              )}
              {editError !== null && <span style={{ color: '#f28b82' }}>{editError}</span>}
            </div>
          ) : (
            <>
              {result.status === 'loading' && <span style={{ opacity: 0.6 }}>{s.loading}</span>}
              {result.status === 'error' && <span style={{ color: '#f28b82' }}>{result.message}</span>}
              {result.status === 'too-big' && (
                <span style={{ opacity: 0.85 }}>{s.tooBig(humanSize(result.size))}</span>
              )}
              {result.status === 'binary' && (
                <span style={{ opacity: 0.85 }}>{s.binary(humanSize(result.size))}</span>
              )}
              {result.status === 'image' && (
                <img src={result.url} alt={name} style={{ maxWidth: '100%', borderRadius: '6px' }} />
              )}
              {result.status === 'text' && (
                <>
                  {result.highlighting === true && (
                    <div style={{ opacity: 0.6, marginBottom: '4px' }}>{s.hlLoading}</div>
                  )}
                  <pre style={{
                    margin: 0, fontFamily: 'monospace', fontSize: '11px',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}>
                    {result.text}
                  </pre>
                </>
              )}
              {result.status === 'code' && (
                // hljs 输出已转义（& < >），可安全注入。
                <pre
                  className="hljs"
                  style={{
                    margin: 0, fontFamily: 'monospace', fontSize: '11px',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}
                >
                  <code dangerouslySetInnerHTML={{ __html: result.html }} />
                </pre>
              )}
            </>
          )}
        </div>
        {/* 右下角缩放手柄。 */}
        <div
          style={{
            position: 'absolute', right: '2px', bottom: '2px',
            width: '18px', height: '18px', cursor: 'nwse-resize',
            touchAction: 'none', userSelect: 'none', zIndex: 2,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
            padding: '3px', color: 'rgba(255,255,255,0.45)',
          }}
          title={s.resizeTip}
          onPointerDown={(event) => { startPreviewDrag(event, 'resize') }}
        >
          <span style={{
            width: '8px', height: '8px',
            borderRight: '2px solid currentColor',
            borderBottom: '2px solid currentColor',
          }} />
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** DirTree 暴露给卡片授权行的刷新入口（清缓存 + 重拉根级）。 */
export interface DirTreeApi {
  refresh(): void
}

/**
 * 「目录内容」懒加载树：首次打开只读根级，点目录行展开读子级（每次展开经
 * 后端重新取该级，容忍 revoke 后的最新状态），再点收起并丢弃缓存。
 * 兼容模式与完整模式同路径（后端各自实现 listLevel）。文件名可点击弹出
 * 预览层；refresh()（授权行「↻」按钮经 apiRef 调用）清空全部层级/展开
 * 缓存并重拉根级（树区未展开时只清缓存，下次打开再拉）。
 * @param props.backend - 当前文件后端。
 * @param props.apiRef - 输出 DirTreeApi 的引用（createCard 闭包持有）。
 */
function DirTree({ backend, apiRef, s }: { backend: FsBackend; apiRef: { current: DirTreeApi | null }; s: Strings }): ReactElement {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [levels, setLevels] = useState<ReadonlyMap<string, LevelData>>(new Map())
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map())
  const [copied, setCopied] = useState<string | null>(null)
  /** 预览中的文件相对路径（null 为无预览层）。 */
  const [preview, setPreview] = useState<string | null>(null)
  /** 目录搜索：输入、结果、状态。 */
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchEntry[]>([])
  const [searching, setSearching] = useState(false)
  const [searchTruncated, setSearchTruncated] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const searchAbortRef = useRef<AbortController | null>(null)

  /** 清全部层级/展开缓存并重拉根级（树区收起时只清缓存，下次展开再拉）。 */
  const refresh = (): void => {
    setExpanded(new Set())
    setLevels(new Map())
    setErrors(new Map())
    setCopied(null)
    if (searchTimerRef.current !== undefined) clearTimeout(searchTimerRef.current)
    searchAbortRef.current?.abort()
    setSearchQuery('')
    setSearchResults([])
    setSearchTruncated(false)
    setSearchError(null)
    setSearching(false)
    if (open) void loadLevel('')
  }

  // 每次渲染重挂 api（refresh 闭包随 open 变化）；卸载时清空。
  useEffect(() => {
    apiRef.current = { refresh }
    return () => { apiRef.current = null }
  })

  // 卸载时取消未完成的搜索。
  useEffect(() => () => {
    if (searchTimerRef.current !== undefined) clearTimeout(searchTimerRef.current)
    searchAbortRef.current?.abort()
  }, [])

  const loadLevel = async (dirPath: string): Promise<void> => {
    setLoading(prev => new Set(prev).add(dirPath))
    try {
      const { entries, total } = await backend.listLevel(dirPath, LEVEL_LIMIT)
      const nodes: TreeNode[] = entries.map(entry => ({
        ...entry,
        path: dirPath === '' ? entry.name : `${dirPath}/${entry.name}`,
      }))
      setLevels(prev => new Map(prev).set(dirPath, { entries: nodes, total }))
      setErrors(prev => {
        const next = new Map(prev)
        next.delete(dirPath)
        return next
      })
    } catch (error) {
      setErrors(prev => new Map(prev).set(dirPath, error instanceof Error ? error.message : String(error)))
    } finally {
      setLoading(prev => {
        const next = new Set(prev)
        next.delete(dirPath)
        return next
      })
    }
  }

  /** 目录搜索：防抖 200ms，递归列出根目录后按路径过滤；可取消上一次请求。 */
  useEffect(() => {
    const query = searchQuery.trim()
    if (searchTimerRef.current !== undefined) clearTimeout(searchTimerRef.current)
    searchAbortRef.current?.abort()
    if (query === '') {
      setSearchResults([])
      setSearchTruncated(false)
      setSearchError(null)
      setSearching(false)
      return
    }
    setSearching(true)
    searchTimerRef.current = setTimeout(() => {
      const controller = new AbortController()
      searchAbortRef.current = controller
      void backend.list({ path: '', recursive: true }, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return
          const lower = query.toLowerCase()
          const matches = result.entries.filter(entry => entry.path.toLowerCase().includes(lower))
          setSearchResults(matches)
          setSearchTruncated(result.truncated)
          setSearchError(null)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setSearchError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 200)
  }, [searchQuery, backend])

  /** 从搜索结果点目录：逐级加载祖先层级并展开，回到普通树视图。 */
  const revealDirectory = (path: string): void => {
    void (async () => {
      const parts = path.split('/')
      const dirsToExpand: string[] = []
      try {
        let current = ''
        for (const part of parts) {
          current = current === '' ? part : `${current}/${part}`
          dirsToExpand.push(current)
          await loadLevel(current)
        }
        setExpanded(prev => new Set([...prev, ...dirsToExpand]))
        setSearchQuery('')
        setSearchResults([])
        setSearchTruncated(false)
        setSearchError(null)
        setOpen(true)
      } catch {
        // 展开失败时保留搜索结果，用户仍可复制/预览。
      }
    })()
  }

  const toggleSection = (): void => {
    if (!open && !levels.has('') && !loading.has('')) void loadLevel('')
    setOpen(!open)
  }

  const toggleDir = (path: string): void => {
    if (expanded.has(path)) {
      setExpanded(prev => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
      // 缓存丢弃：下次展开重新取，保证看到的是最新内容。
      setLevels(prev => {
        const next = new Map(prev)
        next.delete(path)
        return next
      })
    } else {
      setExpanded(prev => new Set(prev).add(path))
      void loadLevel(path)
    }
  }

  const copyPath = (path: string): void => {
    void navigator.clipboard?.writeText(path).then(() => {
      setCopied(path)
      setTimeout(() => { setCopied(prev => (prev === path ? null : prev)) }, 1200)
    }).catch(() => {
      // 剪贴板被拒（权限/焦点）：静默，不打扰浏览动作。
    })
  }

  const renderLevel = (dirPath: string, depth: number): ReactElement[] => {
    const level = levels.get(dirPath)
    if (level === undefined) return []
    const rows: ReactElement[] = []
    for (const entry of level.entries) {
      rows.push(
        <div className="lfs-row" key={entry.path} style={{ paddingLeft: `${String(depth * 12)}px` }}>
          {entry.kind === 'directory'
            ? (
              <span
                className="lfs-name is-dir"
                style={{ flex: 1 }}
                onClick={() => { toggleDir(entry.path) }}
                title={entry.path}
              >
                {expanded.has(entry.path) ? '▾' : '▸'} 📁 {entry.name}
              </span>
            )
            : (
              <>
                <span
                  className="lfs-name is-file"
                  style={{ flex: 1 }}
                  title={s.previewTip(entry.path)}
                  onClick={() => { setPreview(entry.path) }}
                >
                  📄 {entry.name}
                  {entry.size !== undefined && <span className="lfs-size"> {humanSize(entry.size)}</span>}
                </span>
                <button
                  className="lfs-btn lfs-btn--mini"
                  title={s.copyPathTip(entry.path)}
                  aria-label={s.copyPathTip(entry.path)}
                  onClick={() => { copyPath(entry.path) }}
                >
                  {copied === entry.path ? '✓' : s.copyPath}
                </button>
              </>
            )}
        </div>,
      )
      if (entry.kind === 'directory' && expanded.has(entry.path)) {
        if (loading.has(entry.path) && !levels.has(entry.path)) {
          rows.push(
            <div className="lfs-sub" key={`${entry.path}~loading`} style={{ paddingLeft: `${String((depth + 1) * 12)}px` }}>
              {s.loading}
            </div>,
          )
        }
        const error = errors.get(entry.path)
        if (error !== undefined) {
          rows.push(
            <div className="lfs-sub lfs-err" key={`${entry.path}~error`} style={{ paddingLeft: `${String((depth + 1) * 12)}px` }}>
              {error}
            </div>,
          )
        }
        rows.push(...renderLevel(entry.path, depth + 1))
      }
    }
    const rest = level.total - level.entries.length
    if (rest > 0) {
      rows.push(
        <div className="lfs-sub" key={`${dirPath}~more`} style={{ paddingLeft: `${String(depth * 12)}px` }}>
          {s.moreItems(rest)}
        </div>,
      )
    }
    return rows
  }

  return (
    <div className="lfs-tree">
      <div
        className="lfs-tree-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggleSection}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggleSection()
          }
        }}
      >
        {open ? '▾' : '▸'} {s.treeSection}
      </div>
      {open && (
        <>
          <input
            value={searchQuery}
            onChange={(event) => { setSearchQuery(event.target.value) }}
            placeholder={s.searchPlaceholder}
            className="lfs-input"
            style={{ marginTop: '5px' }}
          />
          {searchQuery.trim() !== '' ? (
            <div className="lfs-scroll" style={{ maxHeight: '160px' }}>
              {searching && <div className="lfs-sub">{s.loading}</div>}
              {searchError !== null && <div className="lfs-sub lfs-err">{searchError}</div>}
              {!searching && searchError === null && searchResults.length === 0 && (
                <div className="lfs-sub">{s.searchEmpty}</div>
              )}
              {searchResults.map(entry => (
                <div className="lfs-row" key={entry.path}>
                  {entry.kind === 'directory'
                    ? (
                      <span
                        className="lfs-name is-dir"
                        style={{ flex: 1 }}
                        title={s.searchOpenDirTip(entry.path)}
                        onClick={() => { revealDirectory(entry.path) }}
                      >
                        📁 {entry.path}
                      </span>
                    )
                    : (
                      <span
                        className="lfs-name is-file"
                        style={{ flex: 1 }}
                        title={s.previewTip(entry.path)}
                        onClick={() => { setPreview(entry.path) }}
                      >
                        📄 {entry.path}
                        {entry.size !== undefined && <span className="lfs-size"> {humanSize(entry.size)}</span>}
                      </span>
                    )}
                </div>
              ))}
              {searchTruncated && !searching && (
                <div className="lfs-sub" style={{ marginTop: '2px' }}>{s.searchTruncated}</div>
              )}
            </div>
          ) : (
            <div className="lfs-scroll" style={{ maxHeight: '240px' }}>
              {loading.has('') && !levels.has('') && <div className="lfs-sub">{s.loading}</div>}
              {errors.has('') && <div className="lfs-sub lfs-err">{errors.get('')}</div>}
              {renderLevel('', 0)}
            </div>
          )}
        </>
      )}
      {preview !== null && (
        <FilePreview backend={backend} path={preview} onClose={() => { setPreview(null) }} s={s} />
      )}
    </div>
  )
}

// ---------- 卡片拖拽换位 ----------

/** 卡片自由定位（fixed 的 left/top）；state 里 null 表示默认右下角（right/bottom 16px）。 */
interface CardPos {
  left: number
  top: number
}

/** 卡片位置的 localStorage key（与 device-name/collapsed 同前缀约定）。 */
const CARD_POS_KEY = 'dsh-local-file-share:card-pos'

/** 卡片高度记忆 key 与最小高度。 */
const CARD_HEIGHT_KEY = 'dsh-local-file-share:card-height'
const MIN_CARD_HEIGHT = 160

function readStoredCardHeight(): number | null {
  try {
    const raw = localStorage.getItem(CARD_HEIGHT_KEY)
    if (raw === null) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function writeStoredCardHeight(height: number): void {
  try {
    localStorage.setItem(CARD_HEIGHT_KEY, String(height))
  } catch {
    // localStorage 不可用：高度只在本次页面存活。
  }
}

/** 位移超过该像素才算拖拽；低于此按点击处理（不吃折叠/昵称/授权按钮的点击）。 */
const DRAG_THRESHOLD_PX = 4

/** 本地记忆：anchor 为球位；panel 为展开面板被用户拖放后的记忆位（可缺省）。 */
interface StoredCardPos {
  anchor: CardPos
  panel: CardPos | null
}

/** 读本地记忆；缺失/畸形/localStorage 不可用一律回 null（默认位）。 */
function readStoredCardPos(): StoredCardPos | null {
  try {
    const raw = localStorage.getItem(CARD_POS_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { left, top, panel } = parsed as { left?: unknown; top?: unknown; panel?: unknown }
    if (typeof left !== 'number' || typeof top !== 'number') return null
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null
    let panelPos: CardPos | null = null
    if (typeof panel === 'object' && panel !== null) {
      const { left: pl, top: pt } = panel as { left?: unknown; top?: unknown }
      if (typeof pl === 'number' && typeof pt === 'number' && Number.isFinite(pl) && Number.isFinite(pt)) {
        panelPos = { left: pl, top: pt }
      }
    }
    return { anchor: { left, top }, panel: panelPos }
  } catch {
    return null
  }
}

/**
 * 落盘锚点（球位）与面板记忆位。
 * @param panel - 面板记忆位；传 undefined 保留已存记忆（拖球不改面板记忆），
 *   null 表示清除。
 */
function writeStoredCardPos(anchor: CardPos, panel: CardPos | null | undefined): void {
  const kept = panel === undefined ? readStoredCardPos()?.panel ?? null : panel
  try {
    localStorage.setItem(CARD_POS_KEY, JSON.stringify(kept === null
      ? { left: anchor.left, top: anchor.top }
      : { left: anchor.left, top: anchor.top, panel: kept }))
  } catch {
    // localStorage 不可用：位置只在本次页面存活。
  }
}

/**
 * 球位锚点 clamp：整个球（FAB_SIZE 见方）始终完整留在视口内，贴边允许、
 * 不留隐性边距。pos 语义即球的左上角（拖卡片时锚定卡片左上角 = 收起后球位）。
 * @param pos - 待校正的锚点。
 */
function clampAnchorToViewport(pos: CardPos): CardPos {
  return {
    left: Math.min(Math.max(pos.left, 0), window.innerWidth - FAB_SIZE),
    top: Math.min(Math.max(pos.top, 0), window.innerHeight - FAB_SIZE),
  }
}

/**
 * 创建卡片组件（闭包捕获数据源；组件本体无订阅机器，只读快照）。
 * @param source - 状态源与动作。
 * @returns 可注册进 shell.overlay 的函数组件。
 */
export function createCard(source: CardSource): (props: unknown) => ReactElement {
  // 视觉层：注入一次（幂等），卡片/圆球/预览窗共用这份样式表。
  ensureStyles()
  /** DirTree 的清缓存重拉入口（组件挂载时填入，卸载清空）。 */
  const treeApi: { current: DirTreeApi | null } = { current: null }
  return function BrowserFsCard(props: unknown): ReactElement {
    const state = useSyncExternalStore(source.subscribe, source.getSnapshot)
    const { actions } = source
    /** 会话列表（共享范围用；来自 shell.overlay 标准 props 的 useSessions）。 */
    const sessionList = useSessionRows(props)
    /** 当前语言字典（跟随 dsh 的 <html lang>）。 */
    const s = STRINGS[state.lang]
    /** 已选入白名单的会话集合（策略不可变，派生集合每次渲染重建即可）。 */
    const selectedSessions = new Set(state.policy.sessions)
    const toggleSession = (id: string): void => {
      const next = new Set(selectedSessions)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      actions.setPolicy({ ...state.policy, scope: 'sessions', sessions: [...next] })
    }
    const policyIsDefault = state.policy.scope === 'global' && state.policy.access === 'readwrite'
    const policySummary = `${state.policy.access === 'readonly' ? s.accessReadonly : s.accessReadwrite}`
      + `${state.policy.scope === 'global' ? ` · ${s.policyGlobal}` : ` · ${s.policySessions(state.policy.sessions.length)}`}`
    const [editingName, setEditingName] = useState(false)
    const [draftName, setDraftName] = useState('')
    /** 启动时的本地记忆（只读一次）：anchor = 球位，panel = 面板记忆位。 */
    const [initialStored] = useState(readStoredCardPos)
    /** 球位锚点（null = 默认右下角）；卡片拖动时同步移动（= 卡片左上角 = 收起后球位）。 */
    const [pos, setPos] = useState<CardPos | null>(initialStored?.anchor ?? null)
    const cardRef = useRef<HTMLDivElement | null>(null)
    const fabRef = useRef<HTMLButtonElement | null>(null)
    const dragRef = useRef<{
      pointerId: number
      /** 拖的是卡片标题行还是圆球（松手时的落盘语义不同）。 */
      form: 'card' | 'fab'
      startX: number
      startY: number
      baseLeft: number
      baseTop: number
      moved: boolean
      /** 最近一次 move 的原始目标位（松手收敛用；不依赖可能批处理中的 state）。 */
      lastLeft: number
      lastTop: number
    } | null>(null)
    /** 进行中的手势的 window 监听拆卸器（卸载兜底用）。 */
    const dragCleanupRef = useRef<(() => void) | null>(null)
    /** 是否正在拖拽（拖中渲染绕过 panelFit 钳位，直接贴指针）。 */
    const [dragging, setDragging] = useState(false)
    /**
     * 展开面板的显示位置（钳位后）。语义：null = 本形态初次展开，以球位为锚
     * 允许翻转推导；非空 = 用户已摆好/已钳位过，之后只 clamp 不翻转。收起
     * 不清空——面板位置跨收起/展开保持（卡片拖到哪就停在哪）。
     */
    const [panelFit, setPanelFit] = useState<CardPos | null>(initialStored?.panel ?? null)
    /** 用户手动调整过的卡片高度（null = 跟随内容自动高度）。 */
    const [cardHeight, setCardHeight] = useState<number | null>(readStoredCardHeight)
    const cardResizeRef = useRef<{
      startY: number
      startHeight: number
      startTop: number
      lastHeight: number
    } | null>(null)
    const cardResizeCleanupRef = useRef<(() => void) | null>(null)

    // 恢复的位置可能已出视口（窗口此后变小过）：挂载后 clamp 一次；窗口
    // resize 时同样 clamp（锚点按球规则，面板按自身尺寸只 clamp 不翻转）。
    // 校正结果不落盘——存储的仍是用户拖放的点。
    useEffect(() => {
      const clampIntoView = (): void => {
        setPos(prev => (prev === null ? prev : clampAnchorToViewport(prev)))
        setPanelFit(prev => {
          if (prev === null) return prev
          const card = cardRef.current
          if (card === null) return prev
          return clampPanelToViewport(prev,
            { width: card.offsetWidth, height: card.offsetHeight },
            { width: window.innerWidth, height: window.innerHeight })
        })
      }
      clampIntoView()
      window.addEventListener('resize', clampIntoView)
      return () => { window.removeEventListener('resize', clampIntoView) }
    }, [])

    // 卸载兜底：手势途中组件卸载时摘掉 window 监听。
    useEffect(() => () => {
      dragCleanupRef.current?.()
      cardResizeCleanupRef.current?.()
    }, [])

    // 展开面板的视口钳位：panelFit 为空（初次展开）时以球位为锚、允许翻转
    // 展开方向；非空时只 clamp（尊重用户拖放的位置）。拖拽进行中跳过（拖中
    // 显示直接贴指针）。layout effect 每渲染跑一次，绘制前同步收敛（校正值
    // 不变时原样返回，不循环）。
    useLayoutEffect(() => {
      if (state.collapsed || dragRef.current !== null) return
      const card = cardRef.current
      if (card === null) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const size = { width: card.offsetWidth, height: card.offsetHeight }
      const target = panelFit === null
        ? fitPanelToViewport(
          pos ?? { left: vw - 16 - FAB_SIZE, top: vh - 16 - FAB_SIZE },
          size,
          { width: vw, height: vh },
        )
        : clampPanelToViewport(panelFit, size, { width: vw, height: vh })
      setPanelFit(prev => (prev !== null && prev.left === target.left && prev.top === target.top ? prev : target))
    })

    /**
     * 拖拽把手（卡片标题行 / 圆球共用）：pointerdown 起于把手，move/up 挂在
     * window 上跟踪全程。注意两个坑（都踩过）：不要 pointerdown 即
     * setPointerCapture——捕获会把 click 重定向到把手，里面的「—」收起钮
     * 点不中（122486e）；也不要越过阈值才捕获——快速甩动时指针在捕获前就
     * 离开把手，move 事件到不了把手，拖动直接丢失（"不跟手"）。window 监听
     * 两个都不沾。另有第三个坑：松手发生在窗口外时 pointerup 丢失——手势会
     * 卡死（面板追着悬停跑、下次点击落在「—」上就误收起）——用 window blur
     * 与下一次 pointerdown 时的陈旧手势清理兜底。
     */
    const onHandlePointerDown = (event: React.PointerEvent<HTMLElement>): void => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const el = cardRef.current ?? fabRef.current
      if (el === null) return
      // 上一次手势若没正常收尾（松手在窗口外），先拆掉它的监听。
      dragCleanupRef.current?.()
      const rect = el.getBoundingClientRect()
      const drag = {
        pointerId: event.pointerId,
        form: el === cardRef.current ? 'card' as const : 'fab' as const,
        startX: event.clientX,
        startY: event.clientY,
        baseLeft: rect.left,
        baseTop: rect.top,
        moved: false,
        lastLeft: rect.left,
        lastTop: rect.top,
      }
      dragRef.current = drag
      const onMove = (e: PointerEvent): void => {
        if (e.pointerId !== drag.pointerId) return
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        if (!drag.moved) {
          // 阈值内不动位置：保住把手上的点击语义。
          if (Math.abs(dx) <= DRAG_THRESHOLD_PX && Math.abs(dy) <= DRAG_THRESHOLD_PX) return
          drag.moved = true
          setDragging(true)
        }
        drag.lastLeft = drag.baseLeft + dx
        drag.lastTop = drag.baseTop + dy
        setPos({ left: drag.lastLeft, top: drag.lastTop })
      }
      const settle = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        window.removeEventListener('blur', onBlur)
        dragCleanupRef.current = null
        if (dragRef.current !== drag) return // 已被后续手势接管
        dragRef.current = null
        setDragging(false)
        if (!drag.moved) return
        // 真拖拽后紧跟的那次 click 一律吞掉：松手点可能落在把手的按钮上
        // （不该触发折叠/展开），也可能落在页面其它元素上（不该误点页面）。
        // window 捕获阶段拦截，500ms 兜底自拆（pointercancel/blur 无 click 的场景）。
        const swallow = (clickEvent: Event): void => {
          clickEvent.stopPropagation()
          clickEvent.preventDefault()
          window.removeEventListener('click', swallow, true)
        }
        window.addEventListener('click', swallow, true)
        setTimeout(() => { window.removeEventListener('click', swallow, true) }, 500)
        const rawPos = { left: drag.lastLeft, top: drag.lastTop }
        // 球位锚点按球规则 clamp（整球留在视口内、贴边无隐性边距）。
        const anchor = clampAnchorToViewport(rawPos)
        setPos(anchor)
        if (drag.form === 'card') {
          // 卡片拖到哪就停在哪：面板只 clamp 不翻转，并记忆面板位（随 pos 落盘）。
          const card = cardRef.current
          const settledPanel = clampPanelToViewport(rawPos,
            { width: card?.offsetWidth ?? 0, height: card?.offsetHeight ?? 0 },
            { width: window.innerWidth, height: window.innerHeight })
          setPanelFit(settledPanel)
          writeStoredCardPos(anchor, settledPanel)
        } else {
          // 拖球只动锚点；面板记忆位保留。
          writeStoredCardPos(anchor, undefined)
        }
      }
      const onUp = (e: PointerEvent): void => {
        if (e.pointerId !== drag.pointerId) return
        settle()
      }
      // 窗口失焦（含松手在窗口外）：按当前 lastLeft/lastTop 收尾，手势不卡死。
      const onBlur = (): void => { settle() }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      window.addEventListener('blur', onBlur)
      dragCleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        window.removeEventListener('blur', onBlur)
      }
    }

    /**
     * 卡片高度拖拽：从底部手柄按住上下拖动，最小 MIN_CARD_HEIGHT，最大不超出
     * 视口底部；松手时把高度写入 localStorage。
     */
    const startCardResize = (event: React.PointerEvent<HTMLElement>): void => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const card = cardRef.current
      if (card === null) return
      cardResizeCleanupRef.current?.()
      const drag = {
        startY: event.clientY,
        startHeight: cardHeight ?? card.offsetHeight,
        startTop: card.getBoundingClientRect().top,
        lastHeight: cardHeight ?? card.offsetHeight,
      }
      cardResizeRef.current = drag
      const onMove = (e: PointerEvent): void => {
        if (cardResizeRef.current !== drag) return
        const nextHeight = Math.min(
          Math.max(drag.startHeight + (e.clientY - drag.startY), MIN_CARD_HEIGHT),
          Math.max(MIN_CARD_HEIGHT, window.innerHeight - drag.startTop - 10),
        )
        drag.lastHeight = nextHeight
        setCardHeight(nextHeight)
      }
      const finish = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
        window.removeEventListener('blur', finish)
        cardResizeCleanupRef.current = null
        cardResizeRef.current = null
        if (drag.lastHeight !== drag.startHeight) writeStoredCardHeight(drag.lastHeight)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
      window.addEventListener('blur', finish)
      cardResizeCleanupRef.current = finish
    }

    /**
     * 键盘替代拖拽（无障碍 + 精细定位）：方向键移动（Shift 加速），
     * Enter/Space/Esc 收起。位置与拖拽同一套落盘语义，刷新后保持。
     */
    const onHandleKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
        event.preventDefault()
        actions.toggleCollapsed()
        return
      }
      const step = event.shiftKey ? 32 : 8
      const deltas: Record<string, { dx: number; dy: number }> = {
        ArrowLeft: { dx: -step, dy: 0 },
        ArrowRight: { dx: step, dy: 0 },
        ArrowUp: { dx: 0, dy: -step },
        ArrowDown: { dx: 0, dy: step },
      }
      const delta = deltas[event.key]
      if (delta === undefined) return
      const el = cardRef.current ?? fabRef.current
      if (el === null) return
      const rect = el.getBoundingClientRect()
      const base = pos ?? { left: rect.left, top: rect.top }
      event.preventDefault()
      const next = clampAnchorToViewport({ left: base.left + delta.dx, top: base.top + delta.dy })
      setPos(next)
      setPanelFit(prev => (prev === null ? prev : clampPanelToViewport(
        { left: prev.left + delta.dx, top: prev.top + delta.dy },
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      )))
      writeStoredCardPos(next, undefined)
    }

    // Esc 收起卡片：预览窗开着时交给预览窗自己处理（避免一次按键连关两层）。
    useEffect(() => {
      const onKey = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return
        if (document.querySelector('.lfs-mask') !== null) return
        actions.toggleCollapsed()
      }
      window.addEventListener('keydown', onKey)
      return () => { window.removeEventListener('keydown', onKey) }
    }, [actions])

    if (state.collapsed) {
      // 圆球与卡片共用 pos 锚点：卡片拖到哪儿，收起后球就在哪儿；展开后面板
      // 回到 panelFit 记忆位（未拖过面板则以球位为锚推导，允许翻转）。
      // 球同样可拖（同一套阈值/window 监听逻辑）；没移动过的松手才展开。
      const appliedFabStyle: CSSProperties = pos === null
        ? fabStyle
        : { ...fabStyle, right: 'auto', bottom: 'auto', left: `${String(pos.left)}px`, top: `${String(pos.top)}px` }
      return createPortal(
        <button
          ref={fabRef}
          className={`lfs-fab${dragging ? ' is-dragging' : ''}`}
          style={{ ...appliedFabStyle, touchAction: 'none', userSelect: 'none' }}
          title={s.fabTip}
          aria-label={s.fabTip}
          onClick={() => { actions.toggleCollapsed() }}
          onPointerDown={onHandlePointerDown}
        >
          <FolderIcon />
          <StatusDot color={statusColor(state)} />
        </button>,
        document.body,
      )
    }

    const saveName = (): void => {
      actions.setDeviceName(draftName)
      setEditingName(false)
    }

    /**
     * 展开面板样式：尺寸先兜底（宽高上限收到视口内留 10px 边距，超高内容出
     * 滚动条）；位置拖中直接贴指针（dragging → pos），非拖中用钳位结果
     * panelFit（未算出的首帧用锚点直出，layout effect 会在绘制前校正）。
     */
    const appliedCardStyle: CSSProperties = (() => {
      const capped: CSSProperties = {
        ...cardStyle,
        maxWidth: 'min(340px, calc(100vw - 20px))',
        maxHeight: 'calc(100vh - 20px)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        ...(cardHeight !== null ? { height: `${String(cardHeight)}px` } : {}),
      }
      const at = dragging ? pos : (panelFit ?? pos)
      if (at === null) return capped
      return { ...capped, right: 'auto', bottom: 'auto', left: `${String(at.left)}px`, top: `${String(at.top)}px` }
    })()

    // portal 到 body：shell.overlay 层（z-20）的层叠上下文会封顶内部一切
    // z-index，压不过应用侧 fixed 层（better-sidebar z-50/60）；自立 body 级
    // 层级才拿得到真实遮挡序。
    return createPortal(
      <div
        ref={cardRef}
        className={`lfs-card${dragging ? ' is-dragging' : ''}`}
        style={appliedCardStyle}
      >
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div
          className="lfs-head"
          style={{ touchAction: 'none', userSelect: 'none' }}
          title={s.handleTip}
          role="button"
          tabIndex={0}
          aria-label={s.handleTip}
          onPointerDown={onHandlePointerDown}
          onDoubleClick={() => { actions.toggleCollapsed() }}
          onKeyDown={onHandleKeyDown}
        >
          <span className="lfs-dot" style={{ background: statusColor(state) }} />
          <strong className="lfs-title">{s.cardTitle}</strong>
          <span
            className={`lfs-chip${policyIsDefault ? '' : ' is-warn'}`}
            title={`${s.scopeLabel}: ${policySummary}`}
          >
            {policySummary}
          </span>
          <button
            className="lfs-btn lfs-btn--icon"
            onClick={() => { actions.toggleCollapsed() }}
            title={s.collapseTip}
            aria-label={s.collapseTip}
          >
            —
          </button>
        </div>
        <div className="lfs-status" aria-live="polite">{statusText(state, s)}</div>
        <div className="lfs-device">
          {editingName
            ? (
              <>
                <input
                  autoFocus
                  value={draftName}
                  placeholder={s.namePlaceholder}
                  className="lfs-input"
                  style={{ flex: 1 }}
                  onChange={event => { setDraftName(event.target.value) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveName()
                    if (event.key === 'Escape') setEditingName(false)
                  }}
                  onBlur={saveName}
                />
              </>
            )
            : (
              <>
                <span className="lfs-name" style={{ flex: 1 }} title={state.label}>{s.localLabel(state.label)}</span>
                <button
                  className="lfs-btn lfs-btn--mini"
                  title={s.editNameTip}
                  aria-label={s.editNameTip}
                  onClick={() => {
                    setDraftName(state.nickname ?? '')
                    setEditingName(true)
                  }}
                >
                  ✏️
                </button>
              </>
            )}
        </div>
        <div className={`lfs-actions${state.permission === 'granted' ? ' lfs-actions--plain' : ''}${state.busy ? ' is-busy' : ''}`}>
          {state.permission === 'granted'
            ? state.compat
              ? (
                <>
                  <button className="lfs-btn" disabled={state.busy} onClick={() => { actions.pickCompatDir() }}>{s.reselectDir}</button>
                  <button className="lfs-btn" disabled={state.busy} onClick={() => { actions.pickCompatFiles() }}>{s.reselectFiles}</button>
                  <button className="lfs-btn" disabled={state.busy} onClick={() => { actions.revoke() }}>{s.clear}</button>
                  {/* 兼容模式缓存即选择时快照，刷新 = 按上次形态重开选择器。 */}
                  <button
                    className="lfs-btn lfs-btn--icon"
                    disabled={state.busy}
                    title={s.refreshTipCompat}
                    aria-label={s.refreshTipCompat}
                    onClick={() => { actions.pickCompatRefresh() }}
                  >
                    ↻
                  </button>
                </>
              )
              : (
                <>
                  <button className="lfs-btn" disabled={state.busy} onClick={() => { actions.pickNew() }}>{s.pickNew}</button>
                  <button className="lfs-btn" disabled={state.busy} onClick={() => { actions.revoke() }}>{s.revoke}</button>
                  <button
                    className="lfs-btn lfs-btn--icon"
                    title={s.refreshTipFull}
                    aria-label={s.refreshTipFull}
                    onClick={() => { treeApi.current?.refresh() }}
                  >
                    ↻
                  </button>
                </>
              )
            : state.pickerAvailable
              ? (
                <>
                  <button className="lfs-btn" disabled={state.busy} onClick={() => { actions.authorize() }}>
                    {state.permission === 'none' ? s.authorize : s.reauthorize}
                  </button>
                  {state.permission !== 'none' && (
                    <button className="lfs-btn" disabled={state.busy} onClick={() => { actions.pickNew() }}>{s.pickNew}</button>
                  )}
                </>
              )
              : (
                <>
                  {/* 兼容模式授权区双入口：目录 / 多选文件，不再只靠属性探测自动二选一。 */}
                  <button className="lfs-btn" disabled={state.busy} onClick={() => { actions.pickCompatDir() }}>{s.compatDir}</button>
                  <button className="lfs-btn" disabled={state.busy} onClick={() => { actions.pickCompatFiles() }}>{s.compatFiles}</button>
                </>
              )}
        </div>
        {/* 共享范围与权限：默认「全局 + 读写」（= 旧版行为），改这里即时生效并广播给 host */}
        <div className="lfs-policy">
          <div className="lfs-policy-row">
            <span className="lfs-policy-label">{s.scopeLabel}</span>
            <div className="lfs-seg" role="radiogroup" aria-label={s.scopeLabel}>
              <button
                type="button"
                role="radio"
                aria-checked={state.policy.scope === 'global'}
                onClick={() => { actions.setPolicy({ ...state.policy, scope: 'global', sessions: [] }) }}
              >
                {s.scopeGlobal}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={state.policy.scope === 'sessions'}
                onClick={() => { actions.setPolicy({ ...state.policy, scope: 'sessions' }) }}
              >
                {s.scopeSessions}
              </button>
            </div>
          </div>
          <div className="lfs-policy-row">
            <span className="lfs-policy-label">{s.accessLabel}</span>
            <div className="lfs-seg" role="radiogroup" aria-label={s.accessLabel}>
              <button
                type="button"
                role="radio"
                aria-checked={state.policy.access === 'readwrite'}
                onClick={() => { actions.setPolicy({ ...state.policy, access: 'readwrite' }) }}
              >
                {s.accessReadwrite}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={state.policy.access === 'readonly'}
                onClick={() => { actions.setPolicy({ ...state.policy, access: 'readonly' }) }}
              >
                {s.accessReadonly}
              </button>
            </div>
          </div>
          {state.policy.access === 'readonly' && (
            <div className="lfs-sub">{s.readonlyHint}</div>
          )}
          {state.policy.scope === 'sessions' && (
            <div className="lfs-sessions">
              <div className="lfs-sessions-head">
                <span style={{ flex: 1 }}>{s.sessionPickHint}</span>
                <button
                  type="button"
                  className="lfs-btn lfs-btn--mini"
                  onClick={() => { actions.setPolicy({ ...state.policy, scope: 'sessions', sessions: sessionList.map(row => row.id) }) }}
                >
                  {s.sessionSelectAll}
                </button>
                <button
                  type="button"
                  className="lfs-btn lfs-btn--mini"
                  onClick={() => { actions.setPolicy({ ...state.policy, scope: 'sessions', sessions: [] }) }}
                >
                  {s.sessionClearAll}
                </button>
              </div>
              <div className="lfs-scroll lfs-sessions-list">
                {sessionList.length === 0
                  ? <div className="lfs-sub">{s.sessionEmpty}</div>
                  : sessionList.map(row => (
                    <label className={`lfs-row lfs-session${selectedSessions.has(row.id) ? '' : ' is-off'}`} key={row.id}>
                      <input
                        type="checkbox"
                        checked={selectedSessions.has(row.id)}
                        onChange={() => { toggleSession(row.id) }}
                      />
                      <span className="lfs-name lfs-session-title" title={row.id}>{row.title}</span>
                      {row.running && <span className="lfs-running" aria-hidden="true" />}
                      <span className="lfs-size">
                        {row.short}{row.subagent ? ` · ${s.subagentTag}` : ''}{row.running ? ` · ${s.runningTag}` : ''}
                      </span>
                    </label>
                  ))}
              </div>
              {selectedSessions.size === 0 && (
                <div className="lfs-sub lfs-err">{s.sessionNoneWarn}</div>
              )}
            </div>
          )}
        </div>
        {!state.pickerAvailable && (
          <div className="lfs-compat">
            <span className="lfs-badge">
              {s.compatBadge}
            </span>
            <div>
              {s.compatDesc}
            </div>
            <div style={{ marginTop: '4px' }}>
              {s.compatHowtoFull}
              <div className="lfs-code" style={{ marginTop: '2px' }}>
                {s.compatSsh}
              </div>
              <div className="lfs-code">
                {s.compatFlag}
              </div>
              <div className="lfs-code">
                {s.compatHttps}
              </div>
            </div>
          </div>
        )}
        {state.permission === 'granted' && state.backend !== null && (
          <DirTree key={state.rootVersion} backend={state.backend} apiRef={treeApi} s={s} />
        )}
        {state.error !== null && (
          <div className="lfs-err" style={{ marginTop: '6px' }}>{state.error}</div>
        )}
        {state.error !== null && window.self !== window.top && (
          <div style={{ marginTop: '6px' }}>
            <a className="lfs-link" href={location.origin} target="_blank" rel="noreferrer">
              {s.iframeAuthLink}
            </a>
          </div>
        )}
        </div>
        <div
          className="lfs-resize"
          style={{ touchAction: 'none', userSelect: 'none' }}
          title={s.cardResizeTip}
          onPointerDown={startCardResize}
        >
          <span />
        </div>
      </div>,
      document.body,
    )
  }
}

/**
 * 会话内小条（注册进 `conversation.input.dock`，作用域 = session）。
 *
 * 为什么需要它：根作用域的卡片拿不到"当前会话是谁"（`shell.overlay` 的 props 里
 * 没有 sessionId），而会话作用域的槽位有 —— 所以把这个"一键加入/移出本会话"
 * 的补丁交给会话内小条，两者用同一个数据源与同一套 action。
 * 只在「指定会话」模式下渲染，默认（全局）不占任何视觉空间。
 * @param source - 与卡片相同的数据源。
 * @returns 会话作用域组件（不在该模式时返回 null）。
 */
export function createSessionChip(source: CardSource): (props: unknown) => ReactElement | null {
  return function SessionScopeChip(props: unknown): ReactElement | null {
    const state = useSyncExternalStore(source.subscribe, source.getSnapshot)
    const s = STRINGS[state.lang]
    const sessionId = (props as { sessionId?: unknown } | null | undefined)?.sessionId
    if (state.policy.scope !== 'sessions' || typeof sessionId !== 'string' || sessionId === '') return null
    const included = state.policy.sessions.includes(sessionId)
    const toggle = (): void => {
      const next = new Set(state.policy.sessions)
      if (included) next.delete(sessionId)
      else next.add(sessionId)
      source.actions.setPolicy({ ...state.policy, scope: 'sessions', sessions: [...next] })
    }
    return (
      <div className={`lfs-chipbar${included ? '' : ' is-off'}`}>
        <span>{included ? s.chipIncluded : s.chipExcluded}</span>
        <button type="button" title={s.chipToggleTip} aria-pressed={included} onClick={toggle}>
          {included ? s.chipRemove : s.chipAdd}
        </button>
      </div>
    )
  }
}
