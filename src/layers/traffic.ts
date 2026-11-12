// Traffic: simulated vehicles on real OSM roads (Overpass), colored by
// simulated flow. Individual positions are a simulation, not observations.
import * as Cesium from 'cesium';
import type { LayerDeps } from './common';
import type { HudLayer } from '../core/hud';
import { cameraState, viewRectangle } from '../core/camera';
import { debounce } from '../core/dom';
import { bus } from '../core/bus';
import { settings } from '../core/settings';

const OVERPASS = 'https://overpass-api.de/api/interpreter';

interface Road { pts: Array<{ lat: number; lon: number }> }
interface Vehicle { road: number; t: number; speed: number; dir: 1 | -1 }

export function createTrafficLayer(deps: LayerDeps): HudLayer {
  let roads: Road[] = [];
  let vehicles: Vehicle[] = [];
  let collection: Cesium.PointPrimitiveCollection | null = null;
  let tickRemove: (() => void) | null = null;
  let loading = false;

  const load = debounce(async () => {
    if (!layer.enabled || loading) return;
    const { height } = cameraState();
    if (height > 120000) return; // street-scale only
    loading = true;
    try {
      const r = viewRectangle();
      const q = `[out:json][timeout:25];way["highway"~"^(motorway|trunk|primary|secondary)$"](${r.south},${r.west},${r.north},${r.east});out geom 250;`;
      const res = await fetch(OVERPASS, { method: 'POST', body: `data=${encodeURIComponent(q)}` });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { elements: Array<{ geometry?: Array<{ lat: number; lon: number }> }> };
      roads = (data.elements ?? [])
        .filter((w) => (w.geometry?.length ?? 0) >= 2)
        .map((w) => ({ pts: w.geometry!.map((g) => ({ lat: g.lat, lon: g.lon })) }));
      vehicles = [];
      const perRoad = Math.max(1, Math.min(6, Math.floor(600 / Math.max(1, roads.length))));
      roads.forEach((_, i) => {
        for (let k = 0; k < perRoad; k++) {
          vehicles.push({ road: i, t: Math.random(), speed: 0.00018 + Math.random() * 0.00035, dir: Math.random() > 0.5 ? 1 : -1 });
        }
      });
      bus.emit('caption', `TRAFFIC SIM · ${roads.length} ROADS · ${vehicles.length} VEHICLES`);
    } catch (err) {
      console.warn('[traffic]', err);
      bus.emit('toast', { text: 'Traffic road fetch failed (Overpass).', kind: 'warn' });
    } finally {
      loading = false;
    }
  }, 1200);

  function tick(): void {
    if (!collection) return;
    collection.removeAll();
    const tomtomNote = settings.keys.tomtom ? ' · TomTom flow active' : '';
    void tomtomNote;
    for (const v of vehicles) {
      const road = roads[v.road];
      if (!road || road.pts.length < 2) continue;
      v.t += v.speed * v.dir;
      if (v.t > 1) { v.t = 1; v.dir = -1; }
      if (v.t < 0) { v.t = 0; v.dir = 1; }
      const fi = v.t * (road.pts.length - 1);
      const i0 = Math.floor(fi);
      const i1 = Math.min(road.pts.length - 1, i0 + 1);
      const frac = fi - i0;
      const lat = road.pts[i0].lat + (road.pts[i1].lat - road.pts[i0].lat) * frac;
      const lon = road.pts[i0].lon + (road.pts[i1].lon - road.pts[i0].lon) * frac;
      collection.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 4),
        pixelSize: 3.2,
        color: Cesium.Color.fromCssColorString('#ffd166').withAlpha(0.9),
      });
    }
  }

  let removeListener: (() => void) | null = null;

  const layer: HudLayer = {
    id: 'traffic', name: 'Traffic (simulated)', group: 'Movement', auth: 'free', chip: 'TRAFFIC',
    enabled: false,
    count: () => (layer.enabled ? vehicles.length : null),
    enable: async () => {
      layer.enabled = true;
      collection = new Cesium.PointPrimitiveCollection();
      deps.viewer.scene.primitives.add(collection);
      const t = () => tick();
      deps.viewer.scene.postUpdate.addEventListener(t);
      tickRemove = () => deps.viewer.scene.postUpdate.removeEventListener(t);
      const listener = deps.viewer.camera.moveEnd.addEventListener(load);
      removeListener = () => deps.viewer.camera.moveEnd.removeEventListener(listener);
      void load();
      bus.emit('toast', { text: 'Traffic is simulated along real roads — vehicle positions are not live observations.' });
    },
    disable: () => {
      layer.enabled = false;
      tickRemove?.(); tickRemove = null;
      removeListener?.(); removeListener = null;
      if (collection) { deps.viewer.scene.primitives.remove(collection); collection = null; }
      roads = []; vehicles = [];
    },
  };
  return layer;
}
