// Shared layer plumbing: polling helper + point-cloud layer for static-ish
// event feeds (quakes, fires, launches, …) + a layer context type.
import * as Cesium from 'cesium';
import { el, escapeHtml } from '../core/dom';
import { bus } from '../core/bus';
import { tracker } from '../core/track';
import { renderCustomContext } from '../core/hud';

export interface LayerDeps {
  viewer: Cesium.Viewer;
}

export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private fn: () => Promise<void>;
  private intervalMs: number;
  private inFlight = false;
  onError: (err: unknown) => void = () => undefined;

  constructor(fn: () => Promise<void>, intervalMs: number) {
    this.fn = fn;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try { await this.fn(); } catch (err) { this.onError(err); } finally { this.inFlight = false; }
  }
}

export interface PointItem {
  id: string;
  lon: number;
  lat: number;
  alt?: number;
  size?: number;
  color?: string;
  title: string;
  subtitle?: string;
  meta: Record<string, string>;
  link?: string;
  photo?: string;
}

/** A simple clickable point cloud in its own data source. */
export class PointLayer {
  readonly name: string;
  private viewer: Cesium.Viewer;
  private ds: Cesium.CustomDataSource;
  private items = new Map<string, PointItem>();

  constructor(name: string, viewer: Cesium.Viewer) {
    this.name = name;
    this.viewer = viewer;
    this.ds = new Cesium.CustomDataSource(name);
  }

  start(): void { this.viewer.dataSources.add(this.ds); }
  stop(): void { this.viewer.dataSources.remove(this.ds, true); this.items.clear(); }
  get size(): number { return this.items.size; }
  values(): IterableIterator<PointItem> { return this.items.values(); }
  get(id: string): PointItem | undefined { return this.items.get(id); }

  setItems(items: PointItem[]): void {
    this.items = new Map(items.map((i) => [i.id, i]));
    this.ds.entities.removeAll();
    for (const item of items) {
      this.ds.entities.add({
        id: `${this.name}:${item.id}`,
        position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat, item.alt ?? 0),
        point: {
          pixelSize: item.size ?? 8,
          color: Cesium.Color.fromCssColorString(item.color ?? '#59d6ff').withAlpha(0.9),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
          outlineWidth: 1.5,
          disableDepthTestDistance: 0,
        },
      });
    }
  }

  handlePick(picked: unknown): boolean {
    const entity = (picked as { id?: Cesium.Entity })?.id;
    if (!entity || !(entity instanceof Cesium.Entity)) return false;
    if (!entity.id.startsWith(`${this.name}:`)) return false;
    const item = this.items.get(entity.id.slice(this.name.length + 1));
    if (!item) return false;
    showPointCard(item);
    return true;
  }
}

export function showPointCard(item: PointItem): void {
  const node = el('div');
  node.append(el('div', 'ctx-title', escapeHtml(item.title)));
  if (item.subtitle) node.append(el('div', 'ctx-sub', escapeHtml(item.subtitle)));
  if (item.photo) {
    const img = document.createElement('img');
    img.className = 'ctx-photo';
    img.src = item.photo;
    img.loading = 'lazy';
    node.append(img);
  }
  for (const [k, v] of Object.entries(item.meta)) {
    const row = el('div', 'kv');
    row.append(el('span', 'k', escapeHtml(k)), el('span', 'v', escapeHtml(v)));
    node.append(row);
  }
  if (item.link) {
    const actions = el('div', 'ctx-actions');
    const a = document.createElement('a');
    a.href = item.link; a.target = '_blank'; a.rel = 'noopener';
    a.className = 'abtn'; a.textContent = 'SOURCE ↗';
    actions.append(a);
    node.append(actions);
  }
  renderCustomContext(node);
  bus.emit('caption', item.title.toUpperCase());
}

/** Degrees of lat/lon span that roughly match the current camera height. */
export function bboxForHeight(heightM: number): { dLat: number; dLon: (lat: number) => number } {
  const spanKm = Math.min(20000, Math.max(60, heightM / 1000 * 1.9));
  const dLat = spanKm / 222;
  return { dLat, dLon: (lat: number) => dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180)) };
}
