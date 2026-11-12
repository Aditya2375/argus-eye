// /api/tle — CelesTrak GP (TLE) elements across curated groups, classified
// into ARGUS EYE satellite classes. Cached in-function for warm invocations.
const GROUPS = [
  ['stations', 'stations', 60],
  ['weather', 'imaging', 120],
  ['goes', 'imaging', 40],
  ['noaa', 'imaging', 40],
  ['geo', 'telecom', 600],
  ['intelsat', 'telecom', 300],
  ['science', 'science', 300],
  ['starlink', 'starlink', 1600],
  ['iridium-33-debris', 'debris', 200],
  ['cosmos-2251-debris', 'debris', 300],
];

let cache = null;
let cacheAt = 0;
const CACHE_MS = 30 * 60 * 1000;
// CelesTrak asks for a descriptive UA and rate-limits bursts from shared
// cloud IPs; fetch two groups at a time with retries.
const UA = { 'User-Agent': 'argus-eye/1.0 (open-source situational-awareness globe)' };

async function fetchGroup([group, cls, cap]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(
        `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=json`,
        { signal: AbortSignal.timeout(8000), headers: UA });
      if (!r.ok) throw new Error(`celestrak ${group} ${r.status}`);
      const rows = await r.json();
      return (Array.isArray(rows) ? rows : []).slice(0, cap).map((row) => ({
        id: String(row.NORAD_CAT_ID),
        name: String(row.OBJECT_NAME ?? row.NORAD_CAT_ID),
        cls,
        line1: row.TLE_LINE1,
        line2: row.TLE_LINE2,
      })).filter((s) => s.line1 && s.line2);
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((s) => setTimeout(s, 600 * (attempt + 1)));
    }
  }
  return [];
}

export default async function handler(req, res) {
  try {
    if (cache && Date.now() - cacheAt < CACHE_MS) {
      res.setHeader('Cache-Control', 'public, max-age=1800');
      res.status(200).json(cache);
      return;
    }
    const results = [];
    for (let i = 0; i < GROUPS.length; i += 2) {
      results.push(...await Promise.allSettled(GROUPS.slice(i, i + 2).map(fetchGroup)));
    }
    const sats = [];
    for (const r of results) if (r.status === 'fulfilled') sats.push(...r.value);
    if (!sats.length) throw new Error('no groups loaded');
    cache = { sats, fetchedAt: new Date().toISOString() };
    cacheAt = Date.now();
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.status(200).json(cache);
  } catch (err) {
    if (cache) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.status(200).json({ ...cache, stale: true });
      return;
    }
    res.status(502).json({ error: String(err?.message ?? err), sats: [] });
  }
}
