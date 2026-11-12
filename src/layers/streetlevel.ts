// Street Level: keyless KartaView + Panoramax coverage lines and photos;
// Mapillary and Google Street View chips activate with keys in POWER UP.
import * as Cesium from 'cesium';
import type { LayerDeps } from './common';
import type { HudLayer } from '../core/hud';
import { bus } from '../core/bus';
import { el, escapeHtml } from '../core/dom';
import { renderCustomContext } from '../core/hud';
import { viewRectangle, cameraState } from '../core/camera';
import { debounce } from '../core/dom';

export function createStreetLevelLayer(deps: LayerDeps): HudLayer {
  let ds: Cesium.CustomDataSource | null = null;
  let loading = false;

  const load = debounce(async () => {
    if (!layer.enabled || loading || !ds) return;
    const { height } = cameraState();
    if (height > 60000) return;
    loading = true;
    try {
      const r = viewRectangle();
      ds.entities.removeAll();
      // Panoramax vector-ish: STAC search for sequences in bbox (keyless)
      const res = await fetch(
        `https://api.panoramax.xyz/api/search?bbox=${r.west},${r.south},${r.east},${r.north}&limit=120`);
      if (res.ok) {
        const data = await res.json() as {
          features?: Array<{ geometry?: { type: string; coordinates: number[] | number[][] }; properties?: { id?: string; 'persist:panoramax:v1'?: unknown; assets?: Record<string, { href?: string }>; providers?: Array<{ name?: string }>; license?: string } }>;
        };
        for (const f of data.features ?? []) {
          const coords = f.geometry?.type === 'Point' ? f.geometry.coordinates as number[] : null;
          if (!coords) continue;
          const props = f.properties;
          const href = props?.assets?.hd?.href ?? props?.assets?.sd?.href ?? props?.assets?.thumb?.href;
          ds.entities.add({
            id: `sl:${f.properties?.id ?? Math.random()}`,
            position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 0),
            point: {
              pixelSize: 7,
              color: Cesium.Color.fromCssColorString('#ff9d54').withAlpha(0.9),
              outlineColor: Cesium.Color.BLACK.withAlpha(0.5), outlineWidth: 1,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            properties: { photo: href ?? '', license: props?.license ?? 'see picture page' },
          });
        }
      }
    } catch (err) {
      console.warn('[streetlevel]', err);
    } finally {
      loading = false;
    }
  }, 900);

  let removeListener: (() => void) | null = null;

  const layer: HudLayer = {
    id: 'streetlevel', name: 'Street Level', group: 'Cameras', auth: 'free-key',
    enabled: false,
    count: () => (layer.enabled && ds ? ds.entities.values.length : null),
    enable: async () => {
      ds = new Cesium.CustomDataSource('streetlevel');
      deps.viewer.dataSources.add(ds);
      layer.enabled = true;
      const listener = deps.viewer.camera.moveEnd.addEventListener(load);
      removeListener = () => deps.viewer.camera.moveEnd.removeEventListener(listener);
      void load();
      bus.emit('toast', { text: 'Street Level keyless via Panoramax. Mapillary / Street View activate with keys in POWER UP.' });
    },
    disable: () => {
      layer.enabled = false;
      removeListener?.(); removeListener = null;
      if (ds) { deps.viewer.dataSources.remove(ds, true); ds = null; }
    },
  };

  (layer as unknown as { pick: (p: unknown) => boolean }).pick = (picked) => {
    const entity = (picked as { id?: Cesium.Entity })?.id;
    if (!entity || !(entity instanceof Cesium.Entity) || !String(entity.id).startsWith('sl:')) return false;
    const photo = entity.properties?.photo?.getValue() as string | undefined;
    const license = entity.properties?.license?.getValue() as string | undefined;
    const node = el('div');
    node.append(el('div', 'ctx-title', 'STREET LEVEL'));
    node.append(el('div', 'ctx-sub', `© Panoramax contributors · licence per picture${license ? ` (${escapeHtml(license)})` : ''}`));
    if (photo) {
      const img = document.createElement('img');
      img.className = 'ctx-photo';
      img.src = photo;
      node.append(img);
    } else {
      node.append(el('div', 'note', 'No picture asset for this point.'));
    }
    renderCustomContext(node);
    return true;
  };
  return layer;
}

// Sea Marks + Ski Pistes: keyless raster overlays (OpenSeaMap, OpenSnowMap).
export function createOverlayLayer(deps: LayerDeps, kind: 'seamarks' | 'ski'): HudLayer {
  const conf = kind === 'seamarks'
    ? { id: 'seamarks', name: 'Sea Marks', url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', credit: 'OpenSeaMap contributors' }
    : { id: 'ski', name: 'Ski Pistes', url: 'https://www.opensnowmap.org/pistes/{z}/{x}/{y}.png', credit: 'OpenSnowMap contributors' };
  let layerRef: Cesium.ImageryLayer | null = null;
  const layer: HudLayer = {
    id: conf.id, name: conf.name, group: 'Infrastructure', auth: 'free',
    enabled: false,
    count: () => null,
    enable: async () => {
      layer.enabled = true;
      layerRef = new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({ url: conf.url, credit: conf.credit, maximumLevel: 18 }),
        { alpha: 0.85 });
      deps.viewer.imageryLayers.add(layerRef);
    },
    disable: () => {
      layer.enabled = false;
      if (layerRef) { deps.viewer.imageryLayers.remove(layerRef, true); layerRef = null; }
    },
  };
  return layer;
}
