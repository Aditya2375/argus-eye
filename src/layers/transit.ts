// Transit + Rail: live buses, trams, metros and trains from keyless
// GTFS-Realtime operator feeds (decoded server-side by /api/gtfsrt).
import * as Cesium from 'cesium';
import type { LayerDeps } from './common';
import { Poller, toastErrors } from './common';
import { LiveLayer, type LiveFix } from '../core/liveLayer';
import { tracker } from '../core/track';
import type { HudLayer } from '../core/hud';
import { fmtKnots } from '../core/dom';

interface GtfsVehicle {
  id: string; label?: string; lat: number; lon: number;
  heading?: number | null; speed?: number | null; route?: string; mode?: string;
}

const TRANSIT_FEEDS = ['mbta', 'helsinki', 'queensland', 'rio', 'rioBrt', 'prague'];
const RAIL_FEEDS = ['vr', 'septaRail', 'adelaideMetro', 'metra'];

function makeGtfsLayer(deps: LayerDeps, opts: {
  id: string; name: string; chip?: string; feeds: string[];
  color: string; kind: string; pollMs: number;
}): HudLayer {
  const live = new LiveLayer({
    name: opts.id,
    viewer: deps.viewer,
    maxBillboards: 6000,
    clampToGround: true,
    defaultColor: opts.color,
    glyphFor: () => opts.kind,
    detectable: false,
    detectLabel: (f) => String(f.meta.label ?? f.id),
  }, 15000, 300000);

  const poller = new Poller(async () => {
    const results = await Promise.allSettled(opts.feeds.map(async (feed) => {
      const res = await fetch(`/api/gtfsrt?feed=${feed}`);
      if (!res.ok) throw new Error(`${feed} ${res.status}`);
      const data = await res.json() as { vehicles?: GtfsVehicle[] };
      const now = Date.now();
      const fixes: LiveFix[] = [];
      for (const v of data.vehicles ?? []) {
        fixes.push({
          id: `${feed}:${v.id}`,
          lon: v.lon, lat: v.lat, alt: 0,
          heading: v.heading ?? undefined,
          speed: v.speed ?? undefined,
          ts: now,
          kind: opts.kind,
          meta: { label: v.label || v.route || v.id, route: v.route ?? '', feed },
        });
      }
      live.ingest(fixes);
    }));
    for (const r of results) if (r.status === 'rejected') console.warn(`[${opts.id}]`, r.reason);
  }, opts.pollMs);
  poller.onError = toastErrors(opts.id);

  const layer: HudLayer = {
    id: opts.id, name: opts.name, group: 'Movement', auth: 'free', chip: opts.chip,
    enabled: false,
    count: () => (layer.enabled ? live.size : null),
    enable: async () => { live.start(); poller.start(); layer.enabled = true; },
    disable: () => { layer.enabled = false; poller.stop(); live.stop(); },
  };

  (layer as unknown as { pickFix: (p: unknown) => LiveFix | null }).pickFix = (p) => live.pickFix(p);
  (layer as unknown as { trackFix: (f: LiveFix) => void }).trackFix = (f) => {
    tracker.track({
      layer: opts.id,
      id: f.id,
      title: String(f.meta.label || f.id),
      subtitle: `GTFS-RT · ${String(f.meta.feed ?? '')}`,
      getFix: () => live.getFix(f.id),
      meta: (): Record<string, string> => {
        const cur = live.getFix(f.id);
        if (!cur) return {};
        return {
          ROUTE: String(cur.meta.route || '—'),
          SPEED: cur.speed != null ? fmtKnots(cur.speed) : '—',
          FEED: String(cur.meta.feed ?? '—'),
        };
      },
    });
  };
  return layer;
}

export function createTransitLayer(deps: LayerDeps): HudLayer {
  return makeGtfsLayer(deps, {
    id: 'transit', name: 'Transit (buses/trams)', chip: 'TRANSIT', feeds: TRANSIT_FEEDS,
    color: '#8bd3ff', kind: 'bus', pollMs: 25000,
  });
}

export function createRailLayer(deps: LayerDeps): HudLayer {
  return makeGtfsLayer(deps, {
    id: 'rail', name: 'Rail (live trains)', chip: 'RAIL', feeds: RAIL_FEEDS,
    color: '#ffd166', kind: 'train', pollMs: 30000,
  });
}
