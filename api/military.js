// /api/military — military ADS-B traffic worldwide (adsb.lol, adsb.fi fallback).
export default async function handler(req, res) {
  const attempts = [
    'https://api.adsb.lol/v2/mil',
    'https://api.adsb.fi/v2/mil',
    'https://api.airplanes.live/v2/mil',
  ];
  for (const target of attempts) {
    try {
      const r = await fetch(target, { signal: AbortSignal.timeout(9000) });
      if (!r.ok) continue;
      const data = await r.json();
      if (Array.isArray(data.ac)) {
        res.setHeader('Cache-Control', 'public, max-age=10');
        res.status(200).json({ ac: data.ac });
        return;
      }
    } catch { /* next */ }
  }
  res.status(502).json({ error: 'military feeds unreachable', ac: [] });
}
