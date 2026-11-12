// /api/news — GDELT DOC 2.0 based news. mode=conflicts (physical violence
// worldwide) or mode=local&country=XX (2-letter code or name).
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const mode = url.searchParams.get('mode') ?? 'conflicts';
  const country = url.searchParams.get('country') ?? '';
  const hours = Math.min(24, Math.max(1, Number(url.searchParams.get('hours') ?? '24')));

  let query;
  if (mode === 'local' && country) {
    query = `sourcecountry:${country}`;
  } else {
    query = '(war OR airstrike OR missile OR clash OR offensive OR shelling OR invasion OR attack)';
  }
  const gdelt = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query + ' sourcelang:english')}` +
    `&mode=ArtList&format=json&maxrecords=50&timespan=${hours}h&sort=HybridRel`;
  const cacheKey = `${mode}:${country}:${hours}`;
  if (cache.has(cacheKey) && Date.now() - cache.get(cacheKey).at < CACHE_MS) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json(cache.get(cacheKey).body);
    return;
  }
  try {
    // GDELT regularly takes 10-20s; one generous attempt, then serve cache.
    const r = await fetch(gdelt, {
      signal: AbortSignal.timeout(24000),
      headers: { 'User-Agent': 'argus-eye/1.0 (open-source situational-awareness globe)' },
    });
    if (!r.ok) throw new Error(`gdelt ${r.status}`);
    const data = await r.json();
    const articles = (data.articles ?? []).map((a) => ({
      title: a.title,
      url: a.url,
      source: a.domain,
      country: a.sourcecountry,
      seenAt: a.seendate,
      image: a.socialimage,
      tone: a.tone,
    }));
    const body = { mode, articles };
    cache.set(cacheKey, { at: Date.now(), body });
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json(body);
  } catch (err) {
    const hit = cache.get(cacheKey) ?? [...cache.values()][0];
    if (hit) {
      res.setHeader('Cache-Control', 'public, max-age=120');
      res.status(200).json({ ...hit.body, stale: true });
      return;
    }
    res.status(502).json({ error: String(err?.message ?? err), articles: [] });
  }
}
