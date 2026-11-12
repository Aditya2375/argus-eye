// Keyless-first search: decimal coords, geo: URIs, bundled cities/landmarks,
// then Photon (komoot) and Nominatim. Google Geocoding when a key is set.
import { fetchJson, el, debounce } from './dom';
import { flyTo } from './camera';
import { bus } from './bus';
import { settings } from './settings';

export interface PlaceHit {
  name: string;
  kind: string;
  lon: number;
  lat: number;
  height?: number;
}

interface BundledPlace { n: string; k: string; lo: number; la: number; h?: number }
let bundled: BundledPlace[] | null = null;

async function loadBundled(): Promise<BundledPlace[]> {
  if (bundled) return bundled;
  try {
    bundled = await fetchJson<BundledPlace[]>('/data/places.json', undefined, 15000);
  } catch {
    bundled = [];
  }
  return bundled;
}

const COORD_RE = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/;
const GEO_RE = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i;

export async function searchPlaces(query: string): Promise<PlaceHit[]> {
  const q = query.trim();
  if (!q) return [];

  const cm = q.match(COORD_RE);
  if (cm) {
    const lat = Number(cm[1]), lon = Number(cm[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return [{ name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, kind: 'COORDINATES', lon, lat, height: 40000 }];
    }
  }
  const gm = q.match(GEO_RE);
  if (gm) {
    const lat = Number(gm[1]), lon = Number(gm[2]);
    return [{ name: `geo:${lat}, ${lon}`, kind: 'GEO URI', lon, lat, height: 40000 }];
  }

  const hits: PlaceHit[] = [];
  const places = await loadBundled();
  const ql = q.toLowerCase();
  for (const p of places) {
    if (p.n.toLowerCase().includes(ql)) {
      hits.push({ name: p.n, kind: p.k.toUpperCase(), lon: p.lo, lat: p.la, height: p.h });
      if (hits.length >= 6) break;
    }
  }

  // Google first when a key is configured.
  if (settings.keys.googleMaps) {
    try {
      const res = await fetchJson<{ results?: Array<{ formatted_address: string; geometry: { location: { lat: number; lng: number } } }> }>(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${settings.keys.googleMaps}`);
      for (const r of res.results ?? []) {
        hits.push({ name: r.formatted_address, kind: 'GOOGLE', lon: r.geometry.location.lng, lat: r.geometry.location.lat });
      }
      if (hits.length) return hits.slice(0, 8);
    } catch { /* fall through */ }
  }

  try {
    const photon = await fetchJson<{ features?: Array<{ properties: { name?: string; city?: string; country?: string; osm_value?: string }; geometry: { coordinates: [number, number] } }> }>(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6`);
    for (const f of photon.features ?? []) {
      const p = f.properties;
      const label = [p.name, p.city, p.country].filter(Boolean).join(', ');
      if (label) hits.push({ name: label, kind: (p.osm_value ?? 'PLACE').toUpperCase(), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
    }
  } catch { /* Photon down — try Nominatim */ }

  if (!hits.length) {
    try {
      const nom = await fetchJson<Array<{ display_name: string; lon: string; lat: string; type: string }>>(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6`);
      for (const r of nom) hits.push({ name: r.display_name, kind: r.type.toUpperCase(), lon: Number(r.lon), lat: Number(r.lat) });
    } catch { /* nothing */ }
  }
  return hits.slice(0, 8);
}

export function initSearch(): void {
  const input = document.getElementById('search-input') as HTMLInputElement;
  const results = document.getElementById('search-results')!;
  results.classList.add('glass');

  const run = debounce(async () => {
    const q = input.value;
    if (q.trim().length < 2) { results.classList.add('hidden'); return; }
    let hits: PlaceHit[] = [];
    try { hits = await searchPlaces(q); } catch (err) { console.warn(err); }
    results.innerHTML = '';
    if (!hits.length) {
      results.append(el('div', 'sr-item', 'No matches — try coordinates (lat, lon) or a geo: URI.'));
    } else {
      for (const h of hits) {
        const item = el('button', 'sr-item');
        item.append(el('span', 'sr-name', h.name), el('span', 'sr-kind', h.kind));
        item.onclick = () => {
          results.classList.add('hidden');
          input.value = h.name;
          flyTo(h.lon, h.lat, h.height ?? 25000);
          bus.emit('caption', h.name.toUpperCase());
        };
        results.append(item);
      }
    }
    results.classList.remove('hidden');
  }, 350);

  input.addEventListener('input', run);
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const hits = await searchPlaces(input.value);
      if (hits.length) {
        results.classList.add('hidden');
        flyTo(hits[0].lon, hits[0].lat, hits[0].height ?? 25000);
        bus.emit('caption', hits[0].name.toUpperCase());
      }
    } else if (e.key === 'Escape') {
      results.classList.add('hidden');
    }
  });
  document.addEventListener('click', (e) => {
    if (!document.getElementById('searchbox')!.contains(e.target as Node)) results.classList.add('hidden');
  });
}
