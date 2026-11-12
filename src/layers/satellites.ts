// Satellites: CelesTrak TLEs propagated with SGP4 (satellite.js), six classes
// with per-class toggles and live counts, orbit ring + rise/set passes.
import * as Cesium from 'cesium';
import * as satellite from 'satellite.js';
import type { LayerDeps } from './common';
import type { HudLayer } from '../core/hud';
import { tracker } from '../core/track';
import { bus } from '../core/bus';
import { el, escapeHtml } from '../core/dom';
import { renderCustomContext } from '../core/hud';

export type SatClass = 'stations' | 'imaging' | 'telecom' | 'starlink' | 'science' | 'debris';

interface SatRec {
  id: string;           // NORAD id
  name: string;
  cls: SatClass;
  satrec: satellite.SatRec;
  billboard?: Cesium.Billboard;
}

const CLASS_STYLE: Record<SatClass, { color: string; label: string }> = {
  stations: { color: '#6dffa8', label: 'STATIONS' },
  imaging: { color: '#59d6ff', label: 'IMAGING' },
  telecom: { color: '#ffb454', label: 'TELECOM' },
  starlink: { color: '#c3b2ff', label: 'STARLINK' },
  science: { color: '#ff8bd1', label: 'SCIENCE' },
  debris: { color: '#8a97a3', label: 'DEBRIS' },
};

