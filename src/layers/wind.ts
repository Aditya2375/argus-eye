// Wind: animated 10 m forecast flow from Open-Meteo (GFS / IFS underneath),
// rendered as GPU-free canvas particles advected over the globe, with an
// optional speed / temperature / pressure readout at the map center.
import * as Cesium from 'cesium';
import type { LayerDeps } from './common';
import type { HudLayer } from '../core/hud';
import { viewCenter } from '../core/camera';
import { bus } from '../core/bus';
import { el } from '../core/dom';

const GRID_DEG = 5;
const PARTICLES = 2200;

interface WindField {
  lats: number[]; lons: number[];
  u: Float32Array; v: Float32Array;
  speedMax: number;
}

async function fetchField(): Promise<WindField | null> {
  const lats: number[] = [];
  const lons: number[] = [];
  for (let la = -75; la <= 75; la += GRID_DEG) lats.push(la);
  for (let lo = -180; lo < 180; lo += GRID_DEG) lons.push(lo);
  // Open-Meteo multi-point needs paired lat/lon lists; build the full grid as repeated pairs.
  const laList: string[] = [];
  const loList: string[] = [];
  for (const la of lats) for (const lo of lons) { laList.push(String(la)); loList.push(String(lo)); }
  const r = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${laList.join(',')}&longitude=${loList.join(',')}` +
    '&current=wind_speed_10m,wind_direction_10m,temperature_2m,pressure_msl&wind_speed_unit=ms',
    { signal: AbortSignal.timeout(25000) });
  if (!r.ok) return null;
  const rows = await r.json() as Array<{ current: { wind_speed_10m: number; wind_direction_10m: number } }>;
  const nx = lons.length;
  const u = new Float32Array(lats.length * nx);
  const v = new Float32Array(lats.length * nx);
  let speedMax = 1;
  rows.forEach((row, i) => {
    const spd = row.current?.wind_speed_10m ?? 0;
    const dir = ((row.current?.wind_direction_10m ?? 0) + 180) * Math.PI / 180; // from→to
    u[i] = spd * Math.sin(dir);
    v[i] = spd * Math.cos(dir);
    if (spd > speedMax) speedMax = spd;
  });
  return { lats, lons, u, v, speedMax };
}

export function createWindLayer(deps: LayerDeps): HudLayer {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let field: WindField | null = null;
  let raf = 0;
  let running = false;
  let fetchTimer: ReturnType<typeof setInterval> | null = null;
  const parts: Array<{ lon: number; lat: number; age: number }> = [];

  function sample(lon: number, lat: number): { u: number; v: number } {
    if (!field) return { u: 0, v: 0 };
    const nx = field.lons.length;
    const fx = ((lon + 180) / GRID_DEG);
    const fy = ((lat + 75) / GRID_DEG);
    const x0 = Math.max(0, Math.min(nx - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(field.lats.length - 2, Math.floor(fy)));
    const tx = fx - x0, ty = fy - y0;
    const i = (x: number, y: number) => y * nx + x;
    const u = field.u[i(x0, y0)] * (1 - tx) * (1 - ty) + field.u[i(x0 + 1, y0)] * tx * (1 - ty)
      + field.u[i(x0, y0 + 1)] * (1 - tx) * ty + field.u[i(x0 + 1, y0 + 1)] * tx * ty;
    const v = field.v[i(x0, y0)] * (1 - tx) * (1 - ty) + field.v[i(x0 + 1, y0)] * tx * (1 - ty)
      + field.v[i(x0, y0 + 1)] * (1 - tx) * ty + field.v[i(x0 + 1, y0 + 1)] * tx * ty;
    return { u, v };
  }

  function step(): void {
    if (!running || !canvas || !ctx) return;
    const scene = deps.viewer.scene;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = 'rgba(160,230,255,0.5)';
    ctx.beginPath();
    const h = scene.camera.positionCartographic.height;
    const speedScale = Math.min(1, 3_000_000 / Math.max(300_000, h));
    for (const p of parts) {
      const { u, v } = sample(p.lon, p.lat);
      const km = Math.hypot(u, v);
      const dLon = (u / 111) * 0.12 * speedScale / Math.max(0.25, Math.cos(p.lat * Math.PI / 180));
      const dLat = (v / 111) * 0.12 * speedScale;
      const a = Cesium.SceneTransforms.worldToWindowCoordinates(scene, Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 20000));
      p.lon += dLon; p.lat += dLat; p.age++;
      const b = Cesium.SceneTransforms.worldToWindowCoordinates(scene, Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 20000));
      if (a && b && Math.abs(a.x - b.x) < 40 && Math.abs(a.y - b.y) < 40) {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      if (p.age > 90 || p.lat > 78 || p.lat < -78 || km < 0.2) {
        p.lon = Math.random() * 360 - 180;
        p.lat = Math.random() * 150 - 75;
        p.age = 0;
      }
    }
    ctx.stroke();
    raf = requestAnimationFrame(step);
  }

  async function refresh(): Promise<void> {
    const f = await fetchField();
    if (f) { field = f; }
    else bus.emit('toast', { text: 'Wind field fetch failed (Open-Meteo).', kind: 'warn' });
  }

  async function centerReading(): Promise<void> {
    const c = viewCenter();
    try {
      const r = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${c.lat.toFixed(2)}&longitude=${c.lon.toFixed(2)}` +
        '&current=wind_speed_10m,wind_direction_10m,temperature_2m,pressure_msl&wind_speed_unit=ms');
      if (!r.ok) return;
      const d = await r.json();
      const cur = d.current;
      bus.emit('caption', `CENTER · WIND ${cur.wind_speed_10m.toFixed(1)} m/s @ ${cur.wind_direction_10m}° · ${cur.temperature_2m.toFixed(1)}°C · ${Math.round(cur.pressure_msl)} hPa`);
    } catch { /* optional */ }
  }

  const layer: HudLayer = {
    id: 'wind', name: 'Wind (10 m forecast)', group: 'Weather', auth: 'free', chip: 'WIND',
    enabled: false,
    count: () => null,
    enable: async () => {
      layer.enabled = true;
      canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:4;';
      document.body.appendChild(canvas);
      const resize = () => { canvas!.width = canvas!.clientWidth; canvas!.height = canvas!.clientHeight; };
      resize();
      window.addEventListener('resize', resize);
      ctx = canvas.getContext('2d')!;
      parts.length = 0;
      for (let i = 0; i < PARTICLES; i++) {
        parts.push({ lon: Math.random() * 360 - 180, lat: Math.random() * 150 - 75, age: Math.random() * 90 });
      }
      running = true;
      await refresh();
      fetchTimer = setInterval(refresh, 30 * 60 * 1000);
      raf = requestAnimationFrame(step);
      void centerReading();
      bus.emit('caption', 'WIND · NOAA GFS VIA OPEN-METEO');
    },
    disable: () => {
      layer.enabled = false;
      running = false;
      cancelAnimationFrame(raf);
      if (fetchTimer) clearInterval(fetchTimer);
      fetchTimer = null;
      canvas?.remove();
      canvas = null; ctx = null; field = null;
    },
  };
  (layer as unknown as { centerReading: () => Promise<void> }).centerReading = centerReading;
  void el;
  return layer;
}
