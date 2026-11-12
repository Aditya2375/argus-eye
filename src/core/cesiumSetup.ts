// Viewer bootstrap: keyless Esri satellite basemap + Esri elevation terrain,
// OSM fallback, optional ion / Google Photorealistic 3D via user keys.
import * as Cesium from 'cesium';
import { settings, saveSettings } from './settings';
import { bus } from './bus';

export const ESRI_IMAGERY_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const ESRI_TERRAIN_URL =
  'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer';

export function esriImageryLayer(): Cesium.ImageryLayer {
  return new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: ESRI_IMAGERY_URL,
      credit: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      maximumLevel: 19,
    }),
  );
}

export function osmImageryLayer(): Cesium.ImageryLayer {
  return new Cesium.ImageryLayer(
    new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }),
  );
}

async function esriTerrain(viewer: Cesium.Viewer): Promise<void> {
  try {
    const provider = Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(ESRI_TERRAIN_URL) as unknown as Promise<Cesium.TerrainProvider>;
    viewer.scene.setTerrain(new Cesium.Terrain(provider));
  } catch {
    // Terrain is optional: the globe continues on the ellipsoid.
    bus.emit('toast', { text: 'Terrain service unreachable — continuing on ellipsoid.', kind: 'warn' });
  }
}

export interface ViewerBundle {
  viewer: Cesium.Viewer;
  setMapStack: (stack: SettingsMapStack) => Promise<void>;
  currentStack: () => string;
}
type SettingsMapStack = 'esri' | 'osm' | 'ion3d' | 'google3d';

export async function createViewer(container: HTMLElement): Promise<ViewerBundle> {
  const viewer = new Cesium.Viewer(container, {
    baseLayer: esriImageryLayer(),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: true,
    requestRenderMode: false,
    contextOptions: { webgl: { powerPreference: 'high-performance' } },
  });

  const scene = viewer.scene;
  scene.globe.enableLighting = false;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.baseColor = Cesium.Color.fromCssColorString('#0b1a26');
  scene.fog.enabled = true;
  scene.fog.density = 2.2e-4;
  scene.highDynamicRange = false;
  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);

  if (settings.keys.cesiumIon) Cesium.Ion.defaultAccessToken = settings.keys.cesiumIon;

  await esriTerrain(viewer);

  let stack: SettingsMapStack = 'esri';
  let googleTiles: Cesium.Cesium3DTileset | null = null;
  let ionTiles: Cesium.Cesium3DTileset | null = null;

  async function setMapStack(next: SettingsMapStack): Promise<void> {
    const layers = viewer.imageryLayers;
    // remove existing 3D tilesets
    for (const ts of [googleTiles, ionTiles]) {
      if (ts && !ts.isDestroyed()) { scene.primitives.remove(ts); }
    }
    googleTiles = null; ionTiles = null;
    scene.globe.show = true;

    if (next === 'google3d') {
      if (!settings.keys.googleMaps) { bus.emit('toast', { text: 'Add a Google Maps key in POWER UP for Photorealistic 3D.', kind: 'warn' }); return; }
      try {
        googleTiles = await Cesium.createGooglePhotorealistic3DTileset(settings.keys.googleMaps);
        scene.primitives.add(googleTiles);
        scene.globe.show = false;
      } catch (err) {
        bus.emit('toast', { text: 'Google 3D tiles failed — check the key and Map Tiles API access.', kind: 'err' });
        return;
      }
    } else if (next === 'ion3d') {
      if (!settings.keys.cesiumIon) { bus.emit('toast', { text: 'Add a Cesium ion token in POWER UP for Google 3D via ion.', kind: 'warn' }); return; }
      try {
        ionTiles = await Cesium.createGooglePhotorealistic3DTileset();
        scene.primitives.add(ionTiles);
        scene.globe.show = false;
      } catch {
        bus.emit('toast', { text: 'ion 3D failed — check the token.', kind: 'err' });
        return;
      }
    } else {
      layers.removeAll();
      layers.add(next === 'osm' ? osmImageryLayer() : esriImageryLayer());
    }
    stack = next;
    settings.mapStack = next;
    saveSettings();
    bus.emit('mapstack:changed', next);
  }

  // Restore the saved stack (best effort; falls back to Esri).
  if (settings.mapStack !== 'esri') {
    const saved = settings.mapStack;
    settings.mapStack = 'esri';
    await setMapStack(saved);
  }

  return { viewer, setMapStack, currentStack: () => stack };
}
