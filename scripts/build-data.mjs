// Build-time data pack: bundled datasets for search + infrastructure layers.
// Sources: Natural Earth (public domain), OpenStreetMap (ODbL), TeleGeography
// (non-commercial use — see DATA_SOURCES.md). Fails soft: missing packs make
// those layers empty, never break the build.
import { writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'public', 'data');
await mkdir(out, { recursive: true });

// Packs are committed to the repo; refresh only missing ones (or all with
// REFRESH_DATA=1) so deploys stay fast and deterministic.
const REFRESH = process.env.REFRESH_DATA === '1';
async function missing(name) {
  if (REFRESH) return true;
  try { await access(path.join(out, name)); return false; } catch { return true; }
}

const UA = { 'User-Agent': 'argus-eye/1.0 (personal open-source project; build-time data fetch)' };

async function get(url, timeoutMs = 30000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// 1) Places for keyless search: Natural Earth 110m populated places.
if (await missing('places.json')) try {
  const data = await get('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_populated_places_simple.geojson');
  const places = data.features
    .filter((f) => f.geometry?.coordinates)
    .map((f) => ({
      n: f.properties.nameascii ?? f.properties.name,
      k: 'city',
      lo: f.geometry.coordinates[0],
      la: f.geometry.coordinates[1],
      h: 120000,
    }))
    .filter((p) => p.n);
  // landmarks appended by hand (public knowledge, coordinates WGS84)
  places.push(
    { n: 'Eiffel Tower, Paris', k: 'landmark', lo: 2.2945, la: 48.8584, h: 4000 },
    { n: 'Statue of Liberty, New York', k: 'landmark', lo: -74.0445, la: 40.6892, h: 4000 },
    { n: 'Burj Khalifa, Dubai', k: 'landmark', lo: 55.2744, la: 25.1972, h: 4000 },
    { n: 'Taj Mahal, Agra', k: 'landmark', lo: 78.0421, la: 27.1751, h: 5000 },
    { n: 'Sydney Opera House', k: 'landmark', lo: 151.2153, la: -33.8568, h: 4000 },
    { n: 'Three Gorges Dam', k: 'landmark', lo: 111.0033, la: 30.8231, h: 30000 },
    { n: 'Area 51, Nevada', k: 'landmark', lo: -115.8111, la: 37.235, h: 40000 },
    { n: 'Kennedy Space Center', k: 'landmark', lo: -80.6508, la: 28.5721, h: 30000 },
    { n: 'Starbase, Texas', k: 'landmark', lo: -97.1566, la: 25.9971, h: 25000 },
    { n: 'Davis-Monthan Boneyard, Tucson', k: 'landmark', lo: -110.8593, la: 32.1512, h: 20000 },
    { n: 'LAX Los Angeles International', k: 'airport', lo: -118.4085, la: 33.9416, h: 40000 },
    { n: 'JFK New York', k: 'airport', lo: -73.7781, la: 40.6413, h: 40000 },
    { n: 'DFW Dallas Fort Worth', k: 'airport', lo: -97.0403, la: 32.8998, h: 45000 },
    { n: 'Heathrow London', k: 'airport', lo: -0.4543, la: 51.47, h: 40000 },
    { n: 'Haneda Tokyo', k: 'airport', lo: 139.7798, la: 35.5494, h: 40000 },
    { n: 'Kempegowda Bengaluru', k: 'airport', lo: 77.7099, la: 13.1989, h: 40000 },
  );
  await writeFile(path.join(out, 'places.json'), JSON.stringify(places));
  console.log(`places.json: ${places.length}`);
} catch (e) { console.warn('places pack failed:', e.message); }

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
async function overpass(q) {
  const timeoutMs = Number(process.env.OVERPASS_TIMEOUT_MS ?? 70000);
  for (const ep of OVERPASS) {
    try {
      const r = await fetch(ep, {
        method: 'POST', body: `data=${encodeURIComponent(q)}`,
        signal: AbortSignal.timeout(timeoutMs), headers: UA,
      });
      if (r.ok) return await r.json();
      console.warn('overpass', ep, r.status);
    } catch (e) { console.warn('overpass', ep, e.message); }
  }
  return null;
}

// Wikidata SPARQL fallback (CC0) for when every Overpass mirror is down.
// coord arrives as WKT "Point(lon lat)".
async function wikidata(sparql) {
  try {
    const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql);
    const r = await fetch(url, { signal: AbortSignal.timeout(60000), headers: UA });
    if (!r.ok) { console.warn('wikidata', r.status); return null; }
    const data = await r.json();
    return (data.results?.bindings ?? []).map((b) => {
      const m = /^Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value ?? '');
      if (!m) return null;
      return { n: b.itemLabel?.value, la: Number(m[2]), lo: Number(m[1]) };
    }).filter((x) => x && Number.isFinite(x.la) && Number.isFinite(x.lo) && x.n && !/^Q\d+$/.test(x.n));
  } catch (e) { console.warn('wikidata', e.message); return null; }
}

