// /api/flights — worldwide ADS-B snapshot around the view center.
// Primary: OpenSky (anonymous, bbox). Fallbacks: adsb.lol, airplanes.live.
const RADIUS_NM_MAX = 250;

// OpenSky anonymous quota is ~400 req/day/IP on shared cloud egress; cache
// the global snapshot in-function so polling clients share one upstream call.
let globalCache = null;
let globalCacheAt = 0;
let mosaicCache = null;
let mosaicCacheAt = 0;

// Busy-airspace grid used when the OpenSky global snapshot is unreachable
// (it goes down or rate-limits cloud egress). Point feeds cap at 250nm, so a
// globe view mosaics the major corridors; zooming in fills the rest.
const MOSAIC_CELLS = [
  [40.5, -74.5], [34.0, -118.2], [41.8, -87.6], [33.7, -84.4],
  [51.3, 0.5], [50.1, 8.7], [48.3, 11.8], [41.4, 2.2],
  [25.2, 55.3], [19.1, 72.9], [13.7, 100.5], [1.35, 103.8],
  [22.3, 114.2], [31.2, 121.5], [35.7, 139.7], [37.5, 127.0],
  [-33.9, 151.2], [-23.4, -46.6], [19.4, -99.1], [33.9, 35.5],
];
const MOSAIC_HOSTS = ['https://api.adsb.lol', 'https://api.airplanes.live'];

async function mosaicGlobal() {
  const results = await Promise.allSettled(MOSAIC_CELLS.map(async ([lat, lon], i) => {
    // light stagger: ~4 waves across the two hosts, respecting 1 req/s per host
    await new Promise((r) => setTimeout(r, Math.floor(i / 4) * 900 + (i % 2) * 450));
    for (const host of MOSAIC_HOSTS) {
      try {
        const r = await fetch(`${host}/v2/point/${lat.toFixed(2)}/${lon.toFixed(2)}/250`, { signal: AbortSignal.timeout(9000) });
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d.ac)) return d.ac;
        }
      } catch { /* next host */ }
    }
    return [];
  }));
  const seen = new Set();
  const ac = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const a of r.value) {
      if (a && a.hex && !seen.has(a.hex) && a.lat != null && a.lon != null && a.alt_baro) {
        seen.add(a.hex);
        ac.push(a);
      }
    }
  }
  return ac;
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const lat = Number(url.searchParams.get('lat') ?? '20');
  const lon = Number(url.searchParams.get('lon') ?? '0');
  const h = Number(url.searchParams.get('h') ?? '2000000');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: 'bad lat/lon' });
    return;
  }
  // map camera height to a search radius
  const rawRadiusNm = Math.max(60, Math.round((h / 1000) * 0.55));

  // Zoomed out past what a point query can cover: global OpenSky snapshot.
  if (rawRadiusNm > RADIUS_NM_MAX) {
    if (globalCache && Date.now() - globalCacheAt < 25000) {
      res.setHeader('Cache-Control', 'public, max-age=10');
      res.status(200).json(globalCache);
      return;
    }
    try {
      const r = await fetch('https://opensky-network.org/api/states/all', { signal: AbortSignal.timeout(12000) });
      if (r.ok) {
        const data = await r.json();
        const ac = (data.states ?? []).map((s) => ({
          hex: s[0], flight: (s[1] ?? '').trim(), lat: s[6], lon: s[5],
          alt_baro: s[7] != null ? Math.round(s[7] / 0.3048) : null,
          gs: s[9] != null ? Math.round(s[9] / 0.514444) : null,
          track: s[10], seen: 0, t: '', squawk: s[14] ?? '', category: '',
        })).filter((a) => a.lat != null && a.lon != null && a.alt_baro);
        globalCache = { src: 'opensky-global', ac, stale: false };
        globalCacheAt = Date.now();
        res.setHeader('Cache-Control', 'public, max-age=10');
        res.status(200).json(globalCache);
        return;
      }
    } catch { /* fall through */ }
    if (globalCache) {
      res.setHeader('Cache-Control', 'public, max-age=10');
      res.status(200).json({ ...globalCache, stale: true });
      return;
    }
    // OpenSky unreachable: mosaic the major corridors from the point feeds.
    if (mosaicCache && Date.now() - mosaicCacheAt < 45000) {
      res.setHeader('Cache-Control', 'public, max-age=10');
      res.status(200).json(mosaicCache);
      return;
    }
    try {
      const ac = await mosaicGlobal();
      if (ac.length) {
        mosaicCache = { src: 'mosaic', ac, stale: false };
        mosaicCacheAt = Date.now();
        res.setHeader('Cache-Control', 'public, max-age=10');
        res.status(200).json(mosaicCache);
        return;
      }
    } catch { /* fall through */ }
    if (mosaicCache) {
      res.setHeader('Cache-Control', 'public, max-age=10');
      res.status(200).json({ ...mosaicCache, stale: true });
      return;
    }
  }
  const radiusNm = Math.min(RADIUS_NM_MAX, rawRadiusNm);

  const attempts = [
    ['adsblol', `https://api.adsb.lol/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${radiusNm}`],
    ['airplanes.live', `https://api.airplanes.live/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${radiusNm}`],
  ];
  for (const [src, target] of attempts) {
    try {
      const r = await fetch(target, { signal: AbortSignal.timeout(9000) });
      if (!r.ok) continue;
      const data = await r.json();
      if (Array.isArray(data.ac)) {
        res.setHeader('Cache-Control', 'public, max-age=6');
        res.status(200).json({ src, ac: data.ac, stale: false });
        return;
      }
    } catch { /* next */ }
  }
  // Last resort: OpenSky anonymous global states, filtered client-side by bbox size.
  try {
    const dLat = Math.min(35, radiusNm / 60);
    const dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const osUrl = `https://opensky-network.org/api/states/all?lamin=${lat - dLat}&lamax=${lat + dLat}&lomin=${lon - dLon}&lomax=${lon + dLon}`;
    const r = await fetch(osUrl, { signal: AbortSignal.timeout(9000) });
    if (r.ok) {
      const data = await r.json();
      const ac = (data.states ?? []).map((s) => ({
        hex: s[0], flight: (s[1] ?? '').trim(), lat: s[6], lon: s[5],
        alt_baro: s[7] != null ? Math.round(s[7] / 0.3048) : null,
        gs: s[9] != null ? Math.round(s[9] / 0.514444) : null,
        track: s[10], seen: 0, t: '', squawk: s[14] ?? '', category: '',
      })).filter((a) => a.lat != null && a.lon != null);
      res.setHeader('Cache-Control', 'public, max-age=10');
      res.status(200).json({ src: 'opensky', ac, stale: false });
      return;
    }
  } catch { /* fall through */ }
  res.status(502).json({ error: 'all flight feeds unreachable', ac: [] });
}
