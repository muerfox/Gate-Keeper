export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

/** Gate Keeper visual identity: dark navy / electric blue, minimal
 * animation, high-contrast focus states for keyboard/screen-reader users
 * (docs/ACCESSIBILITY.md). Scoped inside the widget's Shadow DOM so it
 * never leaks into or is overridden by the host page's stylesheet. */
export const WIDGET_STYLES = `
:host, .gk-root {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color-scheme: light dark;
}
.gk-root {
  --gk-bg: #0b1220;
  --gk-surface: #101a2e;
  --gk-border: #1f2b45;
  --gk-text: #e6ecf7;
  --gk-muted: #8a97b3;
  --gk-accent: #3b82f6;
  --gk-accent-hover: #5b93f8;
  --gk-danger: #ef4444;
  --gk-radius: 10px;
  display: block;
  box-sizing: border-box;
  background: var(--gk-bg);
  color: var(--gk-text);
  border: 1px solid var(--gk-border);
  border-radius: var(--gk-radius);
  padding: 16px;
  max-width: 360px;
  font-size: 14px;
  line-height: 1.4;
}
.gk-root[data-theme="light"] {
  --gk-bg: #f7f9fc;
  --gk-surface: #ffffff;
  --gk-border: #dde3ee;
  --gk-text: #0b1220;
  --gk-muted: #56617a;
}
.gk-root *, .gk-root *::before, .gk-root *::after { box-sizing: border-box; }
.gk-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.gk-logo { width: 18px; height: 18px; flex: none; }
.gk-title { font-weight: 600; font-size: 13px; }
.gk-tagline { color: var(--gk-muted); font-size: 11px; margin-left: auto; }
.gk-instruction { margin-bottom: 10px; font-size: 13px; }
.gk-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
.gk-tile {
  background: var(--gk-surface);
  border: 1px solid var(--gk-border);
  border-radius: 8px;
  aspect-ratio: 1;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  color: var(--gk-text);
  padding: 0;
}
.gk-tile[aria-pressed="true"] { border-color: var(--gk-accent); box-shadow: 0 0 0 2px var(--gk-accent) inset; }
.gk-tile:focus-visible, .gk-btn:focus-visible, .gk-option:focus-visible {
  outline: 2px solid var(--gk-accent); outline-offset: 2px;
}
.gk-btn {
  background: var(--gk-accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.gk-btn:hover { background: var(--gk-accent-hover); }
.gk-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.gk-btn-row { display: flex; justify-content: flex-end; gap: 8px; }
.gk-option-list { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.gk-option {
  background: var(--gk-surface);
  border: 1px solid var(--gk-border);
  border-radius: 8px;
  padding: 8px 10px;
  color: var(--gk-text);
  text-align: left;
  cursor: pointer;
  width: 100%;
}
.gk-option[aria-selected="true"] { border-color: var(--gk-accent); }
.gk-status { font-size: 12px; color: var(--gk-muted); margin-top: 8px; min-height: 16px; }
.gk-error { color: var(--gk-danger); }
.gk-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid var(--gk-border); border-top-color: var(--gk-accent);
  animation: gk-spin 0.8s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .gk-spinner { animation: none; }
}
@keyframes gk-spin { to { transform: rotate(360deg); } }
.gk-visually-hidden {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap;
}
`;
