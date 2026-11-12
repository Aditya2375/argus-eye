// Sensor looks: GLSL post-process stages over the live globe.
// NORMAL · CRT · NVG · FLIR (ironbow) · NOIR · SHARPEN overlay. Keys 1–6.
import * as Cesium from 'cesium';
import { bus } from './bus';
import { settings, saveSettings } from './settings';

export type SensorMode = 'normal' | 'crt' | 'nvg' | 'flir' | 'noir';

const SHADERS: Record<Exclude<SensorMode, 'normal'>, string> = {
  crt: `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float u_time;
float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec2 uv = v_textureCoordinates;
  vec2 cc = uv - 0.5;
  uv = uv + cc * dot(cc, cc) * 0.08;                 // gentle barrel
  vec3 col = texture(colorTexture, uv).rgb;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum) * vec3(0.85, 1.0, 0.92), 0.75);
  float scan = 0.86 + 0.14 * sin(uv.y * 900.0);
  col *= scan;
  col += (rand(uv * u_time) - 0.5) * 0.05;
  float vig = smoothstep(0.95, 0.45, length(cc));
  col *= vig;
  out_FragColor = vec4(col, 1.0);
}`,
  nvg: `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float u_time;
float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec2 uv = v_textureCoordinates;
  vec3 col = texture(colorTexture, uv).rgb;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  lum = pow(lum, 0.72) * 1.5;
  vec3 g = vec3(lum * 0.35, lum, lum * 0.42);
  g += (rand(uv * (u_time + 13.7)) - 0.5) * 0.09;
  vec2 cc = uv - 0.5;
  float vig = smoothstep(0.92, 0.4, length(cc));
  g *= vig;
  out_FragColor = vec4(g, 1.0);
}`,
  flir: `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
vec3 ironbow(float t){
  t = clamp(t, 0.0, 1.0);
  vec3 c1 = vec3(0.02, 0.0, 0.10), c2 = vec3(0.45, 0.05, 0.55);
  vec3 c3 = vec3(0.95, 0.35, 0.10), c4 = vec3(1.0, 0.95, 0.85);
  if (t < 0.33) return mix(c1, c2, t / 0.33);
  if (t < 0.66) return mix(c2, c3, (t - 0.33) / 0.33);
  return mix(c3, c4, (t - 0.66) / 0.34);
}
void main(){
  vec2 uv = v_textureCoordinates;
  vec3 col = texture(colorTexture, uv).rgb;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  lum = pow(lum, 0.85);
  out_FragColor = vec4(ironbow(lum), 1.0);
}`,
  noir: `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
void main(){
  vec2 uv = v_textureCoordinates;
  vec3 col = texture(colorTexture, uv).rgb;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  lum = smoothstep(0.08, 0.9, lum);
  vec2 cc = uv - 0.5;
  lum *= smoothstep(1.0, 0.5, length(cc) * 1.1);
  out_FragColor = vec4(vec3(lum), 1.0);
}`,
};

const SHARPEN = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float u_amount;
void main(){
  vec2 px = vec2(1.0) / czm_viewport.zw;
  vec3 c = texture(colorTexture, v_textureCoordinates).rgb * (1.0 + 4.0 * u_amount);
  c -= texture(colorTexture, v_textureCoordinates + vec2(px.x, 0.0)).rgb * u_amount;
  c -= texture(colorTexture, v_textureCoordinates - vec2(px.x, 0.0)).rgb * u_amount;
  c -= texture(colorTexture, v_textureCoordinates + vec2(0.0, px.y)).rgb * u_amount;
  c -= texture(colorTexture, v_textureCoordinates - vec2(0.0, px.y)).rgb * u_amount;
  out_FragColor = vec4(c, 1.0);
}`;

let viewerRef: Cesium.Viewer | null = null;
let active: Cesium.PostProcessStage | null = null;
let sharpen: Cesium.PostProcessStage | null = null;
let clockStart = Date.now();
let mode: SensorMode = 'normal';

export function initFx(viewer: Cesium.Viewer): void {
  viewerRef = viewer;
  clockStart = Date.now();
  if (settings.sensor && settings.sensor !== 'normal') setSensor(settings.sensor, true);
}

export function setSensor(next: SensorMode, silent = false): void {
  if (!viewerRef) return;
  const stages = viewerRef.scene.postProcessStages;
  if (active) { stages.remove(active); active = null; }
  mode = next;
  if (next !== 'normal') {
    active = new Cesium.PostProcessStage({
      fragmentShader: SHADERS[next],
      uniforms: { u_time: () => (Date.now() - clockStart) / 1000 },
    });
    stages.add(active);
  }
  settings.sensor = next;
  saveSettings();
  bus.emit('sensor:changed', next);
  if (!silent) bus.emit('caption', `SENSOR · ${next.toUpperCase()}`);
}

export function currentSensor(): SensorMode { return mode; }

export function setSharpen(on: boolean, amount = 0.35): void {
  if (!viewerRef) return;
  const stages = viewerRef.scene.postProcessStages;
  if (sharpen) { stages.remove(sharpen); sharpen = null; }
  if (on) {
    sharpen = new Cesium.PostProcessStage({ fragmentShader: SHARPEN, uniforms: { u_amount: amount } });
    stages.add(sharpen);
  }
  bus.emit('caption', on ? 'IMAGE SHARPENED' : 'SHARPEN OFF');
}

export function cycleSensor(): SensorMode {
  const order: SensorMode[] = ['normal', 'crt', 'nvg', 'flir', 'noir'];
  const next = order[(order.indexOf(mode) + 1) % order.length];
  setSensor(next);
  return next;
}