// 2) Datacenters: OSM via Overpass (man_made=data_center), nodes + way centers.
if (await missing('datacenters.json')) try {
  const q = '[out:json][timeout:60];(node["man_made"="data_center"];way["man_made"="data_center"];);out center tags 6000;';
  const data = await overpass(q);
  if (data) {
    const rows = data.elements
      .map((e) => ({
        n: e.tags?.name, la: e.lat ?? e.center?.lat, lo: e.lon ?? e.center?.lon, o: e.tags?.operator,
      }))
      .filter((x) => Number.isFinite(x.la) && Number.isFinite(x.lo));
    await writeFile(path.join(out, 'datacenters.json'), JSON.stringify(rows));
    console.log(`datacenters.json: ${rows.length}`);
  } else {
    const rows = await wikidata('SELECT ?item ?itemLabel ?coord WHERE { ?item wdt:P31/wdt:P279* wd:Q671224; wdt:P625 ?coord. SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 4000');
    if (rows?.length) {
      await writeFile(path.join(out, 'datacenters.json'), JSON.stringify(rows));
      console.log(`datacenters.json (wikidata): ${rows.length}`);
    } else console.warn('datacenters: overpass and wikidata failed');
  }
} catch (e) { console.warn('datacenters pack failed:', e.message); }

// 3) Dams: OSM waterway=dam with a name (keeps the pack light and meaningful).
if (await missing('dams.json')) try {
  const q = '[out:json][timeout:60];(node["waterway"="dam"]["name"];way["waterway"="dam"]["name"];);out center tags 6000;';
  const data = await overpass(q);
  if (data) {
    const rows = data.elements
      .map((e) => ({ n: e.tags?.name, la: e.lat ?? e.center?.lat, lo: e.lon ?? e.center?.lon }))
      .filter((x) => Number.isFinite(x.la) && Number.isFinite(x.lo));
    await writeFile(path.join(out, 'dams.json'), JSON.stringify(rows));
    console.log(`dams.json: ${rows.length}`);
  } else {
    const rows = await wikidata('SELECT ?item ?itemLabel ?coord WHERE { ?item wdt:P31/wdt:P279* wd:Q12323; wdt:P625 ?coord. SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 8000');
    if (rows?.length) {
      await writeFile(path.join(out, 'dams.json'), JSON.stringify(rows));
      console.log(`dams.json (wikidata): ${rows.length}`);
    } else console.warn('dams: overpass and wikidata failed');
  }
} catch (e) { console.warn('dams pack failed:', e.message); }

// 4) Submarine cables: TeleGeography public GeoJSON (non-commercial terms).
if (await missing('cables.geojson')) try {
  const data = await get('https://www.submarinecablemap.com/api/v3/cable/cable-geo.json');
  const features = [];
  const bySlug = new Map();
  for (const f of data.features ?? []) {
    const slug = f.properties?.slug ?? f.properties?.id;
    if (!bySlug.has(slug)) bySlug.set(slug, { type: 'Feature', properties: { name: f.properties?.name }, geometry: { type: 'MultiLineString', coordinates: [] } });
    const acc = bySlug.get(slug);
    if (f.geometry?.type === 'LineString') acc.geometry.coordinates.push(f.geometry.coordinates);
    else if (f.geometry?.type === 'MultiLineString') acc.geometry.coordinates.push(...f.geometry.coordinates);
  }
  features.push(...bySlug.values());
  await writeFile(path.join(out, 'cables.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
  console.log(`cables.geojson: ${features.length}`);
} catch (e) {
  console.warn('cables pack failed:', e.message);
  await writeFile(path.join(out, 'cables.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }));
}
