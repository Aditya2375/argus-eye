// Camera verbs: fly-to, orbit, continuous globe rotation, reset, tilt, north-up.
import * as Cesium from 'cesium';
import { bus } from './bus';
import { settings, saveSettings } from './settings';

let viewerRef: Cesium.Viewer | null = null;
let rotateRate = 0;   // deg/s of continuous globe spin, 0 = off
let orbitRate = 0;    // deg/s of orbit around view center, 0 = off
let tickRegistered = false;

function ensureTick(): void {
  if (!viewerRef || tickRegistered) return;
  tickRegistered = true;
  viewerRef.scene.preUpdate.addEventListener(() => {
    if (!viewerRef) return;
    const dt = 1 / 60;
    if (rotateRate !== 0) viewerRef.camera.rotate(Cesium.Cartesian3.UNIT_Z, Cesium.Math.toRadians(rotateRate) * dt);
    else if (orbitRate !== 0) viewerRef.camera.rotate(Cesium.Cartesian3.UNIT_Z, -Cesium.Math.toRadians(orbitRate) * dt);
  });
}

export function initCamera(viewer: Cesium.Viewer): void {
  viewerRef = viewer;
  // Any manual camera input stops rotation/orbit.
  viewer.camera.changed.addEventListener(() => { /* keep cheap; input handler below stops motion */ });
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(() => stopMotion(), Cesium.ScreenSpaceEventType.LEFT_DOWN);
  handler.setInputAction(() => stopMotion(), Cesium.ScreenSpaceEventType.WHEEL);
  handler.setInputAction(() => stopMotion(), Cesium.ScreenSpaceEventType.MIDDLE_DOWN);
  handler.setInputAction(() => stopMotion(), Cesium.ScreenSpaceEventType.RIGHT_DOWN);
}

export function flyTo(lon: number, lat: number, height = 1_500_000, duration = 3.2, pitchDeg?: number): void {
  if (!viewerRef) return;
  stopMotion();
  viewerRef.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    orientation: {
      heading: settings.northUp ? 0 : viewerRef.camera.heading,
      pitch: Cesium.Math.toRadians(pitchDeg ?? (height < 80_000 ? -55 : -90)),
      roll: 0,
    },
    duration,
  });
}

export function lookAt(lon: number, lat: number, range: number, headingDeg = 0, pitchDeg = -35): void {
  if (!viewerRef) return;
  stopMotion();
  viewerRef.camera.lookAt(
    Cesium.Cartesian3.fromDegrees(lon, lat),
    new Cesium.HeadingPitchRange(Cesium.Math.toRadians(headingDeg), Cesium.Math.toRadians(pitchDeg), range),
  );
  viewerRef.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}

export function resetGlobe(duration = 2.4): void {
  stopMotion();
  if (!viewerRef) return;
  viewerRef.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(15, 12, 19_500_000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration,
  });
  bus.emit('caption', 'FULL GLOBE');
}

export function startRotate(speedDegPerSec = 1.5): void {
  if (!viewerRef) return;
  stopMotion();
  ensureTick();
  rotateRate = speedDegPerSec;
  bus.emit('caption', `ROTATING ${speedDegPerSec > 0 ? 'EAST' : 'WEST'} ${Math.abs(speedDegPerSec).toFixed(1)}°/s`);
}

export function startOrbit(degPerSec = 6): void {
  if (!viewerRef) return;
  stopMotion();
  ensureTick();
  orbitRate = degPerSec;
  bus.emit('caption', `ORBIT ${degPerSec.toFixed(0)}°/s`);
}

export function stopMotion(): void {
  rotateRate = 0;
  orbitRate = 0;
  viewerRef?.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}

export function setTilt(mode: 'down' | 'oblique'): void {
  settings.tilt = mode; saveSettings();
  if (!viewerRef) return;
  const c = viewerRef.camera;
  const center = c.pickEllipsoid(new Cesium.Cartesian2(
    viewerRef.scene.canvas.clientWidth / 2, viewerRef.scene.canvas.clientHeight / 2));
  if (!center) return;
  const carto = Cesium.Cartographic.fromCartesian(center);
  const h = c.positionCartographic.height;
  c.setView({
    destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, h),
    orientation: {
      heading: settings.northUp ? 0 : c.heading,
      pitch: Cesium.Math.toRadians(mode === 'down' ? -90 : -35),
      roll: 0,
    },
  });
}

export function setNorthUp(on: boolean): void {
  settings.northUp = on; saveSettings();
  if (!viewerRef || !on) return;
  const c = viewerRef.camera;
  c.setView({ orientation: { heading: 0, pitch: c.pitch, roll: 0 } });
}

export function cameraState(): { lon: number; lat: number; height: number; heading: number; pitch: number } {
  const c = viewerRef!.camera;
  const carto = c.positionCartographic;
  return {
    lon: Cesium.Math.toDegrees(carto.longitude),
    lat: Cesium.Math.toDegrees(carto.latitude),
    height: carto.height,
    heading: Cesium.Math.toDegrees(c.heading),
    pitch: Cesium.Math.toDegrees(c.pitch),
  };
}

export function viewCenter(): { lon: number; lat: number } {
  if (!viewerRef) return { lon: 0, lat: 0 };
  const c = viewerRef.camera;
  const pick = c.pickEllipsoid(new Cesium.Cartesian2(
    viewerRef.scene.canvas.clientWidth / 2, viewerRef.scene.canvas.clientHeight / 2));
  if (pick) {
    const carto = Cesium.Cartographic.fromCartesian(pick);
    return { lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) };
  }
  const carto = c.positionCartographic;
  return { lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) };
}

export function viewRectangle(): { west: number; south: number; east: number; north: number } {
  const c = viewerRef!.camera;
  const rect = c.computeViewRectangle(viewerRef!.scene.globe.ellipsoid);
  if (!rect) return { west: -180, south: -85, east: 180, north: 85 };
  return {
    west: Cesium.Math.toDegrees(rect.west),
    south: Cesium.Math.toDegrees(rect.south),
    east: Cesium.Math.toDegrees(rect.east),
    north: Cesium.Math.toDegrees(rect.north),
  };
}
