// Small DOM + format helpers shared across modules.
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className = '', text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

export function fmtKnots(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  return `${Math.round(ms * 1.94384)} kt`;
}

export function fmtFeet(m: number | null | undefined): string {
  if (m == null || Number.isNaN(m)) return '—';
  return `${Math.round(m * 3.28084).toLocaleString('en-US')} ft`;
}

export function fmtKm(m: number | null | undefined): string {
  if (m == null || Number.isNaN(m)) return '—';
  return m >= 10000 ? `${Math.round(m / 1000).toLocaleString('en-US')} km` : `${(m / 1000).toFixed(1)} km`;
}

export function fmtDeg(d: number | null | undefined): string {
  if (d == null || Number.isNaN(d)) return '—';
  return `${Math.round(((d % 360) + 360) % 360)}°`;
}

export function timeAgo(isoOrMs: string | number): string {
  const t = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export async function fetchJson<T = unknown>(url: string, init?: RequestInit, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
