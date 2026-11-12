// Tracking: click-to-track anything, fading trail, telemetry in the CONTEXT
// panel, cockpit chase view, and hand-off helpers (nearest camera).
import * as Cesium from 'cesium';
import { bus } from './bus';
import type { LiveFix } from './liveLayer';

export interface TrackTarget {
  layer: string;                    // owning layer name (flights, vessels, …)
  id: string;
  title: string;
  subtitle?: string;
  getFix: () => LiveFix | undefined | null;
  meta?: () => Record<string, string>;
  actions?: Array<{ label: string; kind?: 'default' | 'warn' | 'danger'; run: () => void }>;
}

const MAX_TRAIL = 240;

class TrackManager {
  private viewer: Cesium.Viewer | null = null;
  private target: TrackTarget | null = null;
  private ghost: Cesium.Entity | null = null;
  private trail: Cesium.Entity | null = null;
  private trailPts: Array<{ t: number; p: Cesium.Cartesian3 }> = [];
  private cockpit = false;
  private veil: HTMLElement | null = null;
  private strip: HTMLElement | null = null;
  private removeTick: (() => void) | null = null;

  init(viewer: Cesium.Viewer): void {
    this.viewer = viewer;
    this.veil = document.getElementById('cockpit-veil');
  }

  get current(): TrackTarget | null { return this.target; }
  get isCockpit(): boolean { return this.cockpit; }

  track(target: TrackTarget): void {
    if (!this.viewer) return;
    this.untrack(false);
    this.target = target;
    this.trailPts = [];

    this.ghost = this.viewer.entities.add({
      position: new Cesium.CallbackPositionProperty(() => {
        const fix = this.target?.getFix();
        if (!fix) return undefined;
        return Cesium.Cartesian3.fromDegrees(fix.lon, fix.lat, Math.max(0, fix.alt));
      }, false),
    });

    this.trail = this.viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => this.trailPts.map((p) => p.p), false),
        width: 2,
        material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.18, color: Cesium.Color.fromCssColorString('#59d6ff') }),
        clampToGround: false,
      },
    });

    this.viewer.trackedEntity = this.ghost;

    const tick = () => {
      const fix = this.target?.getFix();
      if (!fix) return;
      const p = Cesium.Cartesian3.fromDegrees(fix.lon, fix.lat, Math.max(0, fix.alt));
      const last = this.trailPts[this.trailPts.length - 1];
      if (!last || Cesium.Cartesian3.distance(last.p, p) > 120) {
        this.trailPts.push({ t: Date.now(), p });
        if (this.trailPts.length > MAX_TRAIL) this.trailPts.shift();
      }
      if (this.cockpit) this.renderStrip(fix);
      bus.emit('track:tick', fix);
    };
    this.viewer.scene.postUpdate.addEventListener(tick);
    this.removeTick = () => this.viewer?.scene.postUpdate.removeEventListener(tick);

    bus.emit('track:changed', target);
  }

  untrack(notify = true): void {
    if (!this.viewer) return;
    if (this.cockpit) this.exitCockpit();
    this.viewer.trackedEntity = undefined;
    if (this.ghost) this.viewer.entities.remove(this.ghost);
    if (this.trail) this.viewer.entities.remove(this.trail);
    this.ghost = null; this.trail = null; this.target = null;
    this.removeTick?.(); this.removeTick = null;
    if (notify) bus.emit('track:changed', null);
  }

  enterCockpit(): void {
    if (!this.viewer || !this.target || this.cockpit) return;
    this.cockpit = true;
    this.viewer.trackedEntity = undefined;
    const follow = () => {
      if (!this.cockpit) return;
      const fix = this.target?.getFix();
      if (!fix || !this.viewer) return;
      const pos = Cesium.Cartesian3.fromDegrees(fix.lon, fix.lat, Math.max(30, fix.alt));
      const transform = Cesium.Transforms.eastNorthUpToFixedFrame(pos);
      const hdg = Cesium.Math.toRadians(fix.heading ?? 0);
      const rot = Cesium.Matrix3.fromHeadingPitchRoll(new Cesium.HeadingPitchRoll(hdg, 0, 0));
      const rotated = Cesium.Matrix4.multiplyByMatrix3(transform, rot, new Cesium.Matrix4());
      this.viewer.camera.lookAtTransform(rotated, new Cesium.Cartesian3(-90, 14, 22));
    };
    this.viewer.scene.postUpdate.addEventListener(follow);
    const prev = this.removeTick;
    this.removeTick = () => { prev?.(); this.viewer?.scene.postUpdate.removeEventListener(follow); };
    this.veil?.classList.remove('hidden');
    this.strip = document.createElement('div');
    this.strip.className = 'cockpit-strip';
    document.body.appendChild(this.strip);
    bus.emit('cockpit:changed', true);
    bus.emit('caption', 'COCKPIT · ESC TO EXIT');
  }

  exitCockpit(): void {
    if (!this.cockpit) return;
    this.cockpit = false;
    this.viewer?.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    if (this.ghost && this.viewer) this.viewer.trackedEntity = this.ghost;
    this.veil?.classList.add('hidden');
    this.strip?.remove(); this.strip = null;
    bus.emit('cockpit:changed', false);
  }

  private renderStrip(fix: LiveFix): void {
    if (!this.strip) return;
    const m = fix.meta;
    const gs = typeof m.gsKnots === 'number' ? `${Math.round(m.gsKnots)} KT` : '—';
    const alt = typeof m.altFeet === 'number' ? `${Math.round(m.altFeet).toLocaleString('en-US')} FT` : '—';
    this.strip.textContent = `${this.target?.title ?? ''} · HDG ${Math.round(((fix.heading ?? 0) % 360 + 360) % 360)}° · ${gs} · ${alt}`;
  }
}

export const tracker = new TrackManager();
