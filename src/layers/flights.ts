// Live Flights: worldwide ADS-B via the serverless proxy (OpenSky primary,
// adsb.lol / airplanes.live fallback). 11k+ aircraft on real telemetry.
import type { LayerDeps } from './common';
import { Poller, toastErrors } from './common';
import { LiveLayer, type LiveFix } from '../core/liveLayer';
import { viewCenter, cameraState } from '../core/camera';
import { tracker } from '../core/track';
import type { HudLayer } from '../core/hud';
import { registerDetectSource, unregisterDetectSource } from '../core/detect';
import { bus } from '../core/bus';
import { fmtFeet, fmtKnots } from '../core/dom';
import * as Cesium from 'cesium';

interface ApiAircraft {
  hex: string; flight?: string; lat: number; lon: number; alt_baro?: number | string;
  gs?: number; track?: number; squawk?: string; category?: string; t?: string;
  seen?: number; emergency?: string;
}

export function createFlightsLayer(deps: LayerDeps): HudLayer {
  const live = new LiveLayer({
    name: 'flights',
    viewer: deps.viewer,
    maxBillboards: 14000,
    defaultColor: '#59d6ff',
    detectable: true,
    glyphFor: (f) => (f.kind === 'heli' ? 'heli' : 'plane'),
    detectLabel: (f) => String(f.meta.callsign ?? f.id),
  }, 12000, 120000);

  const poller = new Poller(async () => {
    const { lat, lon } = viewCenter();
    const { height } = cameraState();
    const res = await fetch(`/api/flights?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&h=${Math.round(height)}`);
    if (!res.ok) throw new Error(`flights ${res.status}`);
    const data = (await res.json()) as { ac?: ApiAircraft[]; src?: string; stale?: boolean };
    const now = Date.now();
    const fixes: LiveFix[] = [];
    for (const a of data.ac ?? []) {
      if (typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
      const altM = typeof a.alt_baro === 'number' ? a.alt_baro * 0.3048 : 0;
      const cat = a.category ?? '';
      fixes.push({
        id: a.hex,
        lon: a.lon, lat: a.lat,
        alt: altM,
        heading: typeof a.track === 'number' ? a.track : undefined,
        speed: typeof a.gs === 'number' ? a.gs * 0.514444 : undefined,
        ts: now - (a.seen ?? 0) * 1000,
        kind: cat.startsWith('A7') ? 'heli' : 'plane',
        color: '#59d6ff',
        meta: {
          callsign: (a.flight ?? '').trim() || a.hex,
          gsKnots: typeof a.gs === 'number' ? a.gs : 0,
          altFeet: typeof a.alt_baro === 'number' ? a.alt_baro : 0,
          squawk: a.squawk ?? '',
          type: a.t ?? '',
          category: cat,
          src: data.src ?? '',
        },
      });
    }
    live.ingest(fixes);
  }, 12000);

  poller.onError = toastErrors('flights');

  const layer: HudLayer = {
    id: 'flights', name: 'Live Flights', group: 'Movement', auth: 'free', chip: 'FLIGHTS',
    enabled: false,
    count: () => (layer.enabled ? live.size : null),
    enable: async () => {
      live.start();
      poller.start();
      layer.enabled = true;
      registerDetectSource({
        name: 'flights',
        active: () => layer.enabled,
        items: function* () {
          for (const f of live.fixes) {
            yield {
              id: f.id,
              label: String(f.meta.callsign ?? f.id),
              position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat, Math.max(0, f.alt)),
              color: 'rgba(89,214,255,0.8)',
            };
          }
        },
      });
    },
    disable: () => {
      layer.enabled = false;
      poller.stop();
      live.stop();
      unregisterDetectSource('flights');
    },
  };

  // picking is wired by main: expose pick + track
  (layer as unknown as { pickFix: (p: unknown) => LiveFix | null }).pickFix = (p) => live.pickFix(p);
  (layer as unknown as { trackFix: (f: LiveFix) => void }).trackFix = (f) => {
    tracker.track({
      layer: 'flights',
      id: f.id,
      title: String(f.meta.callsign || f.id),
      subtitle: `ADS-B · ${String(f.meta.type || 'unknown type')}`,
      getFix: () => live.getFix(f.id),
      meta: (): Record<string, string> => {
        const cur = live.getFix(f.id);
        if (!cur) return {};
        return {
          ALT: fmtFeet(cur.alt), GS: fmtKnots(cur.speed), HDG: `${Math.round(cur.heading ?? 0)}°`,
          SQUAWK: String(cur.meta.squawk || '—'), ICAO: cur.id, FEED: String(cur.meta.src || '—'),
        };
      },
      actions: [
        { label: 'PHOTO + ROUTE', run: () => void enrichFlight(f.id) },
        { label: 'SHARE TARGET', run: () => bus.emit('share:target', `flights:${f.id}`) },
      ],
    });
  };
  return layer;
}

async function enrichFlight(hex: string): Promise<void> {
  try {
    const res = await fetch(`/api/flight-info?hex=${encodeURIComponent(hex)}`);
    if (!res.ok) throw new Error(String(res.status));
    const info = await res.json() as {
      type?: string; registration?: string; airline?: string;
      origin?: string; destination?: string; photo?: string;
    };
    const cur = tracker.current;
    if (!cur) return;
    bus.emit('toast', {
      text: [
        info.registration && `REG ${info.registration}`,
        info.type,
        info.airline,
        info.origin && info.destination && `${info.origin} → ${info.destination}`,
        info.photo && 'photo loaded',
      ].filter(Boolean).join(' · ') || 'No enrichment available for this airframe.',
    });
    if (info.photo) bus.emit('track:photo', info.photo);
  } catch {
    bus.emit('toast', { text: 'Enrichment feed unreachable.', kind: 'warn' });
  }
}
