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

// CelesTrak FORMAT=json is OMM without the TLE lines; FORMAT=tle carries them.
function parseTleText(text, cls, cap) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i + 2 < lines.length && out.length < cap; i++) {
    const name = lines[i].trim();
    const line1 = lines[i + 1].trim();
    const line2 = lines[i + 2].trim();
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue;
    out.push({ id: line1.substring(2, 7).trim(), name: name || line1.substring(2, 7).trim(), cls, line1, line2 });
    i += 2;
  }
  return out;
}

async function fetchGroup([group, cls, cap]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(
        `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`,
        { signal: AbortSignal.timeout(8000), headers: UA });
      if (!r.ok) throw new Error(`celestrak ${group} ${r.status}`);
      return parseTleText(await r.text(), cls, cap);
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
