/**
 * 卡片视觉层：全部样式集中在注入式样式表里，跟随 dsh 主题 token。
 *
 * 为什么不用内联 style：内联样式表达不了 :hover / :focus-visible / :active /
 * ::-webkit-scrollbar / @media (prefers-reduced-motion)，而这些正是"好看"与
 * "能用键盘"的关键。这里注入一份 <style>（幂等），组件只挂 className，布局类
 * 属性（定位/尺寸/flex）仍留在内联 style —— 分工清楚，改视觉不用碰组件逻辑。
 *
 * 主题：优先用 dsh 的 --dsw-alias-* token（浅色/深色主题自动跟随），token 缺失
 * （兼容模式、非 dsh 宿主）时退回与旧版一致的深色配色，保证任何上下文都可读。
 * @module dsh-local-file-share/client/styles
 */

/** 样式表元素的 id：幂等注入用。 */
const STYLE_ID = 'dsh-local-file-share-style'

/** 注入的完整样式表。 */
const CARD_CSS = `
/* ---------- 基础 ---------- */
.lfs-card, .lfs-fab, .lfs-mask, .lfs-preview {
  --lfs-surface: var(--dsw-alias-bg-overlay, rgba(32, 33, 36, 0.94));
  --lfs-surface-2: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.06));
  --lfs-border: var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.14));
  --lfs-border-strong: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.25));
  --lfs-text: var(--dsw-alias-label-primary, #e8eaed);
  --lfs-text-dim: var(--dsw-alias-label-secondary, #9aa0a6);
  --lfs-brand: var(--dsw-alias-brand-primary, #8ab4f8);
  --lfs-error: var(--dsw-alias-state-error-primary, #f28b82);
  --lfs-warn: var(--dsw-alias-state-warn-primary, #fbbc04);
  --lfs-radius: 14px;
  --lfs-radius-sm: 8px;
  --lfs-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  box-sizing: border-box;
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--lfs-text);
  -webkit-font-smoothing: antialiased;
}
.lfs-card *, .lfs-fab *, .lfs-preview * { box-sizing: border-box; }

/* ---------- 展开卡片 ---------- */
.lfs-card {
  padding: 12px 14px 0;
  border: 1px solid var(--lfs-border);
  border-radius: var(--lfs-radius);
  background: var(--lfs-surface);
  backdrop-filter: blur(14px) saturate(1.2);
  -webkit-backdrop-filter: blur(14px) saturate(1.2);
  box-shadow:
    0 18px 40px -16px rgba(0, 0, 0, 0.55),
    0 4px 12px -4px rgba(0, 0, 0, 0.3);
  animation: lfs-pop 0.16s var(--lfs-ease);
  transition: box-shadow 0.18s var(--lfs-ease);
}
.lfs-card.is-dragging {
  box-shadow:
    0 26px 60px -18px rgba(0, 0, 0, 0.65),
    0 8px 20px -6px rgba(0, 0, 0, 0.35);
}
@keyframes lfs-pop {
  from { opacity: 0; transform: translateY(4px) scale(0.985); }
  to { opacity: 1; transform: none; }
}

/* 标题行 = 拖拽把手 */
.lfs-head {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 -6px 7px;
  padding: 4px 6px;
  border-radius: 10px;
  cursor: grab;
  outline: none;
  transition: background-color 0.16s var(--lfs-ease);
}
.lfs-head:hover { background: color-mix(in srgb, var(--lfs-text) 7%, transparent); }
.lfs-head:active, .lfs-card.is-dragging .lfs-head { cursor: grabbing; }
.lfs-head:focus-visible {
  box-shadow: 0 0 0 2px var(--lfs-brand);
}
.lfs-title {
  flex: 1;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.lfs-dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 12%, transparent);
}

/* 状态与设备行 */
.lfs-status {
  margin-bottom: 6px;
  color: var(--lfs-text-dim);
  font-size: 12px;
}
.lfs-device {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 9px;
  color: var(--lfs-text-dim);
  font-size: 11.5px;
}

/* ---------- 按钮 ---------- */
.lfs-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid var(--lfs-border-strong);
  border-radius: var(--lfs-radius-sm);
  background: transparent;
  color: var(--lfs-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.14s var(--lfs-ease), border-color 0.14s var(--lfs-ease),
    transform 0.1s var(--lfs-ease), opacity 0.14s var(--lfs-ease);
}
.lfs-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--lfs-text) 9%, transparent);
  border-color: color-mix(in srgb, var(--lfs-text) 34%, transparent);
}
.lfs-btn:active:not(:disabled) { transform: translateY(1px); }
.lfs-btn:focus-visible { outline: 2px solid var(--lfs-brand); outline-offset: 1px; }
.lfs-btn:disabled { opacity: 0.45; cursor: default; }
/* 动作行首个按钮 = 主操作（授权/选择目录） */
.lfs-actions > .lfs-btn:first-child {
  border-color: transparent;
  background: var(--lfs-brand);
  color: var(--dsw-alias-bg-base, #101114);
  font-weight: 600;
}
.lfs-actions > .lfs-btn:first-child:hover:not(:disabled) {
  background: color-mix(in srgb, var(--lfs-brand) 88%, var(--lfs-text));
  border-color: transparent;
}
.lfs-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.lfs-btn--icon {
  min-height: 22px;
  width: 24px;
  padding: 0;
  border-color: transparent;
  color: var(--lfs-text-dim);
  font-size: 13px;
  line-height: 1;
}
.lfs-btn--mini {
  min-height: 20px;
  padding: 0 6px;
  border-color: transparent;
  color: var(--lfs-text-dim);
  font-size: 10.5px;
  opacity: 0.55;
}
.lfs-row:hover .lfs-btn--mini, .lfs-btn--mini:focus-visible { opacity: 1; }
.lfs-btn.is-busy::before {
  content: "";
  width: 10px;
  height: 10px;
  border: 1.5px solid color-mix(in srgb, currentColor 35%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: lfs-spin 0.7s linear infinite;
}
@keyframes lfs-spin { to { transform: rotate(360deg); } }

/* ---------- 输入框 ---------- */
.lfs-input {
  width: 100%;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--lfs-border);
  border-radius: var(--lfs-radius-sm);
  background: var(--lfs-surface-2);
  color: inherit;
  font: inherit;
  font-size: 12px;
  transition: border-color 0.14s var(--lfs-ease), box-shadow 0.14s var(--lfs-ease);
}
.lfs-input:hover { border-color: var(--lfs-border-strong); }
.lfs-input:focus {
  outline: none;
  border-color: var(--lfs-brand);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--lfs-brand) 28%, transparent);
}

/* ---------- 目录树 ---------- */
.lfs-tree {
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px solid var(--lfs-border);
}
.lfs-tree-head {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0 -4px;
  padding: 3px 4px;
  border-radius: 7px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.14s var(--lfs-ease);
}
.lfs-tree-head:hover { background: color-mix(in srgb, var(--lfs-text) 7%, transparent); }
.lfs-scroll {
  margin-top: 5px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--lfs-border-strong) transparent;
}
.lfs-scroll::-webkit-scrollbar { width: 8px; }
.lfs-scroll::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 8px;
  background: var(--lfs-border-strong);
  background-clip: content-box;
}
.lfs-scroll::-webkit-scrollbar-thumb:hover { background: var(--lfs-text-dim); background-clip: content-box; }
.lfs-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  border-radius: 6px;
  transition: background-color 0.12s var(--lfs-ease);
}
.lfs-row:hover { background: color-mix(in srgb, var(--lfs-text) 8%, transparent); }
.lfs-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lfs-name.is-file { color: var(--lfs-brand); cursor: pointer; }
.lfs-name.is-file:hover { text-decoration: underline; }
.lfs-name.is-dir { cursor: pointer; }
.lfs-size {
  margin-left: 2px;
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
}
.lfs-sub { opacity: 0.6; padding: 1px 4px; }
.lfs-err { color: var(--lfs-error); }
.lfs-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; opacity: 0.9; }
.lfs-badge {
  display: inline-block;
  margin-bottom: 4px;
  padding: 1px 7px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--lfs-warn) 20%, transparent);
  color: var(--lfs-warn);
  font-size: 10.5px;
  font-weight: 500;
}
.lfs-compat {
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px solid var(--lfs-border);
  color: var(--lfs-text-dim);
  font-size: 11.5px;
}
.lfs-link { color: var(--lfs-brand); }

/* ---------- 底部高度手柄 ---------- */
.lfs-resize {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  height: 12px;
  cursor: ns-resize;
  opacity: 0.55;
  transition: opacity 0.14s var(--lfs-ease);
}
.lfs-resize:hover { opacity: 1; }
.lfs-resize > span {
  width: 28px;
  height: 3px;
  border-radius: 2px;
  background: var(--lfs-border-strong);
}

/* ---------- 收起态圆钮 ---------- */
.lfs-fab {
  display: grid;
  place-items: center;
  border: 1px solid var(--lfs-border);
  border-radius: 50%;
  background: var(--lfs-surface);
  color: var(--lfs-brand);
  backdrop-filter: blur(14px) saturate(1.2);
  -webkit-backdrop-filter: blur(14px) saturate(1.2);
  box-shadow:
    0 14px 32px -14px rgba(0, 0, 0, 0.6),
    0 3px 10px -4px rgba(0, 0, 0, 0.32);
  cursor: pointer;
  transition: transform 0.16s var(--lfs-ease), box-shadow 0.16s var(--lfs-ease),
    background-color 0.16s var(--lfs-ease);
}
.lfs-fab:hover {
  transform: scale(1.07);
  background: color-mix(in srgb, var(--lfs-surface) 88%, var(--lfs-text));
  box-shadow:
    0 18px 40px -14px rgba(0, 0, 0, 0.65),
    0 4px 12px -4px rgba(0, 0, 0, 0.35);
}
.lfs-fab:active { transform: scale(0.95); }
.lfs-fab:focus-visible { outline: 2px solid var(--lfs-brand); outline-offset: 2px; }
.lfs-fab.is-dragging { cursor: grabbing; transform: scale(1.04); }

/* ---------- 预览窗 ---------- */
.lfs-mask {
  background: color-mix(in srgb, #000 52%, transparent);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  animation: lfs-fade 0.14s var(--lfs-ease);
}
@keyframes lfs-fade { from { opacity: 0; } to { opacity: 1; } }
.lfs-preview {
  border: 1px solid var(--lfs-border);
  border-radius: 12px;
  background: var(--lfs-surface);
  box-shadow:
    0 32px 80px -24px rgba(0, 0, 0, 0.7),
    0 8px 24px -8px rgba(0, 0, 0, 0.4);
}
.lfs-preview-head {
  flex-shrink: 0;
  padding: 9px 12px;
  border-bottom: 1px solid var(--lfs-border);
}
.lfs-preview-handle { cursor: move; }
.lfs-preview-path {
  margin-top: 2px;
  color: var(--lfs-text-dim);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  opacity: 0.8;
}
.lfs-preview-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--lfs-border-strong) transparent;
}
.lfs-preview-body::-webkit-scrollbar { width: 8px; height: 8px; }
.lfs-preview-body::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 8px;
  background: var(--lfs-border-strong);
  background-clip: content-box;
}

/* ---------- 动效降级 ---------- */
@media (prefers-reduced-motion: reduce) {
  .lfs-card, .lfs-fab, .lfs-btn, .lfs-head, .lfs-row, .lfs-input, .lfs-resize {
    animation: none !important;
    transition: none !important;
  }
  .lfs-fab:hover, .lfs-fab:active { transform: none; }
}
`

/**
 * 幂等注入样式表：同一文档只插一次（重复调用是 no-op）。
 * @returns 无。样式随文档存活，不提供拆除（卡片卸载后残留的空样式无副作用）。
 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CARD_CSS
  document.head.appendChild(style)
}
