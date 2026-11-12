// Earthquakes: USGS all-hour/day feeds, magnitude-scaled rings, fault context.
import type { LayerDeps, PointItem } from './common';
import { Poller, PointLayer, toastErrors } from './common';
import type { HudLayer } from '../core/hud';
import { timeAgo } from '../core/dom';

interface UsgsFeature {
  id: string;
  properties: { mag: number; place: string; time: number; tsunami?: number; url: string; type: string; sig: number; depth?: number };
  geometry: { coordinates: [number, number, number] };
}

export function createEarthquakesLayer(deps: LayerDeps): HudLayer {
  const points = new PointLayer('quakes', deps.viewer);

  const poller = new Poller(async () => {
    const res = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson');
    if (!res.ok) throw new Error(`usgs ${res.status}`);
    const data = (await res.json()) as { features: UsgsFeature[] };
    const items: PointItem[] = [];
    for (const f of data.features) {
      const mag = f.properties.mag ?? 0;
      const [lon, lat, depthKm] = f.geometry.coordinates;
      const color = mag >= 6 ? '#ff5a5a' : mag >= 4.5 ? '#ffb454' : '#59d6ff';
      items.push({
        id: f.id, lon, lat, alt: 0,
        size: Math.min(26, 6 + mag * 2.4),
        color,
        title: `M${mag.toFixed(1)} — ${f.properties.place}`,
        subtitle: `${timeAgo(f.properties.time)} · depth ${depthKm?.toFixed(0) ?? '?'} km${f.properties.tsunami ? ' · TSUNAMI FLAG' : ''}`,
        meta: {
          MAGNITUDE: mag.toFixed(1), DEPTH: `${depthKm?.toFixed(1) ?? '—'} km`,
          TIME: new Date(f.properties.time).toISOString().replace('T', ' ').slice(0, 19) + 'Z',
          SIGNIFICANCE: String(f.properties.sig ?? '—'),
        },
        link: f.properties.url,
      });
    }
    points.setItems(items);
  }, 120000);
  poller.onError = toastErrors('quakes');

  const layer: HudLayer = {
    id: 'earthquakes', name: 'Earthquakes (24h)', group: 'Events', auth: 'free', chip: 'QUAKES',
    enabled: false,
    count: () => (layer.enabled ? points.size : null),
    enable: async () => { points.start(); poller.start(); layer.enabled = true; },
    disable: () => { layer.enabled = false; poller.stop(); points.stop(); },
  };
  (layer as unknown as { pointLayer: PointLayer }).pointLayer = points;
  return layer;
}