function dot(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 24; c.height = 24;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.beginPath(); g.arc(12, 12, 5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 2; g.stroke();
  return c;
}

export function createSatellitesLayer(deps: LayerDeps): HudLayer {
  const sats: SatRec[] = [];
  const visibleClasses = new Set<SatClass>(['stations', 'imaging', 'telecom', 'science', 'debris']);
  let collection: Cesium.BillboardCollection | null = null;
  let orbitRing: Cesium.Entity | null = null;
  let tickRemove: (() => void) | null = null;
  const MAX_STARLINK = 1200; // sampled subset of the full shell for browser perf

  // CelesTrak blocks shared cloud egress IPs but sends CORS '*', so the
  // browser fetches TLEs directly; /api/tle stays as a fallback.
  const TLE_GROUPS: Array<[string, SatClass, number]> = [
    ['stations', 'stations', 60],
    ['weather', 'imaging', 120],
    ['goes', 'imaging', 40],
    ['noaa', 'imaging', 40],
    ['geo', 'telecom', 600],
    ['intelsat', 'telecom', 300],
    ['science', 'science', 300],
    ['starlink', 'starlink', 1600],
    ['iridium-33-debris', 'debris', 200],
    ['cosmos-2251-debris', 'debris', 300],
  ];

  interface CelestrakRow { NORAD_CAT_ID: number; OBJECT_NAME?: string; TLE_LINE1?: string; TLE_LINE2?: string }

  async function loadDirect(): Promise<Array<{ id: string; name: string; cls: SatClass; line1: string; line2: string }>> {
    const out: Array<{ id: string; name: string; cls: SatClass; line1: string; line2: string }> = [];
    const results = await Promise.allSettled(TLE_GROUPS.map(async ([group, cls, cap]) => {
      const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`,
        { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return [];
      const rows = (await r.json()) as CelestrakRow[];
      const mine: Array<{ id: string; name: string; cls: SatClass; line1: string; line2: string }> = [];
      for (const row of (Array.isArray(rows) ? rows : []).slice(0, cap)) {
        if (!row.TLE_LINE1 || !row.TLE_LINE2) continue;
        mine.push({ id: String(row.NORAD_CAT_ID), name: String(row.OBJECT_NAME ?? row.NORAD_CAT_ID), cls, line1: row.TLE_LINE1, line2: row.TLE_LINE2 });
      }
      return mine;
    }));
    for (const r of results) if (r.status === 'fulfilled') out.push(...r.value);
    return out;
  }

  async function load(): Promise<void> {
    let rows = await loadDirect();
    if (!rows.length) {
      const res = await fetch('/api/tle');
      if (!res.ok) throw new Error(`tle ${res.status}`);
      const data = await res.json() as {
        sats: Array<{ id: string; name: string; cls: SatClass; line1: string; line2: string }>;
      };
      rows = data.sats;
    }
    const data = { sats: rows };
    sats.length = 0;
    let starlinkCount = 0;
    for (const s of data.sats) {
      if (s.cls === 'starlink') {
        if (starlinkCount >= MAX_STARLINK) continue;
        starlinkCount++;
      }
      try {
        sats.push({ id: s.id, name: s.name, cls: s.cls, satrec: satellite.twoline2satrec(s.line1, s.line2) });
      } catch { /* bad TLE */ }
    }
  }

  function render(): void {
    if (!collection) return;
    const now = new Date();
    for (const sat of sats) {
      if (!visibleClasses.has(sat.cls)) { if (sat.billboard) sat.billboard.show = false; continue; }
      const pv = satellite.propagate(sat.satrec, now);
      if (!pv || typeof pv.position === 'boolean' || !pv.position) { if (sat.billboard) sat.billboard.show = false; continue; }
      const gmst = satellite.gstime(now);
      const geo = satellite.eciToGeodetic(pv.position as satellite.EciVec3<number>, gmst);
      const lon = satellite.degreesLong(geo.longitude);
      const lat = satellite.degreesLat(geo.latitude);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) { if (sat.billboard) sat.billboard.show = false; continue; }
      const alt = geo.height * 1000;
      if (!sat.billboard) {
        sat.billboard = collection.add({
          position: Cesium.Cartesian3.fromDegrees(0, 0, 99999999),
          image: dot(CLASS_STYLE[sat.cls].color),
          scale: 0.55,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        });
        (sat.billboard as unknown as { __satId: string }).__satId = sat.id;
      }
      sat.billboard.show = true;
      sat.billboard.position = Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(1, alt));
    }
  }

  function showOrbitRing(sat: SatRec): void {
    if (orbitRing) { deps.viewer.entities.remove(orbitRing); orbitRing = null; }
    const pts: Cesium.Cartesian3[] = [];
    const periodMin = (2 * Math.PI) / sat.satrec.no * (1 / 60) * 60; // minutes
    const start = Date.now();
    const stepMs = (periodMin * 60000) / 120;
    for (let i = 0; i <= 120; i++) {
      const t = new Date(start + i * stepMs);
      const pv = satellite.propagate(sat.satrec, t);
      if (!pv || typeof pv.position === 'boolean' || !pv.position) continue;
      const geo = satellite.eciToGeodetic(pv.position as satellite.EciVec3<number>, satellite.gstime(t));
      pts.push(Cesium.Cartesian3.fromDegrees(
        satellite.degreesLong(geo.longitude), satellite.degreesLat(geo.latitude), Math.max(1, geo.height * 1000)));
    }
    if (pts.length < 8) return;
    orbitRing = deps.viewer.entities.add({
      polyline: {
        positions: pts,
        width: 1.6,
        material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString(CLASS_STYLE[sat.cls].color).withAlpha(0.75) }),
      },
    });
  }

  function passes(sat: SatRec, observerLat: number, observerLon: number): Array<{ rise: Date; set: Date; maxEl: number }> {
    const out: Array<{ rise: Date; set: Date; maxEl: number }> = [];
    const obs: satellite.GeodeticLocation = {
      longitude: satellite.degreesToRadians(observerLon),
      latitude: satellite.degreesToRadians(observerLat),
      height: 0,
    };
    let inPass = false; let rise: Date | null = null; let maxEl = 0;
    const start = Date.now();
    for (let t = 0; t <= 24 * 3600 * 1000; t += 30000) {
      const d = new Date(start + t);
      const pv = satellite.propagate(sat.satrec, d);
      if (!pv || typeof pv.position === 'boolean' || !pv.position) continue;
      const ecf = satellite.eciToEcf(pv.position as satellite.EciVec3<number>, satellite.gstime(d));
      const look = satellite.ecfToLookAngles(obs, ecf);
      const elDeg = (look.elevation * 180) / Math.PI;
      if (elDeg > 5 && !inPass) { inPass = true; rise = d; maxEl = elDeg; }
      else if (elDeg > 5) maxEl = Math.max(maxEl, elDeg);
      else if (elDeg <= 5 && inPass) {
        inPass = false;
        if (rise) out.push({ rise, set: d, maxEl });
        if (out.length >= 3) break;
      }
    }
    return out;
  }

  function pick(picked: unknown): boolean {
    const prim = (picked as { primitive?: Cesium.Billboard })?.primitive;
    const id = prim && (prim as unknown as { __satId?: string }).__satId;
    if (!id) return false;
    const sat = sats.find((s) => s.id === id);
    if (!sat) return false;
    showOrbitRing(sat);
    tracker.track({
      layer: 'satellites',
      id: sat.id,
      title: sat.name,
      subtitle: `${CLASS_STYLE[sat.cls].label} · NORAD ${sat.id}`,
      getFix: () => {
        const now = new Date();
        const pv = satellite.propagate(sat.satrec, now);
        if (!pv || typeof pv.position === 'boolean' || !pv.position) return null;
        const geo = satellite.eciToGeodetic(pv.position as satellite.EciVec3<number>, satellite.gstime(now));
        return {
          id: sat.id,
          lon: satellite.degreesLong(geo.longitude),
          lat: satellite.degreesLat(geo.latitude),
          alt: geo.height * 1000,
          ts: Date.now(),
          meta: {},
        };
      },
      meta: (): Record<string, string> => {
        const now = new Date();
        const pv = satellite.propagate(sat.satrec, now);
        if (!pv || typeof pv.position === 'boolean' || !pv.position) return {};
        const geo = satellite.eciToGeodetic(pv.position as satellite.EciVec3<number>, satellite.gstime(now));
        const vel = pv.velocity && typeof pv.velocity !== 'boolean'
          ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) : 0;
        return {
          ALT: `${geo.height.toFixed(0)} km`, VELOCITY: `${(vel * 3.6).toFixed(0)} km/h`,
          LAT: satellite.degreesLat(geo.latitude).toFixed(2), LON: satellite.degreesLong(geo.longitude).toFixed(2),
          CLASS: CLASS_STYLE[sat.cls].label,
        };
      },
      actions: [{
        label: 'NEXT PASSES',
        run: () => {
          const node = el('div');
          node.append(el('div', 'ctx-title', escapeHtml(sat.name)));
          node.append(el('div', 'ctx-sub', 'Next rises over the view center'));
          import('../core/camera').then(({ viewCenter }) => {
            const c = viewCenter();
            const list = passes(sat, c.lat, c.lon);
            if (!list.length) node.append(el('div', 'note', 'No pass above 5° elevation in the next 24h.'));
            for (const p of list) {
              node.append(el('div', 'note',
                `Rise ${p.rise.toISOString().slice(11, 16)}Z · set ${p.set.toISOString().slice(11, 16)}Z · max el ${p.maxEl.toFixed(0)}°`));
            }
            renderCustomContext(node);
          });
        },
      }],
    });
    return true;
  }

  const layer: HudLayer = {
    id: 'satellites', name: 'Satellites', group: 'Movement', auth: 'free', chip: 'SATS',
    enabled: false,
    count: () => (layer.enabled ? sats.filter((s) => visibleClasses.has(s.cls)).length : null),
    enable: async () => {
      layer.enabled = true;
      collection = new Cesium.BillboardCollection({ scene: deps.viewer.scene });
      deps.viewer.scene.primitives.add(collection);
      await load();
      const tick = () => render();
      deps.viewer.scene.postUpdate.addEventListener(tick);
      tickRemove = () => deps.viewer.scene.postUpdate.removeEventListener(tick);
    },
    disable: () => {
      layer.enabled = false;
      tickRemove?.(); tickRemove = null;
      if (collection) { deps.viewer.scene.primitives.remove(collection); collection = null; }
      if (orbitRing) { deps.viewer.entities.remove(orbitRing); orbitRing = null; }
      sats.length = 0;
    },
  };
  (layer as unknown as { pick: (p: unknown) => boolean }).pick = pick;
  (layer as unknown as { toggleClass: (cls: SatClass, on: boolean) => void }).toggleClass = (cls, on) => {
    if (on) visibleClasses.add(cls); else visibleClasses.delete(cls);
  };
  (layer as unknown as { classCounts: () => Record<string, number> }).classCounts = () => {
    const counts: Record<string, number> = {};
    for (const cls of Object.keys(CLASS_STYLE)) {
      counts[cls] = sats.filter((s) => s.cls === cls && visibleClasses.has(s.cls as SatClass)).length;
    }
    return counts;
  };
  return layer;
}
