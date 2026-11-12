// Directions: click A and B for a street-following route (OSRM/FOSSGIS),
// draped on the terrain with turn-by-turn — then FLY the camera along it.
import * as Cesium from 'cesium';
import type { LayerDeps } from './common';
import type { HudLayer } from '../core/hud';
import { bus } from '../core/bus';
import { el, fmtKm } from '../core/dom';
import { renderCustomContext } from '../core/hud';

type Profile = 'car' | 'bike' | 'foot';

export function createDirectionsLayer(deps: LayerDeps): HudLayer {
  let picking: 'A' | 'B' | null = null;
  let ptA: { lat: number; lon: number } | null = null;
  let ptB: { lat: number; lon: number } | null = null;
  let routeEntity: Cesium.Entity | null = null;
  let markerA: Cesium.Entity | null = null;
  let markerB: Cesium.Entity | null = null;
  let handler: Cesium.ScreenSpaceEventHandler | null = null;
  let routePts: Cesium.Cartesian3[] = [];
  let flying = false;

  function marker(lat: number, lon: number, color: string, label: string): Cesium.Entity {
    return deps.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      point: { pixelSize: 12, color: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
      label: { text: label, font: '11px monospace', pixelOffset: new Cesium.Cartesian2(0, -16), fillColor: Cesium.Color.WHITE },
    });
  }

  async function compute(profile: Profile): Promise<void> {
    if (!ptA || !ptB) return;
    try {
      const coords = `${ptA.lon},${ptA.lat};${ptB.lon},${ptB.lat}`;
      const res = await fetch(`/api/route?profile=${profile}&coords=${encodeURIComponent(coords)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as {
        routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: Array<{ steps: Array<{ maneuver: { type: string; instruction?: string }; distance: number; name: string }> }> }>;
      };
      const route = data.routes?.[0];
      if (!route) { bus.emit('toast', { text: 'No route found.', kind: 'warn' }); return; }
      if (routeEntity) deps.viewer.entities.remove(routeEntity);
      routePts = route.geometry.coordinates.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 2));
      routeEntity = deps.viewer.entities.add({
        polyline: {
          positions: routePts,
          width: 4,
          material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: Cesium.Color.fromCssColorString('#6dffa8') }),
          clampToGround: true,
        },
      });
      const node = el('div');
      node.append(el('div', 'ctx-title', 'ROUTE'));
      node.append(el('div', 'ctx-sub', `${fmtKm(route.distance)} · ~${Math.round(route.duration / 60)} min · ${profile}`));
      const steps = route.legs?.[0]?.steps ?? [];
      for (const s of steps.slice(0, 24)) {
        node.append(el('div', 'note', `• ${s.maneuver.type}${s.name ? ` onto ${s.name}` : ''} (${fmtKm(s.distance)})`));
      }
      const actions = el('div', 'ctx-actions');
      const flyBtn = el('button', 'abtn', flying ? 'STOP FLIGHT' : 'FLY ROUTE');
      flyBtn.onclick = () => { flying ? stopFly() : flyRoute(); flyBtn.textContent = flying ? 'STOP FLIGHT' : 'FLY ROUTE'; };
      const clear = el('button', 'abtn danger', 'CLEAR');
      clear.onclick = () => clearAll();
      actions.append(flyBtn, clear);
      node.append(actions);
      renderCustomContext(node);
    } catch (err) {
      console.warn('[directions]', err);
      bus.emit('toast', { text: 'Routing service unreachable.', kind: 'warn' });
    }
  }

  let flyRaf = 0;
  function flyRoute(): void {
    if (routePts.length < 2) return;
    flying = true;
    let i = 0;
    const stepN = () => {
      if (!flying || i >= routePts.length - 1) { flying = false; return; }
      const p = routePts[i];
      deps.viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(p).longitude),
          Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(p).latitude), 900),
        orientation: {
          heading: bearing(routePts[i], routePts[Math.min(i + 1, routePts.length - 1)]),
          pitch: Cesium.Math.toRadians(-55), roll: 0,
        },
      });
      i++;
      flyRaf = requestAnimationFrame(stepN);
    };
    stepN();
    bus.emit('caption', 'FLYING ROUTE');
  }
  function stopFly(): void { flying = false; cancelAnimationFrame(flyRaf); }

  function bearing(a: Cesium.Cartesian3, b: Cesium.Cartesian3): number {
    const ca = Cesium.Cartographic.fromCartesian(a);
    const cb = Cesium.Cartographic.fromCartesian(b);
    const dLon = cb.longitude - ca.longitude;
    const y = Math.sin(dLon) * Math.cos(cb.latitude);
    const x = Math.cos(ca.latitude) * Math.sin(cb.latitude) - Math.sin(ca.latitude) * Math.cos(cb.latitude) * Math.cos(dLon);
    return Math.atan2(y, x);
  }

  function clearAll(): void {
    stopFly();
    for (const e of [routeEntity, markerA, markerB]) if (e) deps.viewer.entities.remove(e);
    routeEntity = markerA = markerB = null;
    ptA = ptB = null; routePts = [];
  }

  function openPanel(): void {
    const node = el('div');
    node.append(el('div', 'ctx-title', 'DIRECTIONS'));
    node.append(el('div', 'ctx-sub', 'Click A, then B, on the globe'));
    const actions = el('div', 'ctx-actions');
    const a = el('button', 'abtn', ptA ? 'A ✓' : 'SET A');
    const b = el('button', 'abtn', ptB ? 'B ✓' : 'SET B');
    a.onclick = () => { picking = 'A'; bus.emit('caption', 'CLICK POINT A'); };
    b.onclick = () => { picking = 'B'; bus.emit('caption', 'CLICK POINT B'); };
    const go = el('button', 'abtn warn', 'ROUTE');
    go.onclick = () => void compute('car');
    const walk = el('button', 'abtn', 'WALK');
    walk.onclick = () => void compute('foot');
    const bike = el('button', 'abtn', 'CYCLE');
    bike.onclick = () => void compute('bike');
    actions.append(a, b, go, walk, bike);
    node.append(actions);
    renderCustomContext(node);
  }

  const layer: HudLayer = {
    id: 'directions', name: 'Directions', group: 'Utilities', auth: 'free',
    enabled: false,
    count: () => null,
    enable: async () => {
      layer.enabled = true;
      handler = new Cesium.ScreenSpaceEventHandler(deps.viewer.scene.canvas);
      handler.setInputAction((ev: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        if (!picking) return;
        const cart = deps.viewer.camera.pickEllipsoid(ev.position);
        if (!cart) return;
        const c = Cesium.Cartographic.fromCartesian(cart);
        const lat = Cesium.Math.toDegrees(c.latitude);
        const lon = Cesium.Math.toDegrees(c.longitude);
        if (picking === 'A') { if (markerA) deps.viewer.entities.remove(markerA); markerA = marker(lat, lon, '#6dffa8', 'A'); ptA = { lat, lon }; }
        else { if (markerB) deps.viewer.entities.remove(markerB); markerB = marker(lat, lon, '#ff5a5a', 'B'); ptB = { lat, lon }; }
        picking = null;
        openPanel();
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      openPanel();
    },
    disable: () => {
      layer.enabled = false;
      handler?.destroy(); handler = null;
      clearAll();
    },
  };
  return layer;
}
