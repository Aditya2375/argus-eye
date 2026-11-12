// /api/vessels — Digitraffic (Finland) live AIS snapshot, normalized.
// Proxied because Digitraffic requires an Accept-Encoding: gzip header that
// browsers forbid JS from setting.
export default async function handler(req, res) {
  try {
    const r = await fetch('https://meri.digitraffic.fi/api/ais/v1/locations', {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'argus-eye/1.0 (open-source situational-awareness globe)' },
    });
    if (!r.ok) throw new Error(`digitraffic ${r.status}`);
    const data = await r.json();
    const vessels = [];
    for (const f of data.features ?? []) {
      const [lon, lat] = f.geometry?.coordinates ?? [];
      if (lon == null) continue;
      vessels.push({
        id: String(f.mmsi),
        lon, lat,
        heading: f.properties?.cog ?? f.properties?.heading ?? 0,
        sogKnots: f.properties?.sog ?? 0,
        ts: f.properties?.timestampExternal ?? Date.now(),
      });
    }
    res.setHeader('Cache-Control', 'public, max-age=25');
    res.status(200).json({ vessels });
  } catch (err) {
    res.status(502).json({ error: String(err?.message ?? err), vessels: [] });
  }
}
