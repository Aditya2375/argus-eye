// Active Fires: keyless via NASA EONET wildfire events; add a free FIRMS map
// key in POWER UP for raw VIIRS/MODIS detections (trailing 24h).
import * as Cesium from 'cesium';
import type { LayerDeps, PointItem } from './common';
import { Poller, PointLayer, toastErrors } from './common';
import type { HudLayer } from '../core/hud';
import { settings } from '../core/settings';
import { timeAgo } from '../core/dom';
import { bus } from '../core/bus';

interface EonetEvent {
  id: string; title: string; link: string;
  categories: Array<{ id: string | number; title: string }>;
  geometry: Array<{ date: string; type: string; coordinates: [number, number] }>;
}

export function createFiresLayer(deps: LayerDeps): HudLayer {
  const points = new PointLayer('fires', deps.viewer);

  const poller = new Poller(async () => {
    const items: PointItem[] = [];
    // Keyless baseline: EONET wildfire events
    const res = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires&limit=400');
    if (res.ok) {
      const data = (await res.json()) as { events: EonetEvent[] };
      for (const ev of data.events ?? []) {
        const geo = ev.geometry?.[ev.geometry.length - 1];
        if (!geo || geo.type !== 'Point') continue;
        items.push({
          id: `eonet-${ev.id}`,
          lon: geo.coordinates[0], lat: geo.coordinates[1], alt: 0,
          size: 9, color: '#ff7a3d',
          title: ev.title,
          subtitle: `NASA EONET · latest report ${timeAgo(geo.date)}`,
          meta: { CATEGORY: 'Wildfire event', REPORTED: geo.date.slice(0, 10) },
          link: ev.link,
        });
      }
    }
    // FIRMS detections when a map key is present
    if (settings.keys.firmsMapKey) {
      try {
        const r = await fetch(
          `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${settings.keys.firmsMapKey}/VIIRS_SNPP_NRT/world/1`);
        if (r.ok) {
          const text = await r.text();
          const lines = text.split('\n');
          const header = lines[0]?.split(',') ?? [];
          const iLat = header.indexOf('latitude'); const iLon = header.indexOf('longitude');
          const iFrp = header.indexOf('frp'); const iDate = header.indexOf('acq_date');
          for (let i = 1; i < lines.length && items.length < 4500; i++) {
            const cols = lines[i].split(',');
            const lat = Number(cols[iLat]); const lon = Number(cols[iLon]);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            const frp = Number(cols[iFrp] ?? 0);
            items.push({
              id: `firms-${i}`, lon, lat, alt: 0,
              size: Math.min(16, 5 + frp / 12), color: '#ff4d2e',
              title: `Fire detection · FRP ${frp.toFixed(1)} MW`,
              subtitle: `NASA FIRMS VIIRS · ${cols[iDate] ?? ''}`,
              meta: { FRP: `${frp.toFixed(1)} MW`, DATE: cols[iDate] ?? '—' },
            });
          }
        }
      } catch { /* FIRMS optional */ }
    }
    points.setItems(items);
  }, 10 * 60 * 1000);
  poller.onError = toastErrors('fires');

  const layer: HudLayer = {
    id: 'fires', name: 'Active Fires', group: 'Events', auth: 'free-key', chip: 'FIRES',
    enabled: false,
    count: () => (layer.enabled ? points.size : null),
    enable: async () => {
      points.start();
      poller.start();
      layer.enabled = true;
      if (!settings.keys.firmsMapKey) {
        bus.emit('toast', { text: 'Fires keyless via NASA EONET events. Add a free FIRMS map key in POWER UP for raw detections.' });
      }
    },
    disable: () => { layer.enabled = false; poller.stop(); points.stop(); },
  };
  (layer as unknown as { pointLayer: PointLayer }).pointLayer = points;
  return layer;
}

// Fire Perimeters: NIFC WFIGS current interagency incident boundaries.
export function createPerimetersLayer(deps: LayerDeps): HudLayer {
  let ds: Cesium.GeoJsonDataSource | null = null;
  const poller = new Poller(async () => {
    const url = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/WFIGS_Incident_Perimeters_Current/FeatureServer/0/query' +
      '?where=1%3D1&outFields=attr_IncidentName,attr_PercentContained,attr_FireDiscoveryDateTime&f=geojson&outSR=4326';
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (!ds) return;
    ds.entities.removeAll();
    await ds.load(data, {
      stroke: Cesium.Color.fromCssColorString('#ff7a3d'),
      fill: Cesium.Color.fromCssColorString('#ff7a3d').withAlpha(0.18),
      clampToGround: true,
    });
  }, 30 * 60 * 1000);
  poller.onError = toastErrors('perimeters');

  const layer: HudLayer = {
    id: 'perimeters', name: 'Fire Perimeters (US)', group: 'Events', auth: 'free',
    enabled: false,
    count: () => (layer.enabled && ds ? ds.entities.values.length : null),
    enable: async () => {
      ds = new Cesium.GeoJsonDataSource('perimeters');
      deps.viewer.dataSources.add(ds);
      poller.start();
      layer.enabled = true;
    },
    disable: () => {
      layer.enabled = false;
      poller.stop();
      if (ds) { deps.viewer.dataSources.remove(ds, true); ds = null; }
    },
  };
  return layer;
}
