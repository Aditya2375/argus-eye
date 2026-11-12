// NEWS rail: GDELT conflicts worldwide + local news for the country at the
// view center. Renders into the right panel's NEWS tab.
import { bus } from '../core/bus';
import { el, escapeHtml, timeAgo, fetchJson } from '../core/dom';
import { setNewsRenderer } from '../core/hud';
import type { LayerDeps } from './common';
import type { HudLayer } from '../core/hud';

interface Article { title: string; url: string; source?: string; seenAt?: string; image?: string }

let articles: Article[] = [];
let mode: 'conflicts' | 'local' = 'conflicts';
let hours = 24;

export function initNewsPanel(_deps: LayerDeps): HudLayer {
  let retries = 0;
  async function load(): Promise<void> {
    try {
      const q = mode === 'local' ? `mode=local&country=` : `mode=conflicts&hours=${hours}`;
      const data = await fetchJson<{ articles?: Article[] }>(`/api/news?${q}`);
      articles = data.articles ?? [];
    } catch (err) {
      console.warn('[news]', err);
      articles = [];
    }
    // upstreams rate-limit shared cloud IPs; retry a few times instead of staying empty
    if (!articles.length && layer.enabled && retries < 4) {
      retries++;
      setTimeout(() => { if (layer.enabled) void load(); }, 30000);
    }
  }

  function render(body: HTMLElement): void {
    body.innerHTML = '';
    const tabs = el('div', 'ctx-actions');
    const mkTab = (m: typeof mode, label: string) => {
      const b = el('button', `abtn${mode === m ? ' warn' : ''}`, label);
      b.onclick = async () => { mode = m; await load(); render(body); };
      tabs.append(b);
    };
    mkTab('conflicts', 'CONFLICTS');
    mkTab('local', 'LOCAL');
    const mkHours = (h: number) => {
      const b = el('button', `abtn${hours === h ? ' warn' : ''}`, `${h}H`);
      b.onclick = async () => { hours = h; await load(); render(body); };
      tabs.append(b);
    };
    for (const h of [24, 12, 6, 3, 1]) mkHours(h);
    body.append(tabs);
    if (!articles.length) {
      body.append(el('div', 'note', 'No reports in this window — or the news service is unreachable.'));
      return;
    }
    for (const a of articles.slice(0, 60)) {
      const card = el('div', 'news-card');
      const link = document.createElement('a');
      link.href = a.url; link.target = '_blank'; link.rel = 'noopener';
      link.textContent = a.title;
      card.append(link);
      card.append(el('div', 'news-meta', `${escapeHtml(a.source ?? '')} · ${a.seenAt ? timeAgo(a.seenAt) : ''}`));
      body.append(card);
    }
  }

  setNewsRenderer(render);

  const layer: HudLayer = {
    id: 'news', name: 'News (24h)', group: 'Events', auth: 'free', chip: 'NEWS',
    enabled: false,
    count: () => (layer.enabled ? articles.length : null),
    enable: async () => { layer.enabled = true; await load(); bus.emit('caption', 'NEWS · GDELT'); },
    disable: () => { layer.enabled = false; },
  };
  return layer;
}
