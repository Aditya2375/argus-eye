// Persisted console settings: provider keys (BYOK), UI prefs, layer memory.
const LS_KEY = 'argus-eye.settings.v1';

export interface Settings {
  keys: {
    cesiumIon: string;
    googleMaps: string;
    aisStream: string;
    firmsMapKey: string;
  };
  mapStack: 'esri' | 'osm' | 'ion3d' | 'google3d';
  sensor: 'normal' | 'crt' | 'nvg' | 'flir' | 'noir';
  detectionDensity: number; // 0..1
  northUp: boolean;
  tilt: 'down' | 'oblique';
  voiceLocale: string;
}

const DEFAULTS: Settings = {
  keys: {
    cesiumIon: '', googleMaps: '',
    aisStream: '', firmsMapKey: '',
  },
  mapStack: 'esri',
  sensor: 'normal',
  detectionDensity: 0.5,
  northUp: false,
  tilt: 'oblique',
  voiceLocale: 'en-US',
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULTS), ...parsed, keys: { ...DEFAULTS.keys, ...(parsed.keys ?? {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const settings: Settings = load();

export function saveSettings(): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}
