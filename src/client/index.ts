/**
 * dsh-local-file-share client 半（浏览器）：连回 host 半的 WS 通道，接收 call 帧、
 * 在本机授权目录上执行文件操作、回发 result 帧；同时把授权卡片注册进
 * shell.overlay 层。
 *
 * 两档能力（特性检测 `typeof window.showDirectoryPicker === 'function'`，
 * 不看 isSecureContext —— 代理可能改过它）：
 *  - 完整模式：File System Access 句柄，IndexedDB 持久化（store.ts），可读写；
 *  - 兼容模式（非安全上下文，如局域网 http 手机访问）：离屏 input 双入口
 *    选目录（webkitdirectory）/多选文件建 File 内存映射（files-backend.ts），
 *    只读、无持久化，刷新需重选。
 *
 * 产物契约：esbuild 打成 CJS 闭包，首尾包装 window.__ModuleLoader__.load
 * （见 build.mjs）；external 仅 react / react/jsx-runtime（模块表回答）。
 * @module dsh-local-file-share/client
 */

import {
  DEFAULT_SHARE_POLICY,
  DEFAULT_WS_PATH,
  decidePolicy,
  normalizeSharePolicy,
  parseHostFrame,
  type FsOp,
  type PolicyDenial,
  type ResultFrame,
  type RosterExecutor,
  type SharePolicy,
} from '../wire.js'
import { classifyCompatChange, resolveCompatInput, type CompatPickMode } from './compat-picker.js'
import { deriveDeviceLabel } from './device.js'
import { STRINGS, detectLang, langFromTag, subscribeLang } from './i18n.js'
import { executeOp, handleBackend, type FsBackend } from './fs.js'
import { createFilesBackend } from './files-backend.js'
import { clearStoredPolicy, readStoredPolicy, writeStoredPolicy } from './policy.js'
import { clearHandle, loadHandle, saveHandle } from './store.js'
import { createCard, createSessionChip, type BrowserFsState } from './ui.js'

/** 必需服务：slot 注册表（授权卡片挂 shell.overlay）。 */
export const inject = ['slots']

/** apply 实际读到的 client ctx 面（cordis-client-runner 的 guard 代理兼容它）。 */
interface ClientCtx {
  effect(fn: () => void | (() => void), label?: string): void
  /** cordis 可选服务注入：服务在场时回调（本组合里 dsh-client-locale 提供 locale）。 */
  inject(names: string[], fn: (ctx: unknown) => void): void
  slots: {
    inject(name: string, fn: () => unknown): unknown
    register(options: Record<string, unknown>, component: unknown): () => void
  }
}

/** dsh-client-locale 经 ctx.provide('locale') 暴露的语言服务面（只取用到的部分）。 */
interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(fn: () => void): () => void
}

/** 会话 id 的短显示形式（错误文案里避免刷屏）。 */
function shortSessionId(caller: string | undefined): string {
  if (caller === undefined || caller === '') return '（非会话调用）'
  return caller.length > 18 ? `${caller.slice(0, 15)}…` : caller
}

/**
 * 本地拦截（L2）时的人类可读原因：与 host 侧（L3）保持同一套说法，
 * 用户看到任一条都能直接照着去卡片里改策略。
 * @param denial - 判定给出的拒绝原因。
 * @param op - 本次操作。
 * @param caller - 调用方会话 id。
 * @returns 工具结果里的错误文本。
 */
function describeDenial(denial: PolicyDenial | undefined, op: FsOp, caller: string | undefined): string {
  if (denial === 'readonly') {
    return 'local-file-share: 当前授权为「只读」，已拒绝写入'
      + '（在「本地文件共享」卡片的「权限」里切换为「读写」后重试）'
  }
  if (denial === 'out-of-scope') {
    return `local-file-share: 当前授权限定「指定会话」，本会话 ${shortSessionId(caller)} 不在共享范围内`
      + '（在卡片「共享范围」里加入本会话，或改为「全局」共享）'
  }
  return 'local-file-share: 当前授权限定「指定会话」，而本次调用不来自任何会话'
    + `（op=${op}）—— 请改为「全局」共享，或从会话内发起调用`
}

/**
 * 浏览器侧错误的人话化：以只读方式授权的目录在被写入时会抛
 * `NotAllowedError`/`SecurityError`，这里补上"怎么改"的指引；其余原样透传。
 * @param error - executeOp 抛出的原始错误。
 * @returns 错误文本。
 */
