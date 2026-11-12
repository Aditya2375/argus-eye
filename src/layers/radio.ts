// Radio: geolocated world radio (Radio Browser) with an analog tuner —
// drag the needle, the globe flies to each broadcaster and plays its stream.
import * as Cesium from 'cesium';
import type { LayerDeps, PointItem } from './common';
import { Poller, PointLayer } from './common';
import type { HudLayer } from '../core/hud';
import { bus } from '../core/bus';
import { el, escapeHtml } from '../core/dom';
import { renderCustomContext } from '../core/hud';
import { flyTo } from '../core/camera';

interface Station {
  stationuuid: string; name: string; country: string; tags: string;
  geo_lat?: number; geo_long?: number; url_resolved: string; codec?: string;
  votes?: number; bitrate?: number;
}

const MAX_TUNER = 750;

export function createRadioLayer(deps: LayerDeps): HudLayer {
  const points = new PointLayer('radio', deps.viewer);
  let stations: Station[] = [];
  let audio: HTMLAudioElement | null = null;
  let currentIdx = -1;

  const poller = new Poller(async () => {
    const res = await fetch(
      `https://de1.api.radio-browser.info/json/stations/search?has_geo_info=true&order=votes&reverse=true&limit=${MAX_TUNER}&hidebroken=true`);
    if (!res.ok) throw new Error(String(res.status));
    stations = (await res.json()) as Station[];
    const items: PointItem[] = [];
    for (const s of stations) {
      if (s.geo_lat == null || s.geo_long == null) continue;
      items.push({
        id: s.stationuuid,
        lon: s.geo_long, lat: s.geo_lat, alt: 0,
        size: 6, color: '#ffd166',
        title: s.name,
        subtitle: `${s.country} · ${s.tags?.split(',').slice(0, 3).join(', ') || 'radio'}`,
        meta: { COUNTRY: s.country, CODEC: `${s.codec ?? '?'} ${s.bitrate ? `${s.bitrate}kbps` : ''}`, VOTES: String(s.votes ?? 0) },
      });
    }
    points.setItems(items);
  }, 30 * 60 * 1000);
  poller.onError = (e) => console.warn('[radio]', e);

  function play(idx: number): void {
    const s = stations[idx];
    if (!s) return;
    currentIdx = idx;
    if (!audio) audio = new Audio();
    audio.src = s.url_resolved;
    void audio.play().catch(() => bus.emit('toast', { text: 'Stream blocked or unavailable.', kind: 'warn' }));
    if (s.geo_lat != null && s.geo_long != null) flyTo(s.geo_long, s.geo_lat, 120000, 2.2);
    const label = document.querySelector('.tuner-label');
    if (label) label.innerHTML = `▶ <b>${escapeHtml(s.name)}</b> · ${escapeHtml(s.country)}`;
    bus.emit('caption', `RADIO · ${s.name.toUpperCase()}`);
  }

  function openTuner(): void {
    const node = el('div');
    node.append(el('div', 'ctx-title', 'RADIO TUNER'));
    node.append(el('div', 'ctx-sub', `${stations.length.toLocaleString('en-US')} geolocated stations · drag the needle`));
    const scale = el('div', 'tuner-scale');
    const needle = el('div', 'tuner-needle');
    scale.append(needle);
    for (let i = 0; i <= 10; i++) {
      const tick = el('div', 'tuner-tick');
      tick.style.left = `${i * 10}%`;
      scale.append(tick);
    }
    const label = el('div', 'tuner-label', currentIdx >= 0 && stations[currentIdx]
      ? `▶ ${stations[currentIdx].name}` : 'Drag across the scale to tune');
    const actions = el('div', 'ctx-actions');
    const stop = el('button', 'abtn danger', 'STOP');
    stop.onclick = () => { audio?.pause(); label.textContent = 'Stopped'; };
    actions.append(stop);
    let dragRaf = 0;
    const tune = (clientX: number) => {
      const rect = scale.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      needle.style.left = `${frac * 100}%`;
      cancelAnimationFrame(dragRaf);
      dragRaf = requestAnimationFrame(() => play(Math.floor(frac * (stations.length - 1))));
    };
    let dragging = false;
    scale.addEventListener('pointerdown', (e) => { dragging = true; tune(e.clientX); scale.setPointerCapture(e.pointerId); });
    scale.addEventListener('pointermove', (e) => { if (dragging) tune(e.clientX); });
    scale.addEventListener('pointerup', () => { dragging = false; });
    node.append(scale, label, actions);
    renderCustomContext(node);
  }

  const layer: HudLayer = {
    id: 'radio', name: 'World Radio', group: 'Audio', auth: 'free', chip: 'RADIO',
    enabled: false,
    count: () => (layer.enabled ? points.size : null),
    enable: async () => { points.start(); poller.start(); layer.enabled = true; openTuner(); },
    disable: () => { layer.enabled = false; poller.stop(); points.stop(); audio?.pause(); audio = null; },
  };
  (layer as unknown as { pointLayer: PointLayer }).pointLayer = points;
  (layer as unknown as { playStationNamed: (q: string) => boolean }).playStationNamed = (q) => {
    const ql = q.toLowerCase();
    const idx = stations.findIndex((s) => s.name.toLowerCase().includes(ql));
    if (idx >= 0) { play(idx); return true; }
    return false;
  };
  return layer;
}
