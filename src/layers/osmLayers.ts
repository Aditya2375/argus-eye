// Mapped ALPR cameras: license-plate-reader locations tagged in OpenStreetMap
// (incl. DeFlock mapping), one city-sized view at a time. Locations only.
import type { LayerDeps, PointItem } from './common';
import { PointLayer } from './common';
import type { HudLayer } from '../core/hud';
import { viewCenter, viewRectangle, cameraState } from '../core/camera';
import { bus } from '../core/bus';
import { debounce } from '../core/dom';

const OVERPASS = 'https://overpass-api.de/api/interpreter';

export function createAlprLayer(deps: LayerDeps): HudLayer {
  const points = new PointLayer('alpr', deps.viewer);
  let loading = false;

  const load = debounce(async () => {
    if (!layer.enabled || loading) return;
    const { height } = cameraState();
    if (height > 400000) return; // one city-sized view at a time
    loading = true;
    try {
      const r = viewRectangle();
      const q = `[out:json][timeout:25];node["man_made"="surveillance"]["surveillance:type"="ALPR"](${r.south},${r.west},${r.north},${r.east});out body 500;`;
      const res = await fetch(OVERPASS, { method: 'POST', body: `data=${encodeURIComponent(q)}` });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { elements: Array<{ id: number; lat: number; lon: number; tags?: Record<string, string> }> };
      const items: PointItem[] = (data.elements ?? []).map((n) => ({
        id: String(n.id), lon: n.lon, lat: n.lat, alt: 0,
        size: 6, color: '#ff5a5a',
        title: n.tags?.name ?? 'Mapped ALPR camera',
        subtitle: `OpenStreetMap · ${n.tags?.operator ?? 'operator unknown'}`,
        meta: {
          DIRECTION: n.tags?.direction ?? '—', OPERATOR: n.tags?.operator ?? '—',
          BRAND: n.tags?.brand ?? '—', OSM_NODE: String(n.id),
        },
        link: `https://www.openstreetmap.org/node/${n.id}`,
      }));
      points.setItems(items);
      if (!items.length) bus.emit('toast', { text: 'No mapped ALPR cameras in this view.' });
    } catch (err) {
      console.warn('[alpr]', err);
      bus.emit('toast', { text: 'Overpass query failed — try again in a moment.', kind: 'warn' });
    } finally {
      loading = false;
    }
  }, 800);

  let removeListener: (() => void) | null = null;

  const layer: HudLayer = {
    id: 'alpr', name: 'Mapped ALPR Cameras', group: 'Cameras', auth: 'free',
    enabled: false,
    count: () => (layer.enabled ? points.size : null),
    enable: async () => {
      points.start();
      layer.enabled = true;
      const listener = deps.viewer.camera.moveEnd.addEventListener(load);
      removeListener = () => deps.viewer.camera.moveEnd.removeEventListener(listener);
      void load();
      const c = viewCenter();
      bus.emit('caption', `ALPR · ${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}`);
    },
    disable: () => {
      layer.enabled = false;
      removeListener?.(); removeListener = null;
      points.stop();
    },
  };
  (layer as unknown as { pointLayer: PointLayer }).pointLayer = points;
  (layer as unknown as { reload: () => void }).reload = () => void load();
  return layer;
}

// Mapped Installations: viewport-bounded military-site context from OSM.
export function createInstallationsLayer(deps: LayerDeps): HudLayer {
  const points = new PointLayer('installations', deps.viewer);
  let loading = false;

  const load = debounce(async () => {
    if (!layer.enabled || loading) return;
    const { height } = cameraState();
    if (height > 900000) return;
    loading = true;
    try {
      const r = viewRectangle();
      const q = `[out:json][timeout:25];(
        node["military"](${r.south},${r.west},${r.north},${r.east});
        way["military"](${r.south},${r.west},${r.north},${r.east});
      );out center 400;`;
      const res = await fetch(OVERPASS, { method: 'POST', body: `data=${encodeURIComponent(q)}` });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as {
        elements: Array<{ id: number; type: string; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }>;
      };
      const items: PointItem[] = (data.elements ?? []).map((n) => {
        const lat = n.lat ?? n.center?.lat; const lon = n.lon ?? n.center?.lon;
        return {
          id: `${n.type}${n.id}`, lon: lon!, lat: lat!, alt: 0,
          size: 7, color: '#ffb454',
          title: n.tags?.name ?? `Military ${n.tags?.military ?? 'site'}`,
          subtitle: `OSM · ${n.tags?.military ?? 'military'} · community mapping — incomplete by nature`,
          meta: { TYPE: n.tags?.military ?? '—', OSM: `${n.type}/${n.id}` },
          link: `https://www.openstreetmap.org/${n.type}/${n.id}`,
        };
      }).filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon));
      points.setItems(items);
    } catch (err) {
      console.warn('[installations]', err);
    } finally {
      loading = false;
    }
  }, 900);

  let removeListener: (() => void) | null = null;

  const layer: HudLayer = {
    id: 'installations', name: 'Mapped Installations', group: 'Infrastructure', auth: 'free',
    enabled: false,
    count: () => (layer.enabled ? points.size : null),
    enable: async () => {
      points.start();
      layer.enabled = true;
      const listener = deps.viewer.camera.moveEnd.addEventListener(load);
      removeListener = () => deps.viewer.camera.moveEnd.removeEventListener(listener);
      void load();
      bus.emit('toast', { text: 'Community mapping — incomplete by nature, labeled that way.' });
    },
    disable: () => {
      layer.enabled = false;
      removeListener?.(); removeListener = null;
      points.stop();
    },
  };
  (layer as unknown as { pointLayer: PointLayer }).pointLayer = points;
  return layer;
}
