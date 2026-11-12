// Draw: area / line / pin annotations on the real world, persisted in this
// browser; name, recolour, hide, fly to each shape. Voice whiteboard uses the
// same store.
import * as Cesium from 'cesium';
import type { LayerDeps } from './common';
import type { HudLayer } from '../core/hud';
import { bus } from '../core/bus';
import { el } from '../core/dom';
import { renderCustomContext } from '../core/hud';
import { flyTo } from '../core/camera';

export interface Shape {
  id: string;
  kind: 'area' | 'line' | 'pin' | 'connector';
  color: string;
  name: string;
  pts: Array<{ lat: number; lon: number }>;
  hidden?: boolean;
  label?: string;
}

const LS = 'argus-eye.shapes.v1';
let shapes: Shape[] = [];
const drawn = new Map<string, Cesium.Entity>();

function persist(): void {
  try { localStorage.setItem(LS, JSON.stringify(shapes)); } catch { /* full */ }
}
function restore(): void {
  try { shapes = JSON.parse(localStorage.getItem(LS) ?? '[]') as Shape[]; } catch { shapes = []; }
}

export function createDrawLayer(deps: LayerDeps): HudLayer {
  let drawing: { kind: Shape['kind']; color: string; pts: Array<{ lat: number; lon: number }> } | null = null;
  let handler: Cesium.ScreenSpaceEventHandler | null = null;
  let preview: Cesium.Entity | null = null;

  function renderShape(s: Shape): void {
    const old = drawn.get(s.id);
    if (old) { deps.viewer.entities.remove(old); drawn.delete(s.id); }
    if (s.hidden) return;
    const color = Cesium.Color.fromCssColorString(s.color);
    const positions = s.pts.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 1));
    let entity: Cesium.Entity | null = null;
    if (s.kind === 'pin') {
      entity = deps.viewer.entities.add({
        position: positions[0],
        point: { pixelSize: 12, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
        label: s.name ? { text: s.name, font: '11px monospace', pixelOffset: new Cesium.Cartesian2(0, -18), fillColor: color } : undefined,
      });
    } else if (s.kind === 'line' || s.kind === 'connector') {
      entity = deps.viewer.entities.add({
        polyline: {
          positions, width: 3.5,
          material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color }),
          clampToGround: true,
        },
      });
    } else {
      entity = deps.viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: color.withAlpha(0.25),
          outline: true, outlineColor: color.withAlpha(0.8), height: 0,
        },
      });
    }
    if (entity) drawn.set(s.id, entity);
  }

  function renderAll(): void {
    for (const s of shapes) renderShape(s);
  }

  function openPanel(): void {
    const node = el('div');
    node.append(el('div', 'ctx-title', 'DRAW'));
    node.append(el('div', 'ctx-sub', 'Whiteboard over the real world — persists in this browser'));
    const tools = el('div', 'ctx-actions');
    for (const [kind, label] of [['area', 'AREA'], ['line', 'LINE'], ['pin', 'PIN']] as Array<[Shape['kind'], string]>) {
      const b = el('button', 'abtn', label);
      b.onclick = () => {
        drawing = { kind, color: '#59d6ff', pts: [] };
        bus.emit('caption', kind === 'pin' ? 'CLICK TO PLACE PIN' : 'CLICK VERTICES · DOUBLE-CLICK TO FINISH');
      };
      tools.append(b);
    }
    const clear = el('button', 'abtn danger', 'CLEAR ALL');
    clear.onclick = () => {
      for (const e of drawn.values()) deps.viewer.entities.remove(e);
      drawn.clear();
      shapes = [];
      persist();
      openPanel();
    };
    tools.append(clear);
    node.append(tools);
    node.append(el('div', 'hr'));
    for (const s of shapes) {
      const row = el('div', 'minirow');
      const sw = el('span', 'swatch');
      sw.style.background = s.color;
      const nameInput = document.createElement('input');
      nameInput.value = s.name;
      nameInput.placeholder = 'name';
      nameInput.style.cssText = 'background:transparent;border:none;color:var(--ink);font-size:12px;width:110px;outline:none;';
      nameInput.onchange = () => { s.name = nameInput.value; persist(); renderShape(s); };
      row.append(sw, nameInput, el('span', 'spacer'));
      const colors = ['#59d6ff', '#ffb454', '#ff5a5a', '#6dffa8', '#ff9de2'];
      const cBtn = el('button', 'abtn', 'COLOR');
      let ci = colors.indexOf(s.color);
      cBtn.onclick = () => { ci = (ci + 1) % colors.length; s.color = colors[ci]; sw.style.background = s.color; persist(); renderShape(s); };
      const hide = el('button', 'abtn', s.hidden ? 'SHOW' : 'HIDE');
      hide.onclick = () => { s.hidden = !s.hidden; hide.textContent = s.hidden ? 'SHOW' : 'HIDE'; persist(); renderShape(s); };
      const fly = el('button', 'abtn', 'FLY');
      fly.onclick = () => { const p = s.pts[0]; flyTo(p.lon, p.lat, 30000, 2); };
      const del = el('button', 'abtn danger', '✕');
      del.onclick = () => {
        const e = drawn.get(s.id);
        if (e) deps.viewer.entities.remove(e);
        drawn.delete(s.id);
        shapes = shapes.filter((x) => x.id !== s.id);
        persist();
        openPanel();
      };
      row.append(cBtn, hide, fly, del);
      node.append(row);
    }
    renderCustomContext(node);
  }

  function pickLatLon(ev: Cesium.ScreenSpaceEventHandler.PositionedEvent): { lat: number; lon: number } | null {
    const cart = deps.viewer.camera.pickEllipsoid(ev.position);
    if (!cart) return null;
    const c = Cesium.Cartographic.fromCartesian(cart);
    return { lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude) };
  }

  const layer: HudLayer = {
    id: 'draw', name: 'Draw / Whiteboard', group: 'Utilities', auth: 'free',
    enabled: false,
    count: () => shapes.length || null,
    enable: async () => {
      layer.enabled = true;
      restore();
      renderAll();
      handler = new Cesium.ScreenSpaceEventHandler(deps.viewer.scene.canvas);
      handler.setInputAction((ev: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        if (!drawing) return;
        const p = pickLatLon(ev);
        if (!p) return;
        if (drawing.kind === 'pin') {
          const s: Shape = { id: `s${Date.now()}`, kind: 'pin', color: drawing.color, name: '', pts: [p] };
          shapes.push(s); persist(); renderShape(s);
          drawing = null;
          openPanel();
          return;
        }
        drawing.pts.push(p);
        if (preview) deps.viewer.entities.remove(preview);
        const color = Cesium.Color.fromCssColorString(drawing.color).withAlpha(0.7);
        preview = deps.viewer.entities.add({
          polyline: {
            positions: drawing.pts.map((q) => Cesium.Cartesian3.fromDegrees(q.lon, q.lat, 1)),
            width: 2, material: new Cesium.PolylineDashMaterialProperty({ color }), clampToGround: true,
          },
        });
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      handler.setInputAction(() => {
        if (!drawing || drawing.pts.length < 2) return;
        const s: Shape = { id: `s${Date.now()}`, kind: drawing.kind, color: drawing.color, name: '', pts: drawing.pts };
        shapes.push(s); persist(); renderShape(s);
        if (preview) { deps.viewer.entities.remove(preview); preview = null; }
        drawing = null;
        openPanel();
      }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      openPanel();
    },
    disable: () => {
      layer.enabled = false;
      handler?.destroy(); handler = null;
      drawing = null;
      if (preview) { deps.viewer.entities.remove(preview); preview = null; }
    },
  };

  // Voice whiteboard API
  (layer as unknown as { addShape: (s: Omit<Shape, 'id'>) => void }).addShape = (s) => {
    const full: Shape = { ...s, id: `s${Date.now()}${Math.floor(Math.random() * 999)}` };
    shapes.push(full);
    persist();
    renderShape(full);
  };
  (layer as unknown as { clearShapes: () => void }).clearShapes = () => {
    for (const e of drawn.values()) deps.viewer.entities.remove(e);
    drawn.clear();
    shapes = [];
    persist();
  };
  return layer;
}
