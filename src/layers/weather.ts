// Observed weather: NOAA nowCOAST WMS — rain radar (MRMS, CONUS), satellite
// clouds (GOES infrared), lightning density — on one history timeline with
// Play / step-back / Latest. Cyclone advisories draw NHC/CPHC positions.
import * as Cesium from 'cesium';
import type { LayerDeps } from './common';
import { Poller, toastErrors } from './common';
import type { HudLayer } from '../core/hud';
import { bus } from '../core/bus';
import { el } from '../core/dom';
import { renderCustomContext } from '../core/hud';

const WMS = {
  radar: 'https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows',
  satellite: 'https://nowcoast.noaa.gov/geoserver/observations/satellite/ows',
  lightning: 'https://nowcoast.noaa.gov/geoserver/observations/lightning_detection/ows',
};

function wmsLayer(base: string, layerName: string, timeIso?: string): Cesium.ImageryLayer {
  const params: Record<string, string> = {
    transparent: 'true',
    format: 'image/png',
    layers: layerName,
    styles: '',
  };
  if (timeIso) params.time = timeIso;
  return new Cesium.ImageryLayer(
    new Cesium.WebMapServiceImageryProvider({
      url: base,
      layers: layerName,
      parameters: params,
      credit: 'NOAA nowCOAST',
    }),
    { alpha: 0.75 },
  );
}

interface TimelineState {
  layer: Cesium.ImageryLayer | null;
  base: string;
  name: string;
  times: string[];
  idx: number;
  playing: boolean;
}

export function createObservedWeatherLayer(deps: LayerDeps, kind: 'radar' | 'satellite' | 'lightning'): HudLayer {
  const meta = {
    radar: { name: 'Rain Radar (US)', base: WMS.radar, layerName: 'base_reflectivity' },
    satellite: { name: 'Satellite Clouds', base: WMS.satellite, layerName: 'regional_infrared' },
    lightning: { name: 'Lightning Density', base: WMS.lightning, layerName: 'lightning_strike_density' },
  }[kind];

  const state: TimelineState = { layer: null, base: meta.base, name: meta.layerName, times: [], idx: -1, playing: false };
  let playTimer: ReturnType<typeof setInterval> | null = null;

  async function loadTimes(): Promise<void> {
    // nowCOAST exposes available times through layer metadata; use GetCapabilities time extent.
    const r = await fetch(`${meta.base}?service=WMS&request=GetCapabilities&version=1.1.1`);
    if (!r.ok) throw new Error(String(r.status));
    const text = await r.text();
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const layers = [...doc.querySelectorAll('Layer > Name')];
    const node = layers.find((n) => n.textContent === meta.layerName);
    const extent = node?.parentElement?.querySelector('Extent');
    const extentText = extent?.textContent ?? '';
    state.times = extentText.split(',').map((s) => s.trim()).filter(Boolean).slice(-12);
    state.idx = state.times.length - 1;
    // fallback: if the specific layer name is not present, just show latest
    if (!state.times.length) state.times = [];
  }

  function show(): void {
    if (state.layer) deps.viewer.imageryLayers.remove(state.layer, true);
    state.layer = wmsLayer(state.base, state.name, state.idx >= 0 ? state.times[state.idx] : undefined);
    deps.viewer.imageryLayers.add(state.layer);
  }

  function openTimeline(): void {
    const node = el('div');
    node.append(el('div', 'ctx-title', meta.name.toUpperCase()));
    node.append(el('div', 'ctx-sub', 'Observed history — step back through the timeline'));
    const label = el('div', 'note', state.idx >= 0 ? `T: ${state.times[state.idx]?.replace('T', ' ').slice(5, 16)}Z` : 'LATEST');
    const row = el('div', 'ctx-actions');
    const back = el('button', 'abtn', '◀ BACK');
    const play = el('button', 'abtn', state.playing ? 'PAUSE' : 'PLAY');
    const latest = el('button', 'abtn', 'LATEST');
    back.onclick = () => {
      if (!state.times.length) return;
      state.idx = Math.max(0, state.idx - 1);
      show();
      label.textContent = `T: ${state.times[state.idx]?.replace('T', ' ').slice(5, 16)}Z`;
    };
    latest.onclick = () => {
      state.idx = state.times.length - 1;
      show();
      label.textContent = state.idx >= 0 ? `T: ${state.times[state.idx]?.replace('T', ' ').slice(5, 16)}Z` : 'LATEST';
    };
    play.onclick = () => {
      state.playing = !state.playing;
      play.textContent = state.playing ? 'PAUSE' : 'PLAY';
      if (state.playing) {
        playTimer = setInterval(() => {
          if (!state.times.length) return;
          state.idx = (state.idx + 1) % state.times.length;
          show();
          label.textContent = `T: ${state.times[state.idx]?.replace('T', ' ').slice(5, 16)}Z`;
        }, 1200);
      } else if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
      }
    };
    row.append(back, play, latest);
    node.append(row, label);
    renderCustomContext(node);
  }

  const poller = new Poller(async () => { await loadTimes(); if (layer.enabled) show(); }, 120000);
  poller.onError = toastErrors('weather:' + kind);

  const layer: HudLayer = {
    id: `wx-${kind}`, name: meta.name, group: 'Weather', auth: 'free',
    chip: kind === 'radar' ? 'RADAR' : kind === 'satellite' ? 'CLOUDS' : 'LIGHTNING',
    enabled: false,
    count: () => null,
    enable: async () => {
      layer.enabled = true;
      try { await loadTimes(); } catch { bus.emit('toast', { text: `${meta.name}: metadata fetch failed, showing latest.`, kind: 'warn' }); }
      show();
      poller.start();
      openTimeline();
    },
    disable: () => {
      layer.enabled = false;
      poller.stop();
      state.playing = false;
      if (playTimer) { clearInterval(playTimer); playTimer = null; }
      if (state.layer) { deps.viewer.imageryLayers.remove(state.layer, true); state.layer = null; }
    },
  };
  return layer;
}

