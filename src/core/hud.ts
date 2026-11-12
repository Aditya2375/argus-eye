// HUD chrome: left layer panel, right context panel, dock, toasts, caption,
// clock, POWER UP key sheet, keyboard shortcuts.
import { bus } from './bus';
import { el, escapeHtml } from './dom';
import { settings, saveSettings } from './settings';
import { setSensor, setSharpen, type SensorMode } from './fx';
import { resetGlobe, setTilt, setNorthUp, stopMotion } from './camera';
import { tracker, type TrackTarget } from './track';

export interface HudLayer {
  id: string;
  name: string;
  group: string;
  auth: 'free' | 'free-key' | 'paid';
  chip?: string;
  enabled: boolean;
  enable: () => void | Promise<void>;
  disable: () => void;
  count?: () => number | null;
}

const layers: HudLayer[] = [];
let leftPanel: HTMLElement;
let rightBody: HTMLElement;
let dockEl: HTMLElement;
let rightTabs: { context: HTMLElement; news: HTMLElement };
let activeTab: 'context' | 'news' = 'context';
let newsRenderer: ((body: HTMLElement) => void) | null = null;

export function registerLayer(def: HudLayer): void {
  layers.push(def);
}

export function setNewsRenderer(fn: (body: HTMLElement) => void): void {
  newsRenderer = fn;
  if (activeTab === 'news') fn(rightBody);
}

export function initHud(): void {
  leftPanel = document.getElementById('panel-left')!;
  rightBody = document.querySelector('#panel-right .pr-body') ?? buildRightPanel();
  dockEl = document.getElementById('dock')!;

  for (const id of ['topbar', 'panel-left', 'panel-right', 'dock']) {
    document.getElementById(id)?.classList.remove('hidden');
  }
  document.getElementById('panel-left')!.classList.add('glass');
  document.getElementById('panel-right')!.classList.add('glass');
  document.getElementById('dock')!.classList.add('glass');

  renderLeftPanel();
  renderDock();
  wireTopbar();
  wireBus();
  wireKeys();
  startClock();
  // counts land asynchronously after a layer is enabled; keep them fresh
  // without rebuilding rows (which would reset scroll and click state).
  setInterval(() => {
    for (const layer of layers) {
      const span = leftPanel.querySelector(`[data-lstate="${layer.id}"]`);
      if (!span) continue;
      const count = layer.count?.();
      const text = layer.enabled ? (count != null ? `ON · ${count.toLocaleString('en-US')}` : 'ON') : 'OFF';
      if (span.textContent !== text) span.textContent = text;
      const row = span.closest('.lrow');
      if (row) row.classList.toggle('on', layer.enabled);
    }
  }, 4000);
}

function buildRightPanel(): HTMLElement {
  const panel = document.getElementById('panel-right')!;
  panel.innerHTML = '';
  const tabs = el('div', 'pr-tabs');
  const tContext = el('button', 'pr-tab on', 'CONTEXT');
  const tNews = el('button', 'pr-tab', 'NEWS');
  tabs.append(tContext, tNews);
  const body = el('div', 'pr-body');
  panel.append(tabs, body);
  rightTabs = { context: tContext, news: tNews };
  tContext.onclick = () => switchTab('context');
  tNews.onclick = () => switchTab('news');
  return body;
}

function switchTab(tab: 'context' | 'news'): void {
  activeTab = tab;
  rightTabs.context.classList.toggle('on', tab === 'context');
  rightTabs.news.classList.toggle('on', tab === 'news');
  if (tab === 'news' && newsRenderer) newsRenderer(rightBody);
  else renderContext(tracker.current);
}

export function refreshLeftPanel(): void {
  renderLeftPanel();
  renderDock();
}

function renderLeftPanel(): void {
  leftPanel.innerHTML = '';
  const groups = ['Movement', 'Cameras', 'Infrastructure', 'Events', 'Weather', 'Audio', 'Utilities'];
  for (const group of groups) {
    const items = layers.filter((l) => l.group === group);
    if (!items.length) continue;
    const g = el('div', 'pgroup');
    g.append(el('div', 'pg-head', group.toUpperCase()));
    for (const layer of items) {
      const row = el('button', `lrow${layer.enabled ? ' on' : ''}`);
      const dot = el('span', `key-dot${layer.auth === 'free-key' ? ' free-key' : layer.auth === 'paid' ? ' paid' : ''}`);
      dot.title = layer.auth === 'free' ? 'No key needed' : layer.auth === 'free-key' ? 'Free key (optional or required)' : 'Optional paid capability';
      row.append(dot, el('span', 'lname', layer.name));
      const count = layer.count?.();
      const stateSpan = el('span', 'lstate', layer.enabled ? (count != null ? `ON · ${count.toLocaleString('en-US')}` : 'ON') : 'OFF');
      stateSpan.dataset.lstate = layer.id;
      row.append(stateSpan);
      row.onclick = async () => {
        if (layer.enabled) { layer.disable(); }
        else { await layer.enable(); }
        refreshLeftPanel();
      };
      g.append(row);
    }
    leftPanel.append(g);
  }
}

