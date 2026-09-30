/**
 * dsh-local-file-share 的私有 wire 协议：host 半（Node）与 client 半（浏览器）之间
 * 经自建 WebSocket 通道传递的帧。两侧各自 bundle 本模块（type/常量层，
 * 无共享运行时身份）。
 *
 * 帧向：
 *   host → browser:  CallFrame   一次工具调用（list/read/write）
 *                    CancelFrame 调用方取消（exec.signal aborted）
 *   browser → host:  ResultFrame 一次调用的结果
 *                    StateFrame  上线/授权状态广播（host 据此挑选执行者）
 * @module dsh-local-file-share/wire
 */

/** WS 通道的默认精确 pathname（host 半 config.wsPath 可覆盖；client 半固定用默认值）。 */
export const DEFAULT_WS_PATH = '/local-file-share/ws'

/**
 * 语法高亮模块（懒加载 ESM chunk）的 HTTP pathname：与 WS 通道同目录下的
 * highlight.mjs。host 半按生效的 wsPath 派生并注册静态路由；client 半固定用
 * DEFAULT_WS_PATH 派生（与 WS 同一约定：改 wsPath 时两侧需同步）。
 * @param wsPath - 生效的 WS 通道路径。
 */
export function highlightModulePath(wsPath: string): string {
  const slash = wsPath.lastIndexOf('/')
  return `${slash <= 0 ? '' : wsPath.slice(0, slash)}/highlight.mjs`
}

/** client 半固定使用的高亮模块路径（由 DEFAULT_WS_PATH 派生）。 */
export const DEFAULT_HIGHLIGHT_PATH = highlightModulePath(DEFAULT_WS_PATH)

/** 浏览器端可执行的文件操作。 */
export type FsOp = 'list' | 'read' | 'write'

// ---------- 共享范围与读写权限策略 ----------

/**
 * 共享范围：`global` = 同一 dsh 实例内任何会话都能用；
 * `sessions` = 仅 `sessions` 里列出的会话能用。
 */
export type ShareScope = 'global' | 'sessions'

/** 授权权限：`readwrite` 允许写；`readonly` 只放行 list/read。 */
export type ShareAccess = 'readwrite' | 'readonly'

/** 一次授权（= 一台浏览器上的一个目录句柄）所带的共享策略。 */
export interface SharePolicy {
  readonly scope: ShareScope
  readonly sessions: readonly string[]
  readonly access: ShareAccess
}

/** 缺省策略：全局共享 + 可读可写（= 1.0.0 的行为，保证向后兼容）。 */
export const DEFAULT_SHARE_POLICY: SharePolicy = { scope: 'global', sessions: [], access: 'readwrite' }

/** 白名单会话数上限（防单帧膨胀）。 */
export const MAX_POLICY_SESSIONS = 200

/** 单个会话 id 的字符上限。 */
export const MAX_SESSION_ID_LENGTH = 128

/**
 * 归一化任意输入为合法策略：非法/缺失字段一律回落默认值（宽松 wire 边界），
 * `scope=global` 时清空 `sessions`，白名单去重、过滤非字符串、截断到上限。
 * @param value - 来自帧或被存储的未知值。
 * @returns 可直接参与判定的策略。
 */
export function normalizeSharePolicy(value: unknown): SharePolicy {
  if (!isRecord(value)) return DEFAULT_SHARE_POLICY
  const scope: ShareScope = value.scope === 'sessions' ? 'sessions' : 'global'
  const access: ShareAccess = value.access === 'readonly' ? 'readonly' : 'readwrite'
  if (scope === 'global') return { scope, sessions: [], access }
  const raw = Array.isArray(value.sessions) ? value.sessions : []
  const sessions: string[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (id === '' || id.length > MAX_SESSION_ID_LENGTH || seen.has(id)) continue
    seen.add(id)
    sessions.push(id)
    if (sessions.length >= MAX_POLICY_SESSIONS) break
  }
  return { scope, sessions, access }
}

/** 拒绝原因：只读拒写 / 会话不在白名单 / 调用不来自任何会话。 */
export type PolicyDenial = 'readonly' | 'out-of-scope' | 'no-session'

/** 一次策略判定的结果。 */
export interface PolicyDecision {
  readonly allowed: boolean
  readonly denial?: PolicyDenial
}

/**
 * 策略判定（host 侧唯一权威；client 侧用于本地二次拦截）。
 * 判定次序：先范围（无会话 / 不在白名单），再权限（只读拒写）——
 * 与「先解决范围、再看权限」的操作直觉一致，错误文案也据此分档。
 * @param policy - 生效策略（应已 normalize）。
 * @param sessionId - 调用方会话 id；非会话调用者为 undefined。
 * @param op - 本次操作。
 * @returns 是否放行，以及不放行时的原因。
 */
export function decidePolicy(policy: SharePolicy, sessionId: string | undefined, op: FsOp): PolicyDecision {
  if (policy.scope === 'sessions') {
    if (sessionId === undefined || sessionId === '') return { allowed: false, denial: 'no-session' }
    if (!policy.sessions.includes(sessionId)) return { allowed: false, denial: 'out-of-scope' }
  }
  if (op === 'write' && policy.access === 'readonly') return { allowed: false, denial: 'readonly' }
  return { allowed: true }
}