function browserErrorText(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'local-file-share: 该目录以「只读」方式授权，浏览器拒绝了写入'
      + `（在卡片「权限」里切到「读写」并重新授权目录）—— 原始错误：${message}`
  }
  return message
}

/**
 * Client 插件体：状态源 + WS 生命周期 + call 执行 + 授权卡片注册。
 * @param ctx - client 根上下文。
 */
export function apply(ctx: ClientCtx): void {
  const COLLAPSED_KEY = 'dsh-local-file-share:collapsed'
  const storedCollapsed = ((): boolean | null => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY)
      return raw === null ? null : raw === '1'
    } catch {
      // 隐私模式等场景 localStorage 不可用：当作无存储偏好。
      return null
    }
  })()
  // 用户显式收起/展开过（含上次刷新留下的存储值）后不再随权限状态改默认值。
  let collapseTouched = storedCollapsed !== null

  /** 设备昵称（localStorage）；空串/读取失败视为未设置。 */
  const storedNickname = ((): string | null => {
    try {
      const raw = localStorage.getItem('dsh-local-file-share:device-name')
      return raw === null || raw.trim() === '' ? null : raw
    } catch {
      return null
    }
  })()
  /** UA 派生标签（昵称的兜底）。 */
  const derivedLabel = deriveDeviceLabel(navigator.userAgent)

  /**
   * 特性检测（不看 window.isSecureContext —— cenacle 代理的 polyfill 可能改过它）：
   * showDirectoryPicker 不存在即落入兼容模式（只读 File 映射）。
   */
  const pickerAvailable = typeof window.showDirectoryPicker === 'function'
  console.log('[local-file-share] init: showDirectoryPicker', pickerAvailable ? '可用（完整模式）' : '不可用（兼容模式）', '| UA:', navigator.userAgent)

  let state: BrowserFsState = {
    wsConnected: false,
    permission: 'none',
    dirName: null,
    busy: false,
    error: null,
    collapsed: storedCollapsed ?? false,
    backend: null,
    rootVersion: 0,
    label: storedNickname ?? derivedLabel,
    nickname: storedNickname,
    executors: [],
    pickerAvailable,
    compat: false,
    lang: detectLang(),
    policy: readStoredPolicy(),
  }
  const listeners = new Set<() => void>()
  const setState = (patch: Partial<BrowserFsState>): void => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  let handle: FileSystemDirectoryHandle | null = null
  let backend: FsBackend | null = null
  let rootVersion = 0
  /** 完整模式句柄变更：句柄后端 + snapshot 同步 + 版本 bump（目录树据此重置）。 */
  const setHandle = (next: FileSystemDirectoryHandle | null): void => {
    handle = next
    backend = next === null ? null : handleBackend(next)
    rootVersion += 1
    setState({ backend, rootVersion, compat: false })
  }
  /** 兼容模式后端变更（File 映射；无句柄、无持久化）。调用方负责随后 sendState()。 */
  const setCompatBackend = (files: File[]): void => {
    const built = createFilesBackend(files)
    handle = null
    backend = built.backend
    rootVersion += 1
    setState({ backend, rootVersion, compat: true, dirName: built.dirName, permission: 'granted', error: null })
  }
  let ws: WebSocket | null = null
  let disposed = false
  let retryMs = 1000
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  const inflight = new Map<string, AbortController>()

  /** 只有「后端在手 + readwrite 已授予」才算可执行（兼容模式后端即授即 granted）。 */
  const ready = (): boolean => backend !== null && state.permission === 'granted'

  /** 向 host 广播当前授权状态 + 设备标签 + 共享策略（host 据此挑执行者并维护 roster）。 */
  const sendState = (): void => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'state',
        hasHandle: ready(),
        dirName: ready() ? state.dirName : null,
        label: state.label,
        policy: state.policy,
      }))
    }
  }

  const reply = (frame: ResultFrame): void => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
  }

  /**
   * 执行一次 host 派发的调用。**L2 本地二次拦截**：本机自己就是策略的持有者，
   * 因此这里用帧里带来的 `caller` 完整判定一次（只读拒写、白名单拒外会话都在
   * 到达 File System Access 之前挡掉）；host 侧（L3）是另一道权威判定。
   * @param rpcId - 调用标识。
   * @param op - 文件操作。
   * @param args - 操作参数。
   * @param caller - 调用方会话 id（host 注入；缺失 = 非会话调用者）。
   */
  const onCall = async (
    rpcId: string,
    op: 'list' | 'read' | 'write',
    args: Record<string, unknown>,
    caller?: string,
  ): Promise<void> => {
    if (backend === null || !ready()) {
      reply({ type: 'result', rpcId, ok: false, error: 'local-file-share: this tab holds no authorized directory' })
      return
    }
    const decision = decidePolicy(state.policy, caller, op)
    if (!decision.allowed) {
      reply({ type: 'result', rpcId, ok: false, error: describeDenial(decision.denial, op, caller) })
      return
    }
    const abort = new AbortController()
    inflight.set(rpcId, abort)
    try {
      const value = await executeOp(backend, op, args, abort.signal)
      reply({ type: 'result', rpcId, ok: true, value })
    } catch (error) {
      reply({
        type: 'result',
        rpcId,
        ok: false,
        error: browserErrorText(error),
      })
    } finally {
      inflight.delete(rpcId)
    }
  }

  const onMessage = (raw: string): void => {
    const frame = parseHostFrame(raw)
    if (frame === null) return
    if (frame.type === 'roster') {
      setState({ executors: [...frame.executors] })
      return
    }
    if (frame.type === 'cancel') {
      inflight.get(frame.rpcId)?.abort()
      return
    }
    void onCall(frame.rpcId, frame.op, frame.args, frame.caller)
  }

  const connect = (): void => {
    if (disposed) return
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const sock = new WebSocket(`${scheme}://${location.host}${DEFAULT_WS_PATH}`)
    ws = sock
    sock.onopen = () => {
      retryMs = 1000
      setState({ wsConnected: true })
      sendState()
    }
    sock.onmessage = (event) => {
      if (typeof event.data === 'string') onMessage(event.data)
    }
    sock.onclose = () => {
      if (ws === sock) {
        ws = null
        setState({ wsConnected: false, executors: [] })
      }
      if (!disposed) retryTimer = setTimeout(connect, retryMs)
      retryMs = Math.min(retryMs * 2, 10_000)
    }
    sock.onerror = () => { sock.close() }
  }

  /** 启动恢复：读回 IndexedDB 句柄并检查权限（不自动 requestPermission —— 需要用户手势）。
   *  兼容模式（无 showDirectoryPicker）没有句柄可持久化，直接跳过。 */
  const restore = async (): Promise<void> => {
    if (!pickerAvailable) return
    const stored = await loadHandle()
    if (stored === null) {
      setState({ permission: 'none', dirName: null })
      return
    }
    setHandle(stored)
    const permission = await stored.queryPermission({ mode: 'readwrite' })
    // 无存储偏好时的默认折叠：未授权（none，无句柄走上面的早退分支，初始即展开）
    // 保持展开引导授权；有句柄（granted/prompt/denied）默认折叠。
    if (!collapseTouched) setState({ collapsed: true })
    setState({ permission, dirName: stored.name })
    sendState()
  }

  /**
   * 环境阻断检查（仅完整模式的授权路径）：跨源 iframe（如 cenacle 网页浏览
   * 窗口）里浏览器禁止子框架弹文件选择器，提前给出可操作的中文引导而非甩
   * 浏览器原始报错。授权在独立标签页完成一次即可——句柄按源持久化在
   * IndexedDB，此后 iframe 内无需再弹。
   * 非安全上下文不再是阻断：showDirectoryPicker 缺失时 authorize 自动落
   * 兼容模式（input 选目录，iframe 里同样可用）。
   */
  const envBlocker = (): string | null => {
    if (window.self !== window.top) {
      return STRINGS[state.lang].errIframeBlocker
    }
    return null
  }

  /**
   * 兼容模式的目录/文件选择器：一个离屏的 input[type=file]——离屏而非
   * display:none（移动端浏览器/微信 WebView 拦隐藏 input 的编程式 click）。
   * 两个入口由 UI 双按钮驱动：选目录（webkitdirectory，能力缺失或已有失效
   * 前科时自动退多选）与选多个文件（multiple）。change 返回 0 文件绝不静默：
   * 卡片给可见错误，目录形态 0 文件（iOS 典型）还会标记失效前科，此后目录
   * 入口自动改走多选。
   */
  let compatInput: HTMLInputElement | null = null
  /** 目录选择失效前科（上次目录形态 change 返回 0 个文件）。 */
  let compatDirPickBroken = false
  /** 最近一次成功选择的形态（↻ 刷新按它重开选择器）。 */
  let compatPickMode: CompatPickMode = 'directory'
  const openCompatPicker = (mode: CompatPickMode): void => {
    console.log('[local-file-share] openCompatPicker, mode =', mode)
    if (compatInput === null) {
      const input = document.createElement('input')
      input.type = 'file'
      Object.assign(input.style, {
        position: 'fixed',
        left: '-9999px',
        top: '0',
        width: '1px',
        height: '1px',
        opacity: '0',
      })
      input.addEventListener('change', () => {
        const files = input.files
        console.log('[local-file-share] change: files =', files?.length ?? 0, ', webkitdirectory =', input.webkitdirectory)
        const outcome = classifyCompatChange(files?.length ?? 0, input.webkitdirectory)
        if (outcome.kind === 'selected' && files !== null) {
          compatPickMode = outcome.directory ? 'directory' : 'files'
          setCompatBackend([...files])
          sendState()
          return
        }
        if (outcome.kind === 'dir-empty') {
          compatDirPickBroken = true
          setState({ error: STRINGS[state.lang].errDirEmpty })
        } else {
          setState({ error: STRINGS[state.lang].errFilesEmpty })
        }
      })
      document.body.appendChild(input)
      compatInput = input
    }
    // webkitdirectory 探测走 Record 形态（TS 的 lib.dom 认为它恒在，直接 in 会把 else 窄化成 never）。
    const probe = compatInput as unknown as Record<string, unknown>
    const shape = resolveCompatInput(mode, {
      dirSupported: 'webkitdirectory' in probe,
      dirBroken: compatDirPickBroken,
    })
    compatInput.webkitdirectory = shape.directory
    compatInput.multiple = true
    // 清空 value 允许重选同一目录（否则 change 不触发）。
    compatInput.value = ''
    console.log('[local-file-share] input.click() 触发选择器, directory =', shape.directory)
    compatInput.click()
  }

  /** 移动端（华为浏览器等）showDirectoryPicker 存在但不可用——AbortError 被
   *  静默吞，用户视角就是"点了没反应"。这类失败自动降级兼容模式；桌面用户
   *  主动取消（AbortError）保持静默。 */
  const isMobileLike = /Android|HarmonyOS|iPhone|iPad/i.test(navigator.userAgent)

  /** 完整模式选择器统一入口：reuse=true 优先复用已授权句柄（authorize），
   *  false 强制新选（pickNew）。`mode` 跟随当前「权限」设置 —— 选「只读」时
   *  用 `mode: 'read'` 让浏览器**根本不给写权限**（这是最强的一道，L1）。 */
  const runFullModePicker = async (reuse: boolean, mode: 'readwrite' | 'read'): Promise<void> => {
    const blocker = envBlocker()
    if (blocker !== null) {
      setState({ error: blocker })
      return
    }
    setState({ busy: true, error: null })
    try {
      if (reuse && handle !== null) {
        const permission = await handle.requestPermission({ mode })
        setState({ permission, dirName: handle.name })
      } else {
        console.log('[local-file-share] showDirectoryPicker 调用, mode =', mode)
        const picked = await showDirectoryPicker({ mode })
        console.log('[local-file-share] 目录已选:', picked.name)
        setHandle(picked)
        await saveHandle(picked)
        setState({ permission: 'granted', dirName: picked.name })
      }
      sendState()
    } catch (error) {
      const name = error instanceof DOMException ? error.name : 'Error'
      console.log('[local-file-share] showDirectoryPicker 失败:', name, error instanceof Error ? error.message : '')
      if (isMobileLike) {
        setState({ error: '当前浏览器的目录选择器不可用，已切换兼容模式' })
        openCompatPicker('directory')
      } else if (!(error instanceof DOMException && error.name === 'AbortError')) {
        // 用户关掉系统选择器/权限弹窗不是错误。
        setState({ error: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      setState({ busy: false })
    }
  }

  const actions = {
    authorize(): void {
      // 特性检测失败 → 自动降级：兼容模式选目录（只读）。
      if (!pickerAvailable) {
        openCompatPicker('directory')
        return
      }
      void runFullModePicker(true, state.policy.access === 'readonly' ? 'read' : 'readwrite')
    },
    pickNew(): void {
      if (!pickerAvailable) {
        openCompatPicker('directory')
        return
      }
      void runFullModePicker(false, state.policy.access === 'readonly' ? 'read' : 'readwrite')
    },
    /** 保存共享策略：归一化 → 落盘 → 刷新快照 → 重新广播（host 据此改判定）。 */
    setPolicy(next: SharePolicy): void {
      const policy = normalizeSharePolicy(next)
      writeStoredPolicy(policy)
      setState({ policy })
      sendState()
    },
    revoke(): void {
      void (async () => {
        setHandle(null)
        backend = null
        setState({ backend: null })
        if (pickerAvailable) await clearHandle()
        // 策略随授权生命周期：解除授权即清除，下次授权回到默认（全局 + 读写）。
        clearStoredPolicy()
        setState({ permission: 'none', dirName: null, error: null, compat: false, policy: DEFAULT_SHARE_POLICY })
        sendState()
      })()
    },
    /** 收起/展开卡片；显式选择写 localStorage，此后不再随权限状态改默认值。 */
    toggleCollapsed(): void {
      const collapsed = !state.collapsed
      collapseTouched = true
      try {
        localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
      } catch {
        // localStorage 不可用时折叠状态只在本次页面存活。
      }
      setState({ collapsed })
    },
    /** 设置设备昵称（空串清除昵称，回落到 UA 派生标签）；写 localStorage 并重新广播 state。 */
    setDeviceName(name: string): void {
      const trimmed = name.trim()
      const nickname = trimmed === '' ? null : trimmed
      try {
        if (nickname === null) localStorage.removeItem('dsh-local-file-share:device-name')
        else localStorage.setItem('dsh-local-file-share:device-name', nickname)
      } catch {
        // localStorage 不可用：昵称只在本次页面存活。
      }
      setState({ nickname, label: nickname ?? derivedLabel })
      sendState()
    },
    /** 兼容模式：选目录（webkitdirectory；有失效前科时自动退多选）。 */
    pickCompatDir(): void {
      openCompatPicker('directory')
    },
    /** 兼容模式：多选文件（multiple）。 */
    pickCompatFiles(): void {
      openCompatPicker('files')
    },
    /** 兼容模式 ↻ 刷新：按上次成功选择的形态重开选择器。 */
    pickCompatRefresh(): void {
      openCompatPicker(compatPickMode)
    },
  }

  /** 卡片与会话内小条共用的数据源（同一份状态与同一套 action）。 */
  const cardSource = {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => state,
    actions,
  }
  const card = createCard(cardSource)
  const sessionChip = createSessionChip(cardSource)

  ctx.effect(() => {
    connect()
    void restore()
    return () => {
      disposed = true
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      ws?.close()
      for (const controller of inflight.values()) controller.abort()
      inflight.clear()
      compatInput?.remove()
      compatInput = null
    }
  }, 'local-file-share: websocket lifecycle')

  // 语言跟随：优先 dsh 的 locale 服务（dsh-client-locale 经 ctx.provide 提供，
  // 是 Settings → General → Language 的真实载体）；缺席的组合退回
  // <html lang>/navigator 并跟随 lang 属性变化（在场时 locale 服务是权威信号，
  // html lang 兜底不抢）。
  let localeDriven = false
  ctx.inject(['locale'], (injected) => {
    const face = (injected as { locale: LocaleFace }).locale
    const adopt = (): void => {
      localeDriven = true
      setState({ lang: langFromTag(face.getSnapshot().active) })
    }
    adopt()
    ctx.effect(() => face.subscribe(adopt), 'local-file-share: locale follow')
  })
  ctx.effect(
    () => subscribeLang(() => {
      if (!localeDriven) setState({ lang: detectLang() })
    }),
    'local-file-share: lang fallback (html lang)',
  )

  ctx.effect(() => {
    let dispose: (() => void) | undefined
    ctx.slots.inject('shell.overlay', () => {
      dispose = ctx.slots.register(
        { name: 'shell.overlay', id: 'local-file-share', order: 100, label: '浏览器文件' },
        card,
      )
      return dispose
    })
    return () => { dispose?.() }
  }, 'local-file-share: overlay card')

  // 会话作用域小条：它拿得到 sessionId，补上根卡片"不知道当前会话"的缺口；
  // 只在「指定会话」模式下渲染，默认全局模式完全不可见。
  ctx.effect(() => {
    let dispose: (() => void) | undefined
    ctx.slots.inject('conversation.input.dock', () => {
      dispose = ctx.slots.register(
        { name: 'conversation.input.dock', id: 'local-file-share-session', order: 40 },
        sessionChip,
      )
      return dispose
    })
    return () => { dispose?.() }
  }, 'local-file-share: session scope chip')
}
