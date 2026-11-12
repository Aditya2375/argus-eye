// Live Vessels: keyless via Finnish Digitraffic AIS (Finnish waters, live).
// Add an AISStream key in POWER UP for worldwide coverage over their
// websocket — the browser connects directly, no server round-trip.
import * as Cesium from 'cesium';
import type { LayerDeps } from './common';
import { Poller } from './common';
import { LiveLayer, type LiveFix } from '../core/liveLayer';
import { tracker } from '../core/track';
import type { HudLayer } from '../core/hud';
import { registerDetectSource, unregisterDetectSource } from '../core/detect';
import { settings } from '../core/settings';
import { fmtKnots } from '../core/dom';
import { bus } from '../core/bus';

export function createVesselsLayer(deps: LayerDeps): HudLayer {
  const live = new LiveLayer({
    name: 'vessels',
    viewer: deps.viewer,
    maxBillboards: 12000,
    defaultColor: '#4dd0a2',
    glyphFor: () => 'ship',
    detectable: true,
    detectLabel: (f) => String(f.meta.name ?? f.id),
  }, 20000, 600000);

  let ws: WebSocket | null = null;

  const poller = new Poller(async () => {
    // keyless baseline: Digitraffic Finland latest AIS snapshot (proxied;
    // Digitraffic requires Accept-Encoding, which browsers cannot set)
    const res = await fetch('/api/vessels');
    if (!res.ok) throw new Error(`vessels ${res.status}`);
    const data = (await res.json()) as {
      vessels?: Array<{ id: string; lon: number; lat: number; heading?: number; sogKnots?: number; ts?: number }>;
    };
    const fixes: LiveFix[] = (data.vessels ?? []).map((v) => ({
      id: v.id,
      lon: v.lon, lat: v.lat, alt: 0,
      heading: v.heading,
      speed: typeof v.sogKnots === 'number' ? v.sogKnots * 0.514444 : undefined,
      ts: v.ts ?? Date.now(),
      kind: 'ship',
      meta: { name: `MMSI ${v.id}`, sogKnots: v.sogKnots ?? 0, src: 'Digitraffic (FI)' },
    }));
    live.ingest(fixes);
  }, 30000);
  poller.onError = (err) => console.warn('[vessels]', err);

  function startAisStream(): void {
    if (ws || !settings.keys.aisStream) return;
    try {
      ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
      ws.onopen = () => {
        ws!.send(JSON.stringify({
          APIKey: settings.keys.aisStream,
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FilterMessageTypes: ['PositionReport'],
        }));
        bus.emit('toast', { text: 'AISStream connected — worldwide vessels live.' });
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.MessageType !== 'PositionReport') return;
          const r = msg.Message.PositionReport;
          const meta = msg.MetaData ?? {};
          live.ingest([{
            id: String(r.UserID),
            lon: r.Longitude, lat: r.Latitude, alt: 0,
            heading: r.Cog ?? r.TrueHeading,
            speed: typeof r.Sog === 'number' ? r.Sog * 0.514444 : undefined,
            ts: Date.now(),
            kind: 'ship',
            meta: {
              name: meta.ShipName?.trim() || `MMSI ${r.UserID}`,
              sogKnots: r.Sog ?? 0,
              src: 'AISStream',
            },
          }]);
        } catch { /* malformed frame */ }
      };
      ws.onclose = () => { ws = null; };
      ws.onerror = () => { ws?.close(); ws = null; };
    } catch (err) {
      console.warn('[aisstream]', err);
    }
  }

  const layer: HudLayer = {
    id: 'vessels', name: 'Live Vessels', group: 'Movement', auth: 'free-key', chip: 'VESSELS',
    enabled: false,
    count: () => (layer.enabled ? live.size : null),
    enable: async () => {
      live.start();
      poller.start();
      if (settings.keys.aisStream) startAisStream();
      else bus.emit('toast', { text: 'Vessels keyless via Digitraffic (Finnish waters). Add an AISStream key in POWER UP for worldwide.' });
      layer.enabled = true;
      registerDetectSource({
        name: 'vessels',
        active: () => layer.enabled,
        items: function* () {
          for (const f of live.fixes) {
            yield { id: f.id, label: String(f.meta.name ?? f.id), position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat, 0), color: 'rgba(77,208,162,0.85)' };
          }
        },
      });
    },
    disable: () => {
      layer.enabled = false;
      poller.stop();
      ws?.close(); ws = null;
      live.stop();
      unregisterDetectSource('vessels');
    },
  };

  (layer as unknown as { pickFix: (p: unknown) => LiveFix | null }).pickFix = (p) => live.pickFix(p);
  (layer as unknown as { trackFix: (f: LiveFix) => void }).trackFix = (f) => {
    tracker.track({
      layer: 'vessels',
      id: f.id,
      title: String(f.meta.name || f.id),
      subtitle: `AIS · ${String(f.meta.src ?? '')}`,
      getFix: () => live.getFix(f.id),
      meta: (): Record<string, string> => {
        const cur = live.getFix(f.id);
        if (!cur) return {};
        return {
          SOG: fmtKnots(cur.speed), COG: `${Math.round(cur.heading ?? 0)}°`, MMSI: cur.id,
          SRC: String(cur.meta.src ?? '—'),
        };
      },
      actions: [{ label: 'NEAREST CAM', run: () => bus.emit('cctv:nearest', { lat: f.lat, lon: f.lon }) }],
    });
  };
  return layer;
}
