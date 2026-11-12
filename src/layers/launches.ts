// Space Missions: rolling 30-day launches (Launch Library 2) with a
// reconstructed ascent replay, scrubbable 0.25×–4×, labeled as an estimate.
import * as Cesium from 'cesium';
import type { LayerDeps, PointItem } from './common';
import { Poller, PointLayer, toastErrors } from './common';
import type { HudLayer } from '../core/hud';
import { bus } from '../core/bus';
import { el, escapeHtml } from '../core/dom';
import { renderCustomContext } from '../core/hud';

interface LlLaunch {
  id: string; name: string; net: string;
  status?: { name?: string };
  rocket?: { configuration?: { name?: string } };
  mission?: { name?: string; description?: string; type?: string };
  pad?: { name?: string; latitude?: string; longitude?: string; location?: { name?: string } };
  webcast_live?: boolean;
}

export function createLaunchesLayer(deps: LayerDeps): HudLayer {
  const points = new PointLayer('launches', deps.viewer);
  let launches: LlLaunch[] = [];

  const poller = new Poller(async () => {
    const since = new Date(Date.now() - 30 * 86400e3).toISOString();
    const until = new Date(Date.now() + 30 * 86400e3).toISOString();
    const res = await fetch(
      `https://ll.thespacedevs.com/2.3.0/launches/?net__gte=${since}&net__lte=${until}&limit=100&ordering=-net&mode=detailed`);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json() as { results: LlLaunch[] };
    launches = data.results ?? [];
    const items: PointItem[] = [];
    for (const l of launches) {
      const lat = Number(l.pad?.latitude); const lon = Number(l.pad?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const past = Date.parse(l.net) < Date.now();
      items.push({
        id: l.id, lon, lat, alt: 0,
        size: 11, color: past ? '#c3b2ff' : '#6dffa8',
        title: l.name,
        subtitle: `${l.pad?.location?.name ?? l.pad?.name ?? ''} · ${l.net.slice(0, 16).replace('T', ' ')}Z · ${l.status?.name ?? ''}`,
        meta: {
          NET: l.net.replace('T', ' ').slice(0, 16) + 'Z',
          ROCKET: l.rocket?.configuration?.name ?? '—',
          MISSION: l.mission?.type ?? '—',
          STATUS: l.status?.name ?? '—',
          PAD: l.pad?.name ?? '—',
        },
      });
    }
    points.setItems(items);
  }, 30 * 60 * 1000);
  poller.onError = toastErrors('launches');

  function replay(launch: LlLaunch): void {
    const lat = Number(launch.pad?.latitude); const lon = Number(launch.pad?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    bus.emit('caption', `RECONSTRUCTED ESTIMATE · ${launch.name}`);
    const node = el('div');
    node.append(el('div', 'ctx-title', escapeHtml(launch.name)));
    node.append(el('div', 'ctx-sub', 'Ascent replay — reconstructed estimate, not telemetry'));

    const durationS = 600; // T+0 → T+10 min nominal ascent model
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = String(durationS); slider.value = '0';
    slider.style.width = '100%';
    const readout = el('div', 'note', 'T+0s');
    const speeds = el('div', 'ctx-actions');
    let rate = 1; let t = 0; let raf = 0; let playing = true; let last = performance.now();

    let entity: Cesium.Entity | null = null;
    let trail: Cesium.Entity | null = null;
    const trailPts: Cesium.Cartesian3[] = [];

    const posAt = (tt: number): Cesium.Cartesian3 => {
      // simple pitch-over ascent: altitude grows ~t² up to 180km, drifts downrange east
      const f = Math.min(1, tt / durationS);
      const alt = 180000 * f * f * (3 - 2 * f);
      const downrangeKm = 900 * f * f;
      const dLon = downrangeKm / 111 / Math.max(0.2, Math.cos(lat * Math.PI / 180));
      return Cesium.Cartesian3.fromDegrees(lon + dLon, lat, alt);
    };

    const stepFrame = (now: number) => {
      if (!layer.enabled) return;
      if (playing) {
        t = Math.min(durationS, t + ((now - last) / 1000) * rate);
        slider.value = String(Math.round(t));
      }
      last = now;
      readout.textContent = `T+${Math.round(t)}s · ${rate}×`;
      const p = posAt(t);
      if (!entity) {
        entity = deps.viewer.entities.add({
          position: p,
          point: { pixelSize: 10, color: Cesium.Color.fromCssColorString('#c3b2ff') },
        });
      } else {
        entity.position = new Cesium.ConstantPositionProperty(p);
      }
      const lastPt = trailPts[trailPts.length - 1];
      if (!lastPt || Cesium.Cartesian3.distance(lastPt, p) > 1500) {
        trailPts.push(p);
        if (trail) deps.viewer.entities.remove(trail);
        trail = deps.viewer.entities.add({
          polyline: {
            positions: [...trailPts],
            width: 2,
            material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: Cesium.Color.fromCssColorString('#c3b2ff') }),
          },
        });
      }
      raf = requestAnimationFrame(stepFrame);
    };

    slider.oninput = () => {
      t = Number(slider.value);
      playing = false;
      playBtn.textContent = 'PLAY';
    };
    const playBtn = el('button', 'abtn', 'PAUSE');
    playBtn.onclick = () => { playing = !playing; playBtn.textContent = playing ? 'PAUSE' : 'PLAY'; };
    for (const r of [0.25, 1, 2, 4]) {
      const b = el('button', 'abtn', `${r}×`);
      b.onclick = () => { rate = r; };
      speeds.append(b);
    }
    const clearBtn = el('button', 'abtn danger', 'CLEAR');
    clearBtn.onclick = () => {
      cancelAnimationFrame(raf);
      if (entity) deps.viewer.entities.remove(entity);
      if (trail) deps.viewer.entities.remove(trail);
    };
    node.append(readout, slider, playBtn, speeds, clearBtn);
    renderCustomContext(node);
    last = performance.now();
    raf = requestAnimationFrame(stepFrame);
  }

  const layer: HudLayer = {
    id: 'launches', name: 'Space Missions (30d)', group: 'Events', auth: 'free', chip: 'LAUNCHES',
    enabled: false,
    count: () => (layer.enabled ? points.size : null),
    enable: async () => { points.start(); poller.start(); layer.enabled = true; },
    disable: () => { layer.enabled = false; poller.stop(); points.stop(); },
  };
  (layer as unknown as { pointLayer: PointLayer }).pointLayer = points;
  (layer as unknown as { replay: (id: string) => void }).replay = (id) => {
    const l = launches.find((x) => x.id === id);
    if (l) replay(l);
  };
  return layer;
}
