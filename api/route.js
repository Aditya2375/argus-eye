// /api/route — street-following routes via OSRM on the FOSSGIS servers.
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const profile = url.searchParams.get('profile') ?? 'driving';
  const coords = url.searchParams.get('coords') ?? '';
  if (!/^routed-(car|bike|foot)$/.test(`routed-${profile}`) || !coords.match(/^-?[\d.]+,-?[\d.]+(;-?[\d.]+,-?[\d.]+)+$/)) {
    res.status(400).json({ error: 'bad profile or coords' });
    return;
  }
  try {
    const target = `https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
    const r = await fetch(target, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`osrm ${r.status}`);
    const data = await r.json();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err?.message ?? err) });
  }
}
