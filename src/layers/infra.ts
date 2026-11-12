// Bundled static infrastructure: Datacenters, Dams, Submarine Cables —
// built at deploy time by scripts/build-data.mjs (OSM + TeleGeography,
// see DATA_SOURCES.md), plus Shipwrecks (Wikidata via /api/wrecks).
import * as Cesium from 'cesium';
import type { LayerDeps, PointItem } from './common';
import { Poller, PointLayer } from './common';
import type { HudLayer } from '../core/hud';

interface BundledPoint { n?: string; la: number; lo: number; o?: string; c?: number }

function makeBundledPointLayer(deps: LayerDeps, opts: {
  id: string; name: string; file: string; color: string; size: number; chip?: string; group?: string;
}): HudLayer {
  const points = new PointLayer(opts.id, deps.viewer);
  let loaded = false;

  async function load(): Promise<void> {
    if (loaded) return;
    const res = await fetch(`/data/${opts.file}`);
    if (!res.ok) throw new Error(`${opts.file} ${res.status}`);
    const rows = await res.json() as BundledPoint[];
    const items: PointItem[] = rows.map((r, i) => ({
      id: String(i),
      lon: r.lo, lat: r.la, alt: 0,
      size: opts.size, color: opts.color,
      title: r.n ?? `${opts.name} site`,
      subtitle: `${opts.name} · bundled OpenStreetMap data`,
      meta: (r.o ? { OPERATOR: r.o, CAPACITY: r.c ? `${r.c}` : '—' } : {}) as Record<string, string>,
    }));
    points.setItems(items);
    loaded = true;
  }

  const layer: HudLayer = {
    id: opts.id, name: opts.name, group: opts.group ?? 'Infrastructure', auth: 'free', chip: opts.chip,
    enabled: false,
    count: () => (layer.enabled ? points.size : null),
    enable: async () => {
      points.start();
      layer.enabled = true;
      try { await load(); } catch (e) { console.warn(`[${opts.id}]`, e); }
    },
    disable: () => { layer.enabled = false; points.stop(); loaded = false; },
  };
  (layer as unknown as { pointLayer: PointLayer }).pointLayer = points;
  return layer;
}

export function createDatacentersLayer(deps: LayerDeps): HudLayer {
  return makeBundledPointLayer(deps, {
    id: 'datacenters', name: 'Datacenters', file: 'datacenters.json',
    color: '#8bd3ff', size: 6, chip: 'DATACENTERS',
  });
}

export function createDamsLayer(deps: LayerDeps): HudLayer {
  return makeBundledPointLayer(deps, {
    id: 'dams', name: 'Dams', file: 'dams.json', color: '#59d6ff', size: 5, chip: 'DAMS',
  });
}

export function createCablesLayer(deps: LayerDeps): HudLayer {
  let ds: Cesium.GeoJsonDataSource | null = null;
  const layer: HudLayer = {
    id: 'cables', name: 'Submarine Cables', group: 'Infrastructure', auth: 'free', chip: 'CABLES',
    enabled: false,
    count: () => (layer.enabled && ds ? ds.entities.values.length : null),
    enable: async () => {
      ds = new Cesium.GeoJsonDataSource('cables');
      deps.viewer.dataSources.add(ds);
      layer.enabled = true;
      try {
        const res = await fetch('/data/cables.geojson');
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        await ds!.load(data, {
          stroke: Cesium.Color.fromCssColorString('#6dffa8').withAlpha(0.75),
          strokeWidth: 2,
          clampToGround: true,
        });
      } catch (err) {
        console.warn('[cables]', err);
      }
    },
    disable: () => {
      layer.enabled = false;
      if (ds) { deps.viewer.dataSources.remove(ds, true); ds = null; }
    },
  };
  return layer;
}

export function createShipwrecksLayer(deps: LayerDeps): HudLayer {
  const points = new PointLayer('wrecks', deps.viewer);
  const poller = new Poller(async () => {
    const res = await fetch('/api/wrecks');
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json() as { wrecks: Array<{ id: string; name: string; lat: number; lon: number; link?: string | null }> };
    const items: PointItem[] = (data.wrecks ?? []).map((w) => ({
      id: w.id, lon: w.lon, lat: w.lat, alt: 0,
      size: 5, color: '#c9a86a',
      title: w.name,
      subtitle: 'Wikidata shipwreck · has a Wikipedia article',
      meta: { WIKIDATA: w.id },
      link: w.link ?? `https://www.wikidata.org/wiki/${w.id}`,
    }));
    points.setItems(items);
  }, 24 * 3600 * 1000);
  poller.onError = (e) => console.warn('[wrecks]', e);

  const layer: HudLayer = {
    id: 'shipwrecks', name: 'Shipwrecks', group: 'Events', auth: 'free',
    enabled: false,
    count: () => (layer.enabled ? points.size : null),
    enable: async () => { points.start(); poller.start(); layer.enabled = true; },
    disable: () => { layer.enabled = false; poller.stop(); points.stop(); },
  };
  (layer as unknown as { pointLayer: PointLayer }).pointLayer = points;
  return layer;
}
