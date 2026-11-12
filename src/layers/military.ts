// Military Flights: adsb.fi / adsb.lol military feed in amber; emergency in red.
// Selecting a contact can backfill ~24h of real trace history as 3D loops.
import * as Cesium from 'cesium';
import type { LayerDeps } from './common';
import { Poller } from './common';
import { LiveLayer, type LiveFix } from '../core/liveLayer';
import { tracker } from '../core/track';
import type { HudLayer } from '../core/hud';
import { registerDetectSource, unregisterDetectSource } from '../core/detect';
import { fmtFeet, fmtKnots } from '../core/dom';
import { bus } from '../core/bus';

interface MilAircraft {
  hex: string; flight?: string; lat: number; lon: number; alt_baro?: number | string;
  gs?: number; track?: number; squawk?: string; t?: string; seen?: number;
  emergency?: string; category?: string;
}

export function createMilitaryLayer(deps: LayerDeps): HudLayer {
  const traceEntities: Cesium.Entity[] = [];
  const live = new LiveLayer({
    name: 'military',
    viewer: deps.viewer,
    maxBillboards: 4000,
    defaultColor: '#ffb454',
    glyphFor: (f) => (f.kind === 'heli' ? 'heli' : 'plane'),
    detectable: true,
    detectLabel: (f) => String(f.meta.callsign ?? f.id),
  }, 12000, 240000);

  async function loadTrace(hex: string): Promise<void> {
    try {
      const res = await fetch(`/api/trace?hex=${encodeURIComponent(hex)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { points?: Array<{ lat: number; lon: number; alt: number }> };
      const pts = data.points ?? [];
      if (!pts.length) { bus.emit('toast', { text: 'No recorded trace for this contact.', kind: 'warn' }); return; }
      traceEntities.push(deps.viewer.entities.add({
        polyline: {
          positions: pts.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, Math.max(0, p.alt))),
          width: 2.5,
          material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color: Cesium.Color.fromCssColorString('#ffb454') }),
        },
      }));
      if (traceEntities.length > 3) deps.viewer.entities.remove(traceEntities.shift()!);
      bus.emit('caption', `TRACE · ${pts.length.toLocaleString('en-US')} POINTS · ${hex.toUpperCase()}`);
    } catch {
      bus.emit('toast', { text: 'Trace history unavailable for this contact.', kind: 'warn' });
    }
  }

  const poller = new Poller(async () => {
    const res = await fetch('/api/military');
    if (!res.ok) throw new Error(`military ${res.status}`);
    const data = (await res.json()) as { ac?: MilAircraft[] };
    const now = Date.now();
    const fixes: LiveFix[] = [];
    for (const a of data.ac ?? []) {
      if (typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
      const altM = typeof a.alt_baro === 'number' ? a.alt_baro * 0.3048 : 0;
      const emergency = a.emergency && a.emergency !== 'none';
      fixes.push({
        id: a.hex,
        lon: a.lon, lat: a.lat, alt: altM,
        heading: typeof a.track === 'number' ? a.track : undefined,
        speed: typeof a.gs === 'number' ? a.gs * 0.514444 : undefined,
        ts: now - (a.seen ?? 0) * 1000,
        kind: (a.category ?? '').startsWith('A7') ? 'heli' : 'plane',
        color: emergency ? '#ff5a5a' : '#ffb454',
        meta: {
          callsign: (a.flight ?? '').trim() || a.hex,
          gsKnots: typeof a.gs === 'number' ? a.gs : 0,
          altFeet: typeof a.alt_baro === 'number' ? a.alt_baro : 0,
          squawk: a.squawk ?? '', type: a.t ?? '',
          emergency: emergency ? String(a.emergency) : '',
        },
      });
    }
    live.ingest(fixes);
  }, 20000);
  poller.onError = (err) => console.warn('[military]', err);

  const layer: HudLayer = {
    id: 'military', name: 'Military Flights', group: 'Movement', auth: 'free', chip: 'MIL',
    enabled: false,
    count: () => (layer.enabled ? live.size : null),
    enable: async () => {
      live.start();
      poller.start();
      layer.enabled = true;
      registerDetectSource({
        name: 'military',
        active: () => layer.enabled,
        items: function* () {
          for (const f of live.fixes) {
            yield {
              id: f.id,
              label: String(f.meta.callsign ?? f.id),
              position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat, Math.max(0, f.alt)),
              color: 'rgba(255,180,84,0.85)',
            };
          }
        },
      });
    },
    disable: () => {
      layer.enabled = false;
      poller.stop();
      live.stop();
      unregisterDetectSource('military');
      for (const e of traceEntities.splice(0)) deps.viewer.entities.remove(e);
    },
  };

  (layer as unknown as { pickFix: (p: unknown) => LiveFix | null }).pickFix = (p) => live.pickFix(p);
  (layer as unknown as { trackFix: (f: LiveFix) => void }).trackFix = (f) => {
    tracker.track({
      layer: 'military',
      id: f.id,
      title: String(f.meta.callsign || f.id),
      subtitle: `MILITARY ADS-B${f.meta.emergency ? ` · ⚠ ${String(f.meta.emergency).toUpperCase()}` : ''}`,
      getFix: () => live.getFix(f.id),
      meta: (): Record<string, string> => {
        const cur = live.getFix(f.id);
        if (!cur) return {};
        return {
          ALT: fmtFeet(cur.alt), GS: fmtKnots(cur.speed), HDG: `${Math.round(cur.heading ?? 0)}°`,
          SQUAWK: String(cur.meta.squawk || '—'), TYPE: String(cur.meta.type || '—'), ICAO: cur.id,
        };
      },
      actions: [{ label: 'TRACE 24H', run: () => void loadTrace(f.id) }],
    });
  };
  return layer;
}
