// Scene director: cinematic camera tours with captions; bundled scenes plus
// import/export as JSON. Scenes serialize camera anchors and dwell times.
import * as Cesium from 'cesium';
import { bus } from '../core/bus';
import { el } from '../core/dom';
import { renderCustomContext, type HudLayer } from '../core/hud';
import type { LayerDeps } from './common';

interface Anchor { lon: number; lat: number; h: number; dwellS: number; caption: string; pitch?: number }
interface Scene { id: string; name: string; anchors: Anchor[] }

const BUNDLED: Scene[] = [
  {
    id: 'orbital-watch',
    name: 'Orbital Watch',
    anchors: [
      { lon: 15, lat: 12, h: 19_500_000, dwellS: 5, caption: 'ARGUS EYE · ORBITAL WATCH' },
      { lon: -97, lat: 30, h: 900_000, dwellS: 5, caption: 'CENTRAL TEXAS · LIVE ADS-B CORRIDOR' },
      { lon: 139.7, lat: 35.7, h: 700_000, dwellS: 5, caption: 'TOKYO · THE WORLD\u2019S BUSIEST AIRSPACE' },
      { lon: 55.3, lat: 25.2, h: 1_400_000, dwellS: 5, caption: 'THE GULF · STRAIT OF HORMUZ TRAFFIC' },
      { lon: 77.6, lat: 13.0, h: 800_000, dwellS: 5, caption: 'BENGALURU · SOUTH INDIA' },
      { lon: 15, lat: 12, h: 19_500_000, dwellS: 4, caption: 'NO PLACE LEFT BEHIND' },
    ],
  },
  {
    id: 'ring-of-fire',
    name: 'Ring of Fire',
    anchors: [
      { lon: 140, lat: 36, h: 3_000_000, dwellS: 4, caption: 'RING OF FIRE · JAPAN TRENCH' },
      { lon: -122, lat: 46, h: 2_000_000, dwellS: 4, caption: 'CASCADIA' },
      { lon: -70, lat: -33, h: 2_400_000, dwellS: 4, caption: 'CHILE · NAZCA SUBDUCTION' },
      { lon: 120, lat: -5, h: 4_000_000, dwellS: 4, caption: 'INDONESIA · SUNDAY ARC' },
    ],
  },
];

export function createScenesLayer(deps: LayerDeps, opts: { setLayers: (ids: string[]) => Promise<void> }): HudLayer {
  let playing = false;
  let cancel = false;

  async function play(scene: Scene): Promise<void> {
    if (playing) { bus.emit('toast', { text: 'A scene is already playing.', kind: 'warn' }); return; }
    playing = true; cancel = false;
    bus.emit('caption', `SCENE · ${scene.name.toUpperCase()}`);
    for (const a of scene.anchors) {
      if (cancel) break;
      await new Promise<void>((resolve) => {
        deps.viewer.camera.flyTo({
          destination: CesiumCartesian(a),
          orientation: {
            heading: 0,
            pitch: CesiumDeg(a.pitch ?? (a.h < 100_000 ? -45 : -90)),
            roll: 0,
          },
          duration: Math.min(4, a.dwellS * 0.55),
          complete: () => resolve(),
          cancel: () => resolve(),
        });
        bus.emit('caption', a.caption);
      });
      if (cancel) break;
      await new Promise((r) => setTimeout(r, a.dwellS * 450));
    }
    playing = false;
  }

  function CesiumCartesian(a: Anchor): Cesium.Cartesian3 {
    return Cesium.Cartesian3.fromDegrees(a.lon, a.lat, a.h);
  }
  function CesiumDeg(deg: number): number { return Cesium.Math.toRadians(deg); }

  function openPanel(): void {
    const node = el('div');
    node.append(el('div', 'ctx-title', 'SCENE DIRECTOR'));
    node.append(el('div', 'ctx-sub', 'Cinematic camera tours — bundled and importable'));
    for (const s of BUNDLED) {
      const row = el('div', 'minirow');
      row.append(el('span', '', s.name), el('span', 'spacer'));
      const playBtn = el('button', 'abtn', 'PLAY');
      playBtn.onclick = () => void play(s);
      row.append(playBtn);
      node.append(row);
    }
    const stop = el('button', 'abtn danger', 'STOP');
    stop.onclick = () => { cancel = true; };
    node.append(stop);
    const importBtn = el('button', 'abtn', 'IMPORT SCENE JSON');
    importBtn.onclick = () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const scene = JSON.parse(await file.text()) as Scene;
          if (!scene.anchors?.length) throw new Error('no anchors');
          BUNDLED.push(scene);
          openPanel();
          bus.emit('toast', { text: `Scene "${scene.name}" imported.` });
        } catch { bus.emit('toast', { text: 'Not a valid scene file.', kind: 'err' }); }
      };
      input.click();
    };
    node.append(importBtn);
    renderCustomContext(node);
  }

  bus.on<string>('scene:play', (id) => {
    const s = BUNDLED.find((x) => x.id === id);
    if (s) void play(s);
  });

  const layer: HudLayer = {
    id: 'scenes', name: 'Scene Director', group: 'Utilities', auth: 'free',
    enabled: false,
    count: () => null,
    enable: async () => { layer.enabled = true; openPanel(); },
    disable: () => { layer.enabled = false; cancel = true; },
  };
  void opts;
  return layer;
}
