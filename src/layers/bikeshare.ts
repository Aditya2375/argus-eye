// Bikeshare: live station availability over GBFS feeds (keyless registry).
import type { LayerDeps, PointItem } from './common';
import { Poller, PointLayer } from './common';
import type { HudLayer } from '../core/hud';

const NETWORKS: Array<{ id: string; name: string; url: string }> = [
  { id: 'nyc', name: 'Citi Bike NYC', url: 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json' },
  { id: 'sf', name: 'Bay Wheels SF', url: 'https://gbfs.lyft.com/gbfs/2.3/bay/en/station_information.json' },
  { id: 'toronto', name: 'Bike Share Toronto', url: 'https://tor.publicbikesystem.net/customer/gbfs/v2/en/station_information' },
  { id: 'barcelona', name: 'Bicing Barcelona', url: 'https://barcelona.publicbikesystem.net/customer/gbfs/v2/en/station_information' },
  { id: 'mexico', name: 'Ecobici CDMX', url: 'https://gbfs.mex.lyftbikes.com/gbfs/en/station_information.json' },
];
const STATUS_URLS: Record<string, string> = {
  nyc: 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json',
  sf: 'https://gbfs.lyft.com/gbfs/2.3/bay/en/station_status.json',
  toronto: 'https://tor.publicbikesystem.net/customer/gbfs/v2/en/station_status',
  barcelona: 'https://barcelona.publicbikesystem.net/customer/gbfs/v2/en/station_status',
  mexico: 'https://gbfs.mex.lyftbikes.com/gbfs/en/station_status.json',
};

export function createBikeshareLayer(deps: LayerDeps): HudLayer {
  const points = new PointLayer('bikeshare', deps.viewer);

  const poller = new Poller(async () => {
    const items: PointItem[] = [];
    const results = await Promise.allSettled(NETWORKS.map(async (net) => {
      const infoRes = await fetch(net.url);
      if (!infoRes.ok) throw new Error(String(infoRes.status));
      const info = await infoRes.json();
      let status: Record<string, { num_bikes_available?: number; num_docks_available?: number }> = {};
      try {
        const stRes = await fetch(STATUS_URLS[net.id]);
        if (stRes.ok) {
          const st = await stRes.json();
          for (const row of st?.data?.stations ?? []) status[row.station_id] = row;
        }
      } catch { /* status optional */ }
      for (const st of info?.data?.stations ?? []) {
        if (st.lat == null || st.lon == null) continue;
        const s = status[st.station_id] ?? {};
        const bikes = s.num_bikes_available ?? null;
        items.push({
          id: `${net.id}-${st.station_id}`,
          lon: st.lon, lat: st.lat, alt: 0,
          size: 5,
          color: bikes != null && bikes === 0 ? '#ff5a5a' : '#7dd87d',
          title: String(st.name ?? 'Bike station'),
          subtitle: `${net.name}${bikes != null ? ` · ${bikes} bikes` : ''}${s.num_docks_available != null ? ` · ${s.num_docks_available} docks` : ''}`,
          meta: {
            NETWORK: net.name,
            BIKES: bikes != null ? String(bikes) : '—',
            DOCKS: s.num_docks_available != null ? String(s.num_docks_available) : '—',
          },
        });
      }
    }));
    for (const r of results) if (r.status === 'rejected') console.warn('[bikeshare]', r.reason);
    points.setItems(items);
  }, 5 * 60 * 1000);
  poller.onError = (e) => console.warn('[bikeshare]', e);

  const layer: HudLayer = {
    id: 'bikeshare', name: 'Bikeshare', group: 'Infrastructure', auth: 'free',
    enabled: false,
    count: () => (layer.enabled ? points.size : null),
    enable: async () => { points.start(); poller.start(); layer.enabled = true; },
    disable: () => { layer.enabled = false; poller.stop(); points.stop(); },
  };
  (layer as unknown as { pointLayer: PointLayer }).pointLayer = points;
  return layer;
}
