// /api/wrecks — shipwrecks: Wikidata items with coordinates + at least one
// Wikipedia article, worldwide; EMODnet heritage wrecks for European waters.
let cache = null;
let cacheAt = 0;
const CACHE_MS = 24 * 3600 * 1000;

const SPARQL = `
SELECT ?item ?itemLabel ?coord ?article WHERE {
  ?item wdt:P31/wdt:P279* wd:Q852190 .
  ?item wdt:P625 ?coord .
  ?article schema:about ?item .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 1200`;

export default async function handler(req, res) {
  try {
    if (cache && Date.now() - cacheAt < CACHE_MS) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.status(200).json(cache);
      return;
    }
    const wrecks = [];
    try {
      const r = await fetch(
        `https://query.wikidata.org/sparql?query=${encodeURIComponent(SPARQL)}&format=json`,
        { headers: { 'User-Agent': 'argus-eye/1.0 (personal research console)' }, signal: AbortSignal.timeout(25000) });
      if (r.ok) {
        const data = await r.json();
        for (const b of data?.results?.bindings ?? []) {
          const m = /Point\((-?[\d.]+) (-?[\d.]+)\)/.exec(b.coord?.value ?? '');
          if (!m) continue;
          wrecks.push({
            id: b.item.value.split('/').pop(),
            name: b.itemLabel?.value ?? 'Unknown wreck',
            lon: Number(m[1]), lat: Number(m[2]),
            link: b.article?.value ?? null,
            src: 'wikidata',
          });
        }
      }
    } catch { /* wikidata down — continue with what we have */ }

    cache = { wrecks, fetchedAt: new Date().toISOString() };
    cacheAt = Date.now();
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).json(cache);
  } catch (err) {
    res.status(502).json({ error: String(err?.message ?? err), wrecks: cache?.wrecks ?? [] });
  }
}
