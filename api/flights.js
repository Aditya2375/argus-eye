// /api/flights — worldwide ADS-B snapshot around the view center.
// Primary: OpenSky (anonymous, bbox). Fallbacks: adsb.lol, airplanes.live.
const RADIUS_NM_MAX = 250;

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
  const radiusNm = Math.min(RADIUS_NM_MAX, Math.max(60, Math.round((h / 1000) * 0.55)));

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