function renderDock(): void {
  dockEl.innerHTML = '';
  for (const layer of layers) {
    if (!layer.chip) continue;
    const chip = el('button', `chip${layer.enabled ? ' on' : ''}`, layer.chip);
    chip.onclick = async () => {
      if (layer.enabled) layer.disable(); else await layer.enable();
      refreshLeftPanel();
    };
    dockEl.append(chip);
  }
  dockEl.append(el('span', 'dock-sep'));
  const detect = el('label', 'dock-slider');
  detect.append(el('span', '', 'DETECT'));
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = String(settings.detectionDensity * 100);
  slider.oninput = () => { settings.detectionDensity = Number(slider.value) / 100; saveSettings(); };
  detect.append(slider);
  dockEl.append(detect);
  const tiltBtn = el('button', 'chip', settings.tilt === 'down' ? 'TOP-DOWN' : 'OBLIQUE');
  tiltBtn.onclick = () => { const next = settings.tilt === 'down' ? 'oblique' : 'down'; setTilt(next); tiltBtn.textContent = next === 'down' ? 'TOP-DOWN' : 'OBLIQUE'; };
  dockEl.append(tiltBtn);
  const northBtn = el('button', `chip${settings.northUp ? ' on' : ''}`, 'N-UP');
  northBtn.onclick = () => { setNorthUp(!settings.northUp); northBtn.classList.toggle('on', settings.northUp); };
  dockEl.append(northBtn);
  const sharp = el('button', 'chip', 'SHARPEN');
  let sharpOn = false;
  sharp.onclick = () => { sharpOn = !sharpOn; setSharpen(sharpOn); sharp.classList.toggle('on', sharpOn); };
  dockEl.append(sharp);
  const stop = el('button', 'chip', 'STOP');
  stop.onclick = () => stopMotion();
  dockEl.append(stop);
  const reset = el('button', 'chip amber', 'RESET GLOBE');
  reset.onclick = () => resetGlobe();
  dockEl.append(reset);
}

function wireTopbar(): void {
  const pills = document.getElementById('sensor-pills')!;
  const modes: Array<[SensorMode, string, string]> = [
    ['normal', '1', 'NORMAL'], ['crt', '2', 'CRT'], ['nvg', '3', 'NVG'], ['flir', '4', 'FLIR'], ['noir', '5', 'NOIR'],
  ];
  for (const [mode, key, label] of modes) {
    const pill = el('button', `pill${settings.sensor === mode ? ' on' : ''}`, label);
    pill.title = `${label} (key ${key})`;
    pill.onclick = () => setSensor(mode);
    pill.dataset.sensor = mode;
    pills.append(pill);
  }
  bus.on<SensorMode>('sensor:changed', (m) => {
    for (const p of pills.querySelectorAll<HTMLElement>('.pill')) p.classList.toggle('on', p.dataset.sensor === m);
  });

  document.getElementById('brand')!.onclick = () => resetGlobe();
  document.getElementById('btn-mapstack')!.onclick = () => bus.emit('mapstack:cycle');
  bus.on<string>('mapstack:changed', (stack) => {
    const label = { esri: 'ESRI SAT', osm: 'OSM', ion3d: 'ION 3D', google3d: 'GOOGLE 3D' }[stack] ?? stack.toUpperCase();
    document.getElementById('btn-mapstack')!.textContent = label;
  });
  bus.emit('mapstack:changed', settings.mapStack);
  document.getElementById('btn-powerup')!.onclick = openPowerUp;
}

function wireBus(): void {
  bus.on<{ text: string; kind?: 'warn' | 'err' }>('toast', ({ text, kind }) => toast(text, kind));
  bus.on<string>('caption', (text) => caption(text));
  bus.on<TrackTarget | null>('track:changed', (t) => { if (activeTab === 'context') renderContext(t); });
}

