// /api/cctv?src=ID — normalized public-camera catalogs. Each adapter returns
// [{ id, name, lat, lon, image?, video?, link? }] from an official city/DOT feed.
const ADAPTERS = {
  austin: async () => {
    const r = await fetch('https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=5000', { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(String(r.status));
    const rows = await r.json();
    return rows.filter((x) => x.location?.latitude).map((x, i) => ({
      id: x.camera_id ?? String(i),
      name: x.location_name ?? 'Austin camera',
      lat: Number(x.location.latitude), lon: Number(x.location.longitude),
      image: x.camera_url ?? null,
      link: 'https://data.austintexas.gov/d/b4k4-adkb',
    }));
  },
  fintraffic: async () => {
    const r = await fetch('https://tie.digitraffic.fi/api/weathercam/v1/stations/data', { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    const cams = [];
    for (const st of data.features ?? []) {
      const [lon, lat] = st.geometry?.coordinates ?? [];
      if (lon == null) continue;
      for (const preset of st.properties?.presets ?? []) {
        if (!preset.imageUrl) continue;
        cams.push({
          id: preset.id, name: `${st.properties?.name ?? 'Fintraffic'} ${preset.presentationName ?? ''}`.trim(),
          lat, lon, image: preset.imageUrl, link: 'https://tie.digitraffic.fi',
        });
      }
    }
    return cams.slice(0, 1600);
  },
  tallinn: async () => {
    const r = await fetch('https://www.ristmikud.tallinn.ee/api/cameras', { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(String(r.status));
    const rows = await r.json();
    const list = Array.isArray(rows) ? rows : rows.cameras ?? [];
    return list.filter((c) => c.lat && c.lng).map((c) => ({
      id: String(c.id ?? c.name), name: c.name ?? 'Tallinn intersection',
      lat: Number(c.lat), lon: Number(c.lng),
      image: c.image ?? (c.id != null ? `https://www.ristmikud.tallinn.ee/api/cameras/${c.id}/image` : null),
      link: 'https://www.ristmikud.tallinn.ee',
    }));
  },
  hongkong: async () => {
    const c = await fetch('https://resource.data.one.gov.hk/td/traffic-snapshot-camera-images.json', { signal: AbortSignal.timeout(12000) });
    if (!c.ok) throw new Error(String(c.status));
    const rows = await c.json();
    const list = Array.isArray(rows) ? rows : rows.features ?? [];
    return list.map((x) => ({
      id: String(x.key ?? x.id ?? x.name), name: x.description ?? x.name ?? 'Hong Kong traffic camera',
      lat: Number(x.latitude ?? x.lat), lon: Number(x.longitude ?? x.lon),
      image: x.url ?? x.image ?? null, link: 'https://data.gov.hk',
    })).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
  },
};

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const src = url.searchParams.get('src') ?? '';
  const adapter = ADAPTERS[src];
  if (!adapter) {
    res.status(400).json({ error: `unknown source '${src}'`, available: Object.keys(ADAPTERS) });
    return;
  }
  try {
    const cameras = await adapter();
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.status(200).json({ src, cameras });
  } catch (err) {
    res.status(502).json({ error: String(err?.message ?? err), cameras: [] });
  }
}
