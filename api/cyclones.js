// /api/cyclones — NHC/CPHC active tropical cyclones: position + forecast track.
let cache = null;
let cacheAt = 0;

export default async function handler(req, res) {
  try {
    if (cache && Date.now() - cacheAt < 5 * 60 * 1000) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.status(200).json(cache);
      return;
    }
    const r = await fetch('https://www.nhc.noaa.gov/CurrentStorms.json', { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`nhc ${r.status}`);
    const data = await r.json();
    const storms = (data.activeStorms ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      basin: s.basin,
      classification: s.classification,
      intensity: s.intensity,
      pressure: s.pressure,
      lat: s.latitudeNumeric ?? null,
      lon: s.longitudeNumeric ?? null,
      movementDir: s.movementDir,
      movementSpeed: s.movementSpeed,
      lastUpdate: s.lastUpdate,
      publicAdvisory: s.publicAdvisory?.url ?? null,
    })).filter((s) => s.lat != null && s.lon != null);
    cache = { storms };
    cacheAt = Date.now();
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json(cache);
  } catch (err) {
    res.status(502).json({ error: String(err?.message ?? err), storms: cache?.storms ?? [] });
  }
}
