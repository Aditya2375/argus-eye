// Prohibited & Restricted Airspace (US FAA SUA) + Wildlife Sightings
// (iNaturalist 48h + Acartia Salish Sea marine mammals).
import * as Cesium from 'cesium';
import type { LayerDeps, PointItem } from './common';
import { Poller, PointLayer } from './common';
import type { HudLayer } from '../core/hud';
import { viewRectangle, cameraState } from '../core/camera';
import { debounce, timeAgo } from '../core/dom';
import { bus } from '../core/bus';

export function createSuaLayer(deps: LayerDeps): HudLayer {
  let ds: Cesium.GeoJsonDataSource | null = null;

  const layer: HudLayer = {
    id: 'sua', name: 'Prohibited/Restricted Airspace (US)', group: 'Infrastructure', auth: 'free',
    enabled: false,
    count: () => (layer.enabled && ds ? ds.entities.values.length : null),
    enable: async () => {
      ds = new Cesium.GeoJsonDataSource('sua');
      deps.viewer.dataSources.add(ds);
      layer.enabled = true;
      try {
        const url = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/ArcGIS/rest/services/Special_Use_Airspace/FeatureServer/0/query' +
          '?where=TYPE_CODE%20IN%20(%27P%27,%27R%27)&outFields=NAME,TYPE_CODE,LOWER_VAL,UPPER_VAL&f=geojson&outSR=4326';
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        await ds!.load(data, {
          stroke: Cesium.Color.fromCssColorString('#ff5a5a').withAlpha(0.8),
          fill: Cesium.Color.fromCssColorString('#ff5a5a').withAlpha(0.12),
          clampToGround: true,
        });
        for (const e of ds!.entities.values) {
          e.properties?.addProperty('kind', 'sua');
        }
      } catch (err) {
        console.warn('[sua]', err);
        bus.emit('toast', { text: 'FAA airspace service unreachable.', kind: 'warn' });
      }
    },
    disable: () => {
      layer.enabled = false;
      if (ds) { deps.viewer.dataSources.remove(ds, true); ds = null; }
    },
  };
  return layer;
}

export function createWildlifeLayer(deps: LayerDeps): HudLayer {
  const points = new PointLayer('wildlife', deps.viewer);
  let loading = false;

  const load = debounce(async () => {
    if (!layer.enabled || loading) return;
    const { height } = cameraState();
    if (height > 3000000) return;
    loading = true;
    try {
      const r = viewRectangle();
      const since = new Date(Date.now() - 48 * 3600e3).toISOString().slice(0, 10);
      const url = `https://api.inaturalist.org/v1/observations?swlat=${r.south}&swlng=${r.west}&nelat=${r.north}&nelng=${r.east}` +
        `&d1=${since}&verifiable=true&per_page=180&order=desc&order_by=observed_on`;
      const res = await fetch(url);
      const items: PointItem[] = [];
      if (res.ok) {
        const data = await res.json() as {
          results: Array<{
            id: number; location?: string; time_observed_at?: string; quality_grade?: string;
            taxon?: { preferred_common_name?: string; name?: string; iconic_taxon_name?: string };
            photos?: Array<{ url?: string }>; uri?: string; user?: { login?: string };
          }>;
        };
        for (const o of data.results ?? []) {
          if (!o.location) continue;
          const [lat, lon] = o.location.split(',').map(Number);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          items.push({
            id: String(o.id), lon, lat, alt: 0,
            size: 6, color: '#a5e3a1',
            title: o.taxon?.preferred_common_name ?? o.taxon?.name ?? 'Wildlife sighting',
            subtitle: `iNaturalist · ${o.time_observed_at ? timeAgo(o.time_observed_at) : 'recent'} · ${o.quality_grade ?? ''}`,
            meta: {
              TAXON: o.taxon?.name ?? '—', GROUP: o.taxon?.iconic_taxon_name ?? '—',
              OBSERVED: o.time_observed_at?.slice(0, 16).replace('T', ' ') ?? '—',
              GRADE: o.quality_grade ?? '—', OBSERVER: o.user?.login ?? '—',
            },
            photo: o.photos?.[0]?.url?.replace('square', 'medium'),
            link: o.uri,
          });
        }
      }
      // Acartia: Salish Sea marine mammals (7d)
      try {
        const a = await fetch('https://acartia.io/api/v1/sightings/current');
        if (a.ok) {
          const rows = await a.json() as Array<{ id?: string; latitude?: number; longitude?: number; species?: string; created?: string; provider?: string }>;
          for (const s of rows ?? []) {
            if (s.latitude == null || s.longitude == null) continue;
            if (s.latitude < r.south || s.latitude > r.north || s.longitude < r.west || s.longitude > r.east) continue;
            items.push({
              id: `acartia-${s.id ?? `${s.latitude}-${s.longitude}`}`,
              lon: s.longitude, lat: s.latitude, alt: 0,
              size: 7, color: '#8bd3ff',
              title: s.species ?? 'Marine mammal',
              subtitle: `Acartia · ${s.created ? timeAgo(s.created) : 'recent'} · ${s.provider ?? 'trusted provider'}`,
              meta: { SPECIES: s.species ?? '—', PROVIDER: s.provider ?? '—' },
            });
          }
        }
      } catch { /* optional */ }
      points.setItems(items);
    } catch (err) {
      console.warn('[wildlife]', err);
    } finally {
      loading = false;
    }
  }, 900);

  let removeListener: (() => void) | null = null;

  const layer: HudLayer = {
    id: 'wildlife', name: 'Wildlife Sightings (48h)', group: 'Events', auth: 'free',
    enabled: false,
    count: () => (layer.enabled ? points.size : null),
    enable: async () => {
      points.start();
      layer.enabled = true;
      const listener = deps.viewer.camera.moveEnd.addEventListener(load);
      removeListener = () => deps.viewer.camera.moveEnd.removeEventListener(listener);
      void load();
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