/** host → browser：一次工具调用。 */
export interface CallFrame {
  readonly type: 'call'
  readonly rpcId: string
  readonly op: FsOp
  readonly args: Record<string, unknown>
  /** 调用方会话 id（仅用于浏览器侧显示/日志，判定已在 host 侧完成）。 */
  readonly caller?: string
  /** 生效权限（客户端据此做本地二次拦截，不碰 File System Access）。 */
  readonly policy?: { readonly access: ShareAccess }
}

/** host → browser：取消进行中的调用。 */
export interface CancelFrame {
  readonly type: 'cancel'
  readonly rpcId: string
}

/** roster 里的一台执行者设备（hasHandle=true 的连接）。 */
export interface RosterExecutor {
  /** 设备标签（昵称优先，其次 UA 派生）。 */
  readonly label: string
  /** 该设备已授权的目录名。 */
  readonly dirName: string | null
  /** 该设备当前的共享范围。 */
  readonly scope: ShareScope
  /** 该设备当前的权限。 */
  readonly access: ShareAccess
}

/** host → browser：执行者名单广播（任一连接 state 变化/断连/新连接时全量推送）。 */
export interface RosterFrame {
  readonly type: 'roster'
  readonly executors: readonly RosterExecutor[]
}

export type HostFrame = CallFrame | CancelFrame | RosterFrame

/** browser → host：一次调用的完结。 */
export interface ResultFrame {
  readonly type: 'result'
  readonly rpcId: string
  readonly ok: boolean
  /** ok=true 时的操作结果（JSON 值）。 */
  readonly value?: unknown
  /** ok=false 时的错误消息。 */
  readonly error?: string
}

/** browser → host：连接/授权状态广播。只有 hasHandle=true 且策略放行的标签页会被选为执行者。 */
export interface StateFrame {
  readonly type: 'state'
  readonly hasHandle: boolean
  /** 已授权根目录的显示名（未授权为 null）。 */
  readonly dirName: string | null
  /** 设备标签（昵称 > UA 派生；缺省为空串，host 侧兜底「未命名设备」）。 */
  readonly label: string
  /** 共享策略（解析后必为合法值；发送端可省略 = 默认全局 + 读写）。 */
  readonly policy: SharePolicy
}

export type BrowserFrame = ResultFrame | StateFrame

const OPS: ReadonlySet<string> = new Set(['list', 'read', 'write'])
const SHARE_SCOPES: ReadonlySet<string> = new Set(['global', 'sessions'])
const SHARE_ACCESSES: ReadonlySet<string> = new Set(['readwrite', 'readonly'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 解析一条浏览器发来的原始文本帧；非法帧返回 null（wire 边界，宽松丢弃）。
 * @param raw - WebSocket message 的文本内容。
 * @returns 校验后的帧，或 null。
 */
export function parseBrowserFrame(raw: string): BrowserFrame | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(value)) return null
  if (value.type === 'result' && typeof value.rpcId === 'string' && typeof value.ok === 'boolean') {
    return {
      type: 'result',
      rpcId: value.rpcId,
      ok: value.ok,
      ...(value.value !== undefined ? { value: value.value } : {}),
      ...(typeof value.error === 'string' ? { error: value.error } : {}),
    }
  }
  if (value.type === 'state' && typeof value.hasHandle === 'boolean') {
    return {
      type: 'state',
      hasHandle: value.hasHandle,
      dirName: typeof value.dirName === 'string' ? value.dirName : null,
      label: typeof value.label === 'string' ? value.label : '',
      // 缺省/非法一律回落默认策略：1.0.0 客户端不上报 policy 时行为与旧版一致。
      policy: normalizeSharePolicy(value.policy),
    }
  }
  return null
}

/**
 * 解析一条 host 发来的原始文本帧；非法帧返回 null（wire 边界，宽松丢弃）。
 * @param raw - WebSocket message 的文本内容。
 * @returns 校验后的帧，或 null。
 */
export function parseHostFrame(raw: string): HostFrame | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(value)) return null
  if (value.type === 'call'
    && typeof value.rpcId === 'string'
    && typeof value.op === 'string'
    && OPS.has(value.op)
    && isRecord(value.args)) {
    const access = isRecord(value.policy) && typeof value.policy.access === 'string' && SHARE_ACCESSES.has(value.policy.access)
      ? value.policy.access as ShareAccess
      : undefined
    return {
      type: 'call',
      rpcId: value.rpcId,
      op: value.op as FsOp,
      args: value.args,
      ...(typeof value.caller === 'string' ? { caller: value.caller } : {}),
      ...(access !== undefined ? { policy: { access } } : {}),
    }
  }
  if (value.type === 'cancel' && typeof value.rpcId === 'string') {
    return { type: 'cancel', rpcId: value.rpcId }
  }
  if (value.type === 'roster' && Array.isArray(value.executors)) {
    const executors: RosterExecutor[] = []
    for (const entry of value.executors as unknown[]) {
      if (!isRecord(entry) || typeof entry.label !== 'string') return null
      const scope: ShareScope = typeof entry.scope === 'string' && SHARE_SCOPES.has(entry.scope)
        ? entry.scope as ShareScope
        : 'global'
      const access: ShareAccess = typeof entry.access === 'string' && SHARE_ACCESSES.has(entry.access)
        ? entry.access as ShareAccess
        : 'readwrite'
      executors.push({
        label: entry.label,
        dirName: typeof entry.dirName === 'string' ? entry.dirName : null,
        scope,
        access,
      })
    }
    return { type: 'roster', executors }
  }
  return null
}
