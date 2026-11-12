// Detection overlay: screen-space boxes + IDs over everything in view.
import * as Cesium from 'cesium';
import { settings } from './settings';

export interface DetectSource {
  name: string;
  items: () => Iterable<{ id: string; label: string; position: Cesium.Cartesian3; color?: string }>;
  active: () => boolean;
}

const sources: DetectSource[] = [];
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let viewerRef: Cesium.Viewer | null = null;

export function initDetect(viewer: Cesium.Viewer, overlay: HTMLCanvasElement): void {
  viewerRef = viewer;
  canvas = overlay;
  ctx = canvas.getContext('2d')!;
  const resize = () => {
    canvas.width = Math.floor(canvas.clientWidth * (window.devicePixelRatio || 1));
    canvas.height = Math.floor(canvas.clientHeight * (window.devicePixelRatio || 1));
  };
  resize();
  window.addEventListener('resize', resize);
  viewer.scene.postRender.addEventListener(draw);
}

export function registerDetectSource(src: DetectSource): void {
  sources.push(src);
}

export function unregisterDetectSource(name: string): void {
  const i = sources.findIndex((s) => s.name === name);
  if (i >= 0) sources.splice(i, 1);
}

const BOX_W = 44, BOX_H = 30;
const MAX_BOXES = 900;

function draw(): void {
  if (!viewerRef) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scene = viewerRef.scene;
  const density = settings.detectionDensity;
  if (density <= 0.01) return;

  let drawn = 0;
  const budget = Math.floor(MAX_BOXES * density);
  ctx.font = `${9 * dpr}px "JetBrains Mono", monospace`;
  ctx.lineWidth = 1 * dpr;

  for (const src of sources) {
    if (!src.active()) continue;
    for (const item of src.items()) {
      if (drawn >= budget) return;
      const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, item.position);
      if (!win) continue;
      const x = win.x * dpr, y = win.y * dpr;
      if (x < -BOX_W || x > canvas.width + BOX_W || y < -BOX_H || y > canvas.height + BOX_H) continue;
      const color = item.color ?? 'rgba(109,255,168,0.85)';
      ctx.strokeStyle = color;
      ctx.strokeRect(x - (BOX_W * dpr) / 2, y - (BOX_H * dpr) / 2, BOX_W * dpr, BOX_H * dpr);
      // corner ticks
      ctx.fillStyle = color;
      ctx.fillRect(x - (BOX_W * dpr) / 2, y - (BOX_H * dpr) / 2 - 3 * dpr, 8 * dpr, 1.5 * dpr);
      if (density > 0.35) {
        ctx.fillText(item.label.slice(0, 14), x + (BOX_W * dpr) / 2 + 4 * dpr, y + 3 * dpr);
      }
      drawn++;
    }
  }
}
