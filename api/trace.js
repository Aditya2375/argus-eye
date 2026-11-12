// /api/trace?hex=… — recent position history for one transponder.
// Uses the adsb.lol replay API (re-api) which replays the last ~24h.
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const hex = (url.searchParams.get('hex') ?? '').replace(/[^0-9a-fA-F]/g, '');
  if (!hex) { res.status(400).json({ error: 'hex required' }); return; }
  const attempts = [
    `https://re-api.adsb.lol/?hex=${hex}`,
    `https://re-api.adsb.fi/?hex=${hex}`,
  ];
  for (const target of attempts) {
    try {
      const r = await fetch(target, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const data = await r.json();
      const traces = Array.isArray(data?.trace) ? data.trace
        : Array.isArray(data?.aircraft?.[0]?.trace) ? data.aircraft[0].trace : null;
      if (traces && traces.length) {
        const points = traces
          .filter((p) => Array.isArray(p) && p.length >= 4 && p[1] != null && p[2] != null)
          .map((p) => ({ lat: p[1], lon: p[2], alt: typeof p[3] === 'number' ? p[3] * 0.3048 : 0 }));
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.status(200).json({ points });
        return;
      }
    } catch { /* next */ }
  }
  res.status(200).json({ points: [] });
}
