// Share links: camera, map stack, sensor, layers and one tracked target
// serialize into the URL hash; restoring hands off live targets.
import { cameraState, flyTo } from './camera';
import { settings } from './settings';
import { setSensor, type SensorMode } from './fx';
import { bus } from './bus';
import type { HudLayer } from './hud';

export interface ShareState {
  v: 1;
  c: [number, number, number, number, number]; // lon lat h hdg pitch
  stack: string;
  sensor: SensorMode;
  layers: string[];    // enabled layer ids
  track?: string;      // "layer:id"
}

export function buildShareHash(layers: HudLayer[], trackId?: string): string {
  const c = cameraState();
  const state: ShareState = {
    v: 1,
    c: [round(c.lon, 5), round(c.lat, 5), Math.round(c.height), round(c.heading, 1), round(c.pitch, 1)],
    stack: settings.mapStack,
    sensor: settings.sensor,
    layers: layers.filter((l) => l.enabled).map((l) => l.id),
    track: trackId,
  };
  return `#s=${btoa(unescape(encodeURIComponent(JSON.stringify(state))))}`;
}

export function parseShareHash(hash: string): ShareState | null {
  try {
    const m = hash.match(/#s=([A-Za-z0-9+/=]+)/);
    if (!m) return null;
    return JSON.parse(decodeURIComponent(escape(atob(m[1])))) as ShareState;
  } catch {
    return null;
  }
}

export async function restoreShareState(
  state: ShareState,
  layers: HudLayer[],
  setMapStack: (s: 'esri' | 'osm' | 'ion3d' | 'google3d') => Promise<void>,
): Promise<void> {
  if (state.stack && state.stack !== settings.mapStack) {
    await setMapStack(state.stack as 'esri' | 'osm' | 'ion3d' | 'google3d');
  }
  if (state.sensor) setSensor(state.sensor, true);
  for (const id of state.layers ?? []) {
    const layer = layers.find((l) => l.id === id);
    if (layer && !layer.enabled) {
      try { await layer.enable(); } catch (err) { console.warn(`share restore: ${id}`, err); }
    }
  }
  const [lon, lat, h] = state.c;
  flyTo(lon, lat, h, 0);
  bus.emit('caption', 'SHARED VIEW RESTORED');
}

export function copyShareLink(layers: HudLayer[], trackId?: string): void {
  const url = `${location.origin}${location.pathname}${buildShareHash(layers, trackId)}`;
  navigator.clipboard?.writeText(url).then(
    () => bus.emit('toast', { text: 'Share link copied — camera, layers and style included.' }),
    () => bus.emit('toast', { text: url, kind: 'warn' }),
  );
}

function round(n: number, p: number): number {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}
