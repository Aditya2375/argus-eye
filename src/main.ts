// ARGUS EYE bootstrap: viewer, HUD, layers, picking, search, voice, share.
import * as Cesium from 'cesium';
import './style.css';
import { createViewer } from './core/cesiumSetup';
import { initCamera, resetGlobe } from './core/camera';
import { initFx } from './core/fx';
import { initDetect } from './core/detect';
import { initHud, registerLayer, refreshLeftPanel, type HudLayer } from './core/hud';
import { initSearch } from './core/search';
import { initVoice } from './voice/voice';
import { tracker } from './core/track';
import { bus } from './core/bus';
import { parseShareHash, restoreShareState, copyShareLink } from './core/share';
import { settings } from './core/settings';
import type { LiveFix } from './core/liveLayer';

import { createFlightsLayer } from './layers/flights';
import { createMilitaryLayer } from './layers/military';
import { createSatellitesLayer } from './layers/satellites';
import { createEarthquakesLayer } from './layers/earthquakes';
import { createVesselsLayer } from './layers/vessels';
import { createTransitLayer, createRailLayer } from './layers/transit';
import { createTrafficLayer } from './layers/traffic';
import { createFiresLayer, createPerimetersLayer } from './layers/fires';
import { createLaunchesLayer } from './layers/launches';
import { createRadioLayer } from './layers/radio';
import { createBikeshareLayer } from './layers/bikeshare';
import { createWindLayer } from './layers/wind';
import { createObservedWeatherLayer, createCyclonesLayer } from './layers/weather';
import { createCctvLayer } from './layers/cctv';
import { createAlprLayer, createInstallationsLayer } from './layers/osmLayers';
import { createSuaLayer, createWildlifeLayer } from './layers/suaWildlife';
import { createDatacentersLayer, createDamsLayer, createCablesLayer, createShipwrecksLayer } from './layers/infra';
import { initNewsPanel } from './layers/news';
import { createDirectionsLayer } from './layers/directions';
import { createDrawLayer } from './layers/draw';
import { createStreetLevelLayer, createOverlayLayer } from './layers/streetlevel';
import { createScenesLayer } from './layers/scenes';
import { PointLayer } from './layers/common';

const bootStatus = (text: string, pct: number) => {
  const s = document.getElementById('boot-status');
  const f = document.getElementById('boot-fill');
  if (s) s.textContent = text;
  if (f) f.style.width = `${pct}%`;
};

async function main(): Promise<void> {
  bootStatus('INITIALIZING OPTICS…', 12);
  const container = document.getElementById('cesium-container')!;
  const { viewer, setMapStack } = await createViewer(container);

  initCamera(viewer);
  initFx(viewer);
  tracker.init(viewer);
  initDetect(viewer, document.getElementById('detect-overlay') as HTMLCanvasElement);
  bootStatus('REGISTERING LAYERS…', 38);

  const deps = { viewer };
  const layers: HudLayer[] = [
    createFlightsLayer(deps),
    createMilitaryLayer(deps),
    createVesselsLayer(deps),
    createSatellitesLayer(deps),
    createTransitLayer(deps),
    createRailLayer(deps),
    createTrafficLayer(deps),
    createCctvLayer(deps),
    createAlprLayer(deps),
    createStreetLevelLayer(deps),
    createInstallationsLayer(deps),
    createSuaLayer(deps),
    createDatacentersLayer(deps),
    createDamsLayer(deps),
    createCablesLayer(deps),
    createEarthquakesLayer(deps),
    createFiresLayer(deps),
    createPerimetersLayer(deps),
    createWildlifeLayer(deps),
    createLaunchesLayer(deps),
    createShipwrecksLayer(deps),
    createWindLayer(deps),
    createObservedWeatherLayer(deps, 'radar'),
    createObservedWeatherLayer(deps, 'satellite'),
    createObservedWeatherLayer(deps, 'lightning'),
    createCyclonesLayer(deps),
    initNewsPanel(deps),
    createRadioLayer(deps),
    createBikeshareLayer(deps),
    createDirectionsLayer(deps),
    createDrawLayer(deps),
    createOverlayLayer(deps, 'seamarks'),
    createOverlayLayer(deps, 'ski'),
    createScenesLayer(deps, { setLayers: async () => undefined }),
  ];
  for (const l of layers) registerLayer(l);

  bootStatus('WARMING THE CONSOLE…', 62);
  initHud();
  initSearch();
  initVoice({ layers, findLayer: (id) => layers.find((l) => l.id === id) });

  bus.on('layers:refresh', () => refreshLeftPanel());
  bus.on<string>('share:target', (id) => copyShareLink(layers, id));

  // map stack cycle: esri → osm → ion3d → google3d (toasts when a key is missing)
  const STACKS = ['esri', 'osm', 'ion3d', 'google3d'] as const;
  bus.on('mapstack:cycle', () => {
    const current = STACKS.indexOf(settings.mapStack as (typeof STACKS)[number]);
    const next = STACKS[(current + 1) % STACKS.length];
    void setMapStack(next);
  });

  // global picking: layers expose pick / pickFix+trackFix / pointLayer
  const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  clickHandler.setInputAction((ev: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const picked = viewer.scene.pick(ev.position);
    if (!picked) { tracker.untrack(); return; }
    for (const layer of layers) {
      if (!layer.enabled) continue;
      const pick = (layer as unknown as { pick?: (p: unknown) => boolean }).pick;
      if (pick?.(picked)) return;
      const pickFix = (layer as unknown as { pickFix?: (p: unknown) => LiveFix | null }).pickFix;
      const trackFix = (layer as unknown as { trackFix?: (f: LiveFix) => void }).trackFix;
      if (pickFix && trackFix) {
        const fix = pickFix(picked);
        if (fix) { trackFix(fix); return; }
      }
      const pl = (layer as unknown as { pointLayer?: PointLayer }).pointLayer;
      if (pl?.handlePick(picked)) return;
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // share-link restore
  const shared = parseShareHash(location.hash);
  if (shared) {
    await restoreShareState(shared, layers, setMapStack);
  } else {
    resetGlobe(0);
  }

  bootStatus('READY', 100);
  setTimeout(() => document.getElementById('boot')?.classList.add('done'), 250);
  console.log('%cARGUS EYE%c ready — every feed keyless unless noted.',
    'color:#59d6ff;font-weight:bold', 'color:inherit');
}

main().catch((err) => {
  console.error(err);
  bootStatus(`BOOT FAULT: ${String(err?.message ?? err).slice(0, 80)}`, 100);
});
