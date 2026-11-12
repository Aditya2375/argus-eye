// CCTV Mesh: official public-camera catalogs (Austin, Fintraffic, Tallinn,
// Hong Kong …) projected into the 3D scene. Click a camera for its live frame,
// viewshed cone, and NEAREST jumps from any tracked target.
import * as Cesium from 'cesium';
import type { LayerDeps } from './common';
import { Poller } from './common';
import type { HudLayer } from '../core/hud';
import { bus } from '../core/bus';
import { el, escapeHtml } from '../core/dom';
import { renderCustomContext } from '../core/hud';
import { flyTo } from '../core/camera';

interface Cam { id: string; name: string; lat: number; lon: number; image?: string | null; video?: string | null; link?: string | null }

const SOURCES = [
  { id: 'austin', name: 'Austin' },
  { id: 'fintraffic', name: 'Finland' },
  { id: 'tallinn', name: 'Tallinn' },
  { id: 'hongkong', name: 'Hong Kong' },
];

export function createCctvLayer(deps: LayerDeps): HudLayer {
  let ds: Cesium.CustomDataSource | null = null;
  let cameras: Cam[] = [];
  let viewshedsOn = false;
  const viewshedEntities: Cesium.Entity[] = [];

  const poller = new Poller(async () => {
    const results = await Promise.allSettled(SOURCES.map(async (s) => {
      const res = await fetch(`/api/cctv?src=${s.id}`);
      if (!res.ok) throw new Error(`${s.id} ${res.status}`);
      const data = await res.json() as { cameras?: Cam[] };
      return data.cameras ?? [];
    }));
    cameras = [];
    for (const r of results) if (r.status === 'fulfilled') cameras.push(...r.value);
    if (!ds) return;
    ds.entities.removeAll();
    for (const cam of cameras) {
      if (!Number.isFinite(cam.lat) || !Number.isFinite(cam.lon)) continue;
      ds.entities.add({
        id: `cctv:${cam.id}`,
        position: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, 0),
        billboard: {
          image: cameraIcon(),
          scale: 0.6,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
    }
  }, 15 * 60 * 1000);
  poller.onError = (e) => console.warn('[cctv]', e);

  function cameraIcon(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ff9de2';
    g.fillRect(4, 10, 16, 12);
    g.beginPath(); g.moveTo(20, 13); g.lineTo(28, 9); g.lineTo(28, 23); g.lineTo(20, 19); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1.5; g.strokeRect(4, 10, 16, 12);
    return c;
  }

  function drawViewsheds(): void {
    for (const e of viewshedEntities.splice(0)) deps.viewer.entities.remove(e);
    if (!viewshedsOn || !ds) return;
    const h = deps.viewer.camera.positionCartographic.height;
    if (h > 80000) { bus.emit('toast', { text: 'Zoom below ~80 km for camera viewsheds.' }); return; }
    let drawn = 0;
    for (const cam of cameras) {
      if (drawn >= 220) break;
      const center = deps.viewer.camera.positionCartographic;
      const dLat = Math.abs(cam.lat - Cesium.Math.toDegrees(center.latitude));
      if (dLat > 2.5) continue;
      const hdg = Math.random() * 360; // pose prior: unknown until calibrated
      const length = 350;
      const spread = 24 * Math.PI / 180;
      const a = hdg * Math.PI / 180;
      const p1 = destination(cam.lat, cam.lon, a - spread / 2, length);
      const p2 = destination(cam.lat, cam.lon, a + spread / 2, length);
      viewshedEntities.push(deps.viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy([
            Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, 5),
            Cesium.Cartesian3.fromDegrees(p1.lon, p1.lat, 5),
            Cesium.Cartesian3.fromDegrees(p2.lon, p2.lat, 5),
          ]),
          material: Cesium.Color.fromCssColorString('#ff9de2').withAlpha(0.16),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#ff9de2').withAlpha(0.4),
          height: 0,
        },
      }));
      drawn++;
    }
  }

  function showCam(cam: Cam): void {
    const node = el('div');
    node.append(el('div', 'ctx-title', escapeHtml(cam.name)));
    node.append(el('div', 'ctx-sub', 'PUBLIC CAMERA · frame refreshes every 30s'));
    if (cam.video) {
      const v = document.createElement('video');
      v.className = 'ctx-photo';
      v.controls = true; v.autoplay = true; v.muted = true;
      v.src = cam.video;
      node.append(v);
    } else if (cam.image) {
      const img = document.createElement('img');
      img.className = 'ctx-photo';
      img.src = cam.image;
      node.append(img);
      const timer = setInterval(() => {
        if (!document.body.contains(img)) { clearInterval(timer); return; }
        img.src = cam.image + (cam.image!.includes('?') ? '&' : '?') + 't=' + Date.now();
      }, 30000);
    } else {
      node.append(el('div', 'note', 'No public frame for this camera.'));
    }
    const actions = el('div', 'ctx-actions');
    const fly = el('button', 'abtn', 'FLY TO');
    fly.onclick = () => flyTo(cam.lon, cam.lat, 600, 2, -55);
    actions.append(fly);
    if (cam.link) {
      const a = document.createElement('a');
      a.href = cam.link; a.target = '_blank'; a.rel = 'noopener';
      a.className = 'abtn'; a.textContent = 'SOURCE ↗';
      actions.append(a);
    }
    node.append(actions);
    renderCustomContext(node);
  }

  bus.on<{ lat: number; lon: number }>('cctv:nearest', ({ lat, lon }) => {
    if (!cameras.length) { bus.emit('toast', { text: 'Enable the Cameras layer first.', kind: 'warn' }); return; }
    let best: Cam | null = null; let bestD = Infinity;
    for (const cam of cameras) {
      const d = (cam.lat - lat) ** 2 + (cam.lon - lon) ** 2;
      if (d < bestD) { bestD = d; best = cam; }
    }
    if (best) { showCam(best); flyTo(best.lon, best.lat, 2500, 2.5); }
    else bus.emit('toast', { text: 'No camera catalog loaded.', kind: 'warn' });
  });

  const layer: HudLayer = {
    id: 'cctv', name: 'CCTV Mesh', group: 'Cameras', auth: 'free', chip: 'CAMERAS',
    enabled: false,
    count: () => (layer.enabled ? cameras.length : null),
    enable: async () => {
      ds = new Cesium.CustomDataSource('cctv');
      deps.viewer.dataSources.add(ds);
      poller.start();
      layer.enabled = true;
    },
    disable: () => {
      layer.enabled = false;
      poller.stop();
      viewshedsOn = false;
      for (const e of viewshedEntities.splice(0)) deps.viewer.entities.remove(e);
      if (ds) { deps.viewer.dataSources.remove(ds, true); ds = null; }
      cameras = [];
    },
  };
  (layer as unknown as { pick: (p: unknown) => boolean }).pick = (picked) => {
    const entity = (picked as { id?: Cesium.Entity })?.id;
    if (!entity || !(entity instanceof Cesium.Entity) || !entity.id.startsWith('cctv:')) return false;
    const cam = cameras.find((c) => `cctv:${c.id}` === entity.id);
    if (!cam) return false;
    showCam(cam);
    return true;
  };
  (layer as unknown as { toggleViewsheds: () => void }).toggleViewsheds = () => {
    viewshedsOn = !viewshedsOn;
    drawViewsheds();
    bus.emit('caption', viewshedsOn ? 'VIEWSHEDS ON (pose priors — uncalibrated)' : 'VIEWSHEDS OFF');
  };
  return layer;
}

function destination(lat: number, lon: number, headingRad: number, distM: number): { lat: number; lon: number } {
  const R = 6378137;
  const ang = distM / R;
  const lat1 = lat * Math.PI / 180, lon1 = lon * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(headingRad));
  const lon2 = lon1 + Math.atan2(Math.sin(headingRad) * Math.sin(ang) * Math.cos(lat1), Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
}