export function toast(text: string, kind?: 'warn' | 'err'): void {
  const stack = document.getElementById('toast-stack')!;
  const t = el('div', `toast${kind ? ` ${kind}` : ''}`, text);
  stack.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 450); }, 5200);
}

export function caption(text: string, ms = 3200): void {
  const c = document.getElementById('caption')!;
  c.textContent = text;
  c.classList.remove('hidden');
  setTimeout(() => c.classList.add('hidden'), ms);
}

function renderContext(target: TrackTarget | null): void {
  rightBody.innerHTML = '';
  if (!target) {
    rightBody.append(el('div', 'note', 'Nothing tracked. Click any aircraft, vessel, satellite, quake or camera to lock on.'));
    return;
  }
  rightBody.append(el('div', 'ctx-title', escapeHtml(target.title)));
  if (target.subtitle) rightBody.append(el('div', 'ctx-sub', escapeHtml(target.subtitle)));
  const meta = target.meta?.() ?? {};
  for (const [k, v] of Object.entries(meta)) {
    const row = el('div', 'kv');
    row.append(el('span', 'k', escapeHtml(k)), el('span', 'v', escapeHtml(v)));
    rightBody.append(row);
  }
  const actions = el('div', 'ctx-actions');
  const mk = (label: string, kind: 'default' | 'warn' | 'danger', run: () => void) => {
    const b = el('button', `abtn${kind === 'default' ? '' : ` ${kind}`}`, label);
    b.onclick = run;
    actions.append(b);
  };
  if (target.layer !== 'cameras') mk('COCKPIT', 'default', () => tracker.enterCockpit());
  for (const a of target.actions ?? []) mk(a.label, a.kind ?? 'default', a.run);
  mk('UNTRACK', 'danger', () => tracker.untrack());
  rightBody.append(actions);
}

export function renderCustomContext(node: HTMLElement): void {
  switchTab('context');
  rightBody.innerHTML = '';
  rightBody.append(node);
}

function wireKeys(): void {
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const map: Record<string, SensorMode> = { '1': 'normal', '2': 'crt', '3': 'nvg', '4': 'flir', '5': 'noir' };
    if (map[e.key]) setSensor(map[e.key]);
    else if (e.key === 'Escape' && tracker.isCockpit) tracker.exitCockpit();
    else if (e.key === 'Home') resetGlobe();
  });
}

function startClock(): void {
  const clock = document.getElementById('clock')!;
  const tick = () => {
    const d = new Date();
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    clock.textContent = `${hh}:${mm}:${ss}Z`;
  };
  tick();
  setInterval(tick, 1000);
}

function openPowerUp(): void {
  const node = el('div');
  node.append(el('div', 'ctx-title', 'POWER UP'));
  node.append(el('div', 'note',
    'ARGUS EYE runs keyless by default. Optional keys unlock extra capability — they are stored only in this browser.'));
  const fields: Array<[keyof typeof settings.keys, string, string]> = [
    ['cesiumIon', 'Cesium ion token', 'Google Photorealistic 3D via ion (free, non-commercial)'],
    ['googleMaps', 'Google Maps key', 'Direct Photorealistic 3D + place search (metered)'],
    ['aisStream', 'AISStream key', 'Worldwide live vessels'],
    ['firmsMapKey', 'NASA FIRMS map key', 'Active fire detections (free key)'],
  ];
  for (const [key, label, hint] of fields) {
    node.append(el('div', 'note', `${label} — ${hint}`));
    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = settings.keys[key] ? '•••••••• (saved)' : 'not set';
    input.style.cssText = 'width:100%;height:30px;margin:2px 0 8px;background:rgba(5,9,13,.7);border:1px solid var(--line);border-radius:4px;color:var(--ink);padding:0 9px;font-family:var(--mono);font-size:11.5px;outline:none;';
    input.onchange = () => {
      settings.keys[key] = input.value.trim();
      saveSettings();
      toast(input.value.trim() ? `${label} saved.` : `${label} cleared. Reload layers to apply.`);
    };
    node.append(input);
  }
  const note = el('div', 'note');
  note.innerHTML = 'Keys never leave this browser except to their own provider. Get free keys: ' +
    '<a class="ext" href="https://ion.cesium.com/tokens" target="_blank" rel="noopener">Cesium ion</a> · ' +
    '<a class="ext" href="https://aisstream.io" target="_blank" rel="noopener">AISStream</a> · ' +
    '<a class="ext" href="https://firms.modaps.eosdis.nasa.gov/api/map_key/" target="_blank" rel="noopener">FIRMS</a>';
  node.append(note);
  renderCustomContext(node);
}
