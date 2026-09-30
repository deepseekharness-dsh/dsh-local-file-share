/**
 * 共享策略的本地存取。
 *
 * 设计取舍：目录句柄存在 IndexedDB（异步、体积不可控），而策略只有几十字节且
 * **启动时就必须进 state 帧**（host 用它挑执行者），因此用 localStorage 同步读写；
 * 解除授权时一并清除（策略随授权生命周期）。localStorage 不可用（隐私模式）时
 * 退化为"本次页面内有效"，与既有 collapsed/device-name 的处理一致。
 * @module dsh-local-file-share/client/policy
 */

import { DEFAULT_SHARE_POLICY, normalizeSharePolicy, type SharePolicy } from '../wire.js'

/** 策略的 localStorage 键（与 device-name/collapsed 同前缀约定）。 */
const POLICY_KEY = 'dsh-local-file-share:share-policy'

/**
 * 读取已保存的策略；缺失/畸形/存储不可用时返回默认策略（全局 + 读写）。
 * @returns 合法策略。
 */
export function readStoredPolicy(): SharePolicy {
  try {
    const raw = localStorage.getItem(POLICY_KEY)
    if (raw === null) return DEFAULT_SHARE_POLICY
    return normalizeSharePolicy(JSON.parse(raw))
  } catch {
    return DEFAULT_SHARE_POLICY
  }
}

/**
 * 保存策略（调用方保证已 normalize）。
 * @param policy - 待保存的策略。
 */
export function writeStoredPolicy(policy: SharePolicy): void {
  try {
    localStorage.setItem(POLICY_KEY, JSON.stringify(policy))
  } catch {
    // 存储不可用：策略只在本次页面存活。
  }
}

/** 清除已保存的策略（解除授权时调用）。 */
export function clearStoredPolicy(): void {
  try {
    localStorage.removeItem(POLICY_KEY)
  } catch {
    // 存储不可用：没有可清除的持久状态。
  }
}
