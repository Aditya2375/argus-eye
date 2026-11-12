// LiveLayer: renders many moving things (flights, vessels, trains, …) as
// heading-stable glyphs with interpolation + dead reckoning between fixes.
import * as Cesium from 'cesium';

export interface LiveFix {
  id: string;
  lon: number;
  lat: number;
  alt: number;              // meters above ellipsoid (0 = ground clamp by caller)
  heading?: number;         // degrees true
  speed?: number;           // m/s
  ts: number;               // ms epoch
  meta: Record<string, unknown>;
  color?: string;           // css color
  kind?: string;            // glyph kind: plane | heli | ship | train | bus | dot
  size?: number;            // px scale hint
}

export interface LiveLayerOptions {
  name: string;
  viewer: Cesium.Viewer;
  maxBillboards?: number;
  clampToGround?: boolean;
  defaultColor?: string;
  glyphFor?: (fix: LiveFix) => string;   // override glyph kind selection
  onPick?: (fix: LiveFix) => void;
  detectable?: boolean;                   // included in detection overlay
  detectLabel?: (fix: LiveFix) => string;
}

const spriteCache = new Map<string, HTMLCanvasElement>();

function sprite(kind: string, color: string): HTMLCanvasElement {
  const key = `${kind}:${color}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const S = 40;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  g.translate(S / 2, S / 2);
  g.fillStyle = color;
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  switch (kind) {
    case 'plane':
      // nose points +Y (up), rotation applied at render time
      g.moveTo(0, -15); g.lineTo(4, -4); g.lineTo(15, 2); g.lineTo(15, 6); g.lineTo(4, 4);
      g.lineTo(3, 10); g.lineTo(7, 13); g.lineTo(7, 15); g.lineTo(0, 13);
      g.lineTo(-7, 15); g.lineTo(-7, 13); g.lineTo(-3, 10); g.lineTo(-4, 4);
      g.lineTo(-15, 6); g.lineTo(-15, 2); g.lineTo(-4, -4); g.closePath();
      break;
    case 'heli':
      g.arc(0, 2, 5.5, 0, Math.PI * 2);
      g.moveTo(-14, -6); g.lineTo(14, -6); g.lineTo(14, -3); g.lineTo(-14, -3); g.closePath();
      break;
    case 'ship':
      g.moveTo(0, -13); g.lineTo(6, -4); g.lineTo(6, 9); g.lineTo(3, 13); g.lineTo(-3, 13); g.lineTo(-6, 9); g.lineTo(-6, -4); g.closePath();
      break;
    case 'train':
      g.rect(-5, -12, 10, 24);
      break;
    case 'bus':
      g.rect(-5, -9, 10, 18);
      break;
    case 'quakedot':
      g.arc(0, 0, 7, 0, Math.PI * 2);
      break;
    default:
      g.arc(0, 0, 5, 0, Math.PI * 2);
  }
  g.fill();
  g.stroke();
  spriteCache.set(key, c);
  return c;
}

interface Track {
  prev: LiveFix;
  next: LiveFix;
  billboard: Cesium.Billboard | null;
  lastSeen: number;
}

export class LiveLayer {
  readonly name: string;
  readonly viewer: Cesium.Viewer;
  readonly opts: LiveLayerOptions;
  private collection: Cesium.BillboardCollection;
  private tracks = new Map<string, Track>();
  private removeTick: (() => void) | null = null;
  private running = false;
  private lagMs: number;
  private staleMs: number;

  constructor(opts: LiveLayerOptions, lagMs = 15000, staleMs = 180000) {
    this.opts = opts;
    this.name = opts.name;
    this.viewer = opts.viewer;
    this.lagMs = lagMs;
    this.staleMs = staleMs;
    this.collection = new Cesium.BillboardCollection({ scene: opts.viewer.scene });
    this.lagMs = lagMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.viewer.scene.primitives.add(this.collection);
    const tick = () => this.render();
    this.viewer.scene.postUpdate.addEventListener(tick);
    this.removeTick = () => this.viewer.scene.postUpdate.removeEventListener(tick);
  }

  stop(): void {
    this.running = false;
    this.removeTick?.(); this.removeTick = null;
    this.viewer.scene.primitives.remove(this.collection);
    this.tracks.clear();
    this.collection.removeAll();
  }

  get size(): number { return this.tracks.size; }
  get fixes(): IterableIterator<LiveFix> {
    const map = this.tracks;
    return (function* () { for (const t of map.values()) yield t.next; })();
  }
  getFix(id: string): LiveFix | undefined { return this.tracks.get(id)?.next; }

  /** Push a batch of fresh fixes (one full snapshot). */
  ingest(fixes: LiveFix[]): void {
    const now = Date.now();
    const seen = new Set<string>();
    for (const fix of fixes) {
      seen.add(fix.id);
      const t = this.tracks.get(fix.id);
      if (t) {
        // ignore out-of-order
        if (fix.ts <= t.next.ts && now - fix.ts > 2000) continue;
        t.prev = t.next;
        t.next = fix;
        t.lastSeen = now;
      } else {
        this.tracks.set(fix.id, { prev: fix, next: fix, billboard: null, lastSeen: now });
      }
    }
    for (const [id, t] of this.tracks) {
      if (!seen.has(id) && now - t.lastSeen > this.staleMs) {
        if (t.billboard) { this.collection.remove(t.billboard); }
        this.tracks.delete(id);
      }
    }
  }

  clear(): void {
    this.tracks.clear();
    this.collection.removeAll();
  }

  private positionOf(t: Track, renderTime: number): Cesium.Cartesian3 | null {
    const { prev, next } = t;
    let lon = next.lon, lat = next.lat, alt = next.alt;
    const dt = next.ts - prev.ts;
    if (dt > 500 && dt < 120000) {
      // render one lag behind realtime, interpolating between the two fixes
      const frac = Math.min(1.25, Math.max(0, (renderTime - this.lagMs - prev.ts) / dt));
      lon = prev.lon + (next.lon - prev.lon) * frac;
      lat = prev.lat + (next.lat - prev.lat) * frac;
      alt = prev.alt + (next.alt - prev.alt) * frac;
      if (frac >= 1 && next.speed && next.speed > 0) {
        // dead-reckon past the newest fix, capped at 45 s
        const extra = Math.min(45000, (renderTime - this.lagMs - next.ts));
        if (extra > 0) {
          const hdg = Cesium.Math.toRadians(next.heading ?? 0);
          const d = next.speed * (extra / 1000);
          const R = 6378137;
          const lat1 = Cesium.Math.toRadians(lat), lon1 = Cesium.Math.toRadians(lon);
          const ang = d / R;
          const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(hdg));
          const lon2 = lon1 + Math.atan2(Math.sin(hdg) * Math.sin(ang) * Math.cos(lat1), Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2));
          lat = Cesium.Math.toDegrees(lat2); lon = Cesium.Math.toDegrees(lon2);
        }
      }
    }
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(0, alt));
  }

  private render(): void {
    if (!this.running) return;
    const now = Date.now();
    const max = this.opts.maxBillboards ?? 12000;
    const scene = this.viewer.scene;
    const camera = scene.camera;
    const canvas = scene.canvas;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    let count = 0;

    for (const t of this.tracks.values()) {
      if (count >= max) break;
      const pos = this.positionOf(t, now);
      if (!pos) { if (t.billboard) { this.collection.remove(t.billboard); t.billboard = null; } continue; }
      if (!t.billboard) {
        const color = t.next.color ?? this.opts.defaultColor ?? '#59d6ff';
        const kind = this.opts.glyphFor ? this.opts.glyphFor(t.next) : (t.next.kind ?? 'dot');
        t.billboard = this.collection.add({
          position: pos,
          image: sprite(kind, color),
          scale: (t.next.size ?? 1) * 0.62,
          color: Cesium.Color.WHITE,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          alignedAxis: Cesium.Cartesian3.ZERO,
          heightReference: this.opts.clampToGround ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE,
          disableDepthTestDistance: 0,
        });
        (t.billboard as unknown as { __fixId: string }).__fixId = t.next.id;
      }
      t.billboard.position = pos;

      // world-stable heading: project the course into screen space every frame
      const hdg = t.next.heading;
      if (hdg != null && Number.isFinite(hdg)) {
        const ahead = destinationPoint(t.next.lat, t.next.lon, hdg, Math.max(200, (t.next.speed ?? 60) * 12));
        const pAhead = Cesium.Cartesian3.fromDegrees(ahead.lon, ahead.lat, Math.max(0, t.next.alt));
        const a = Cesium.SceneTransforms.worldToWindowCoordinates(scene, pos);
        const b = Cesium.SceneTransforms.worldToWindowCoordinates(scene, pAhead);
        if (a && b) {
          const angle = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
          t.billboard.rotation = -angle;
        }
      }

      // simple horizon cull: hide if off-screen by margin (cheap)
      const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, pos);
      const vis = !!win && win.x > -60 && win.x < w + 60 && win.y > -60 && win.y < h + 60;
      t.billboard.show = vis || camera.positionCartographic.height > 25_000_000;
      if (vis) count++;
    }
  }

  pickFix(picked: unknown): LiveFix | null {
    if (!picked || typeof picked !== 'object') return null;
    const prim = (picked as { primitive?: unknown }).primitive as Cesium.Billboard | undefined;
    const id = prim && (prim as unknown as { __fixId?: string }).__fixId;
    if (!id) return null;
    return this.tracks.get(id)?.next ?? null;
  }
}

export function destinationPoint(lat: number, lon: number, headingDeg: number, distM: number): { lat: number; lon: number } {
  const R = 6378137;
  const ang = distM / R;
  const hdg = Cesium.Math.toRadians(headingDeg);
  const lat1 = Cesium.Math.toRadians(lat), lon1 = Cesium.Math.toRadians(lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(hdg));
  const lon2 = lon1 + Math.atan2(Math.sin(hdg) * Math.sin(ang) * Math.cos(lat1), Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: Cesium.Math.toDegrees(lat2), lon: Cesium.Math.toDegrees(lon2) };
}