// ---- Cyclones ----
export function createCyclonesLayer(deps: LayerDeps): HudLayer {
  let ds: Cesium.CustomDataSource | null = null;
  const poller = new Poller(async () => {
    const res = await fetch('/api/cyclones');
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json() as {
      storms: Array<{ id: string; name: string; classification: string; intensity: string; lat: number; lon: number; movementDir?: number; movementSpeed?: number; lastUpdate?: string }>;
    };
    if (!ds) return;
    ds.entities.removeAll();
    for (const s of data.storms) {
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 0),
        point: {
          pixelSize: 14,
          color: Cesium.Color.fromCssColorString('#ff8bd1').withAlpha(0.9),
          outlineColor: Cesium.Color.WHITE.withAlpha(0.7),
          outlineWidth: 2,
        },
        label: {
          text: `${s.name} (${s.classification})`,
          font: '11px "JetBrains Mono", monospace',
          fillColor: Cesium.Color.fromCssColorString('#ff8bd1'),
          pixelOffset: new Cesium.Cartesian2(0, -18),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#05080c').withAlpha(0.75),
        },
      });
    }
  }, 5 * 60 * 1000);
  poller.onError = toastErrors('cyclones');

  const layer: HudLayer = {
    id: 'cyclones', name: 'Cyclone Advisories', group: 'Weather', auth: 'free', chip: 'CYCLONES',
    enabled: false,
    count: () => (layer.enabled && ds ? ds.entities.values.length : null),
    enable: async () => {
      ds = new Cesium.CustomDataSource('cyclones');
      deps.viewer.dataSources.add(ds);
      poller.start();
      layer.enabled = true;
    },
    disable: () => {
      layer.enabled = false;
      poller.stop();
      if (ds) { deps.viewer.dataSources.remove(ds, true); ds = null; }
    },
  };
  return layer;
}
