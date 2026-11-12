// /api/gtfsrt?feed=ID — keyless GTFS-Realtime vehicle positions, decoded
// server-side to plain JSON. Feed registry mirrors public operator feeds.
import gtfsBindings from 'gtfs-realtime-bindings';
const { transit_realtime } = gtfsBindings;

const FEEDS = {
  // transit
  mbta: 'https://cdn.mbta.com/realtime/VehiclePositions.pb',
  helsinki: 'https://realtime.hsl.fi/gtfsrt',
  queensland: 'https://gtfsrt.api.translink.com.au/Feed/SEQ',
  rio: 'https://dados.mobilidade.rio/gps/sppo',
  rioBrt: 'https://dados.mobilidade.rio/gps/brt',
  prague: 'https://mpoidata.cz/gtfsrt/VehiclePositions.pb',
  // rail
  septaRail: 'https://www3.septa.org/gtfsrt/septa-pa-us/Vehicle/rtus.txt',
  metra: 'https://gtfsapi.metrarail.com/gtfs/positions',
  adelaideMetro: 'https://gtfs.adelaidemetro.com.au/v1/realtime/vehicle_positions',
  irelandRail: null, // REST JSON, handled specially below
  vr: null,          // Fintraffic JSON, handled specially below
};

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const feed = url.searchParams.get('feed') ?? '';

  try {
    if (feed === 'vr') {
      const r = await fetch('https://rata.digitraffic.fi/api/v1/train-locations/latest', { signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(String(r.status));
      const rows = await r.json();
      const vehicles = (Array.isArray(rows) ? rows : []).filter((t) => t.location?.coordinates).map((t) => ({
        id: `vr-${t.trainNumber}`,
        label: `VR ${t.trainType ?? ''}${t.trainNumber}`,
        lat: t.location.coordinates[1], lon: t.location.coordinates[0],
        heading: t.heading ?? null, speed: t.speed != null ? t.speed / 3.6 : null,
        route: `${t.trainType} ${t.trainNumber}`, mode: 'rail',
      }));
      res.setHeader('Cache-Control', 'public, max-age=15');
      res.status(200).json({ feed, vehicles });
      return;
    }

    const target = FEEDS[feed];
    if (!target) { res.status(400).json({ error: `unknown feed '${feed}'`, feeds: Object.keys(FEEDS).concat(['vr']) }); return; }
    const r = await fetch(target, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    let msg;
    try {
      msg = transit_realtime.FeedMessage.decode(new Uint8Array(buf));
    } catch {
      res.status(200).json({ feed, vehicles: [] });
      return;
    }
    const vehicles = [];
    for (const ent of msg.entity ?? []) {
      const v = ent.vehicle;
      const pos = v?.position;
      if (!v || !pos || pos.latitude == null || pos.longitude == null) continue;
      vehicles.push({
        id: v.vehicle?.id ?? ent.id,
        label: v.vehicle?.label ?? v.trip?.routeId ?? ent.id,
        lat: pos.latitude, lon: pos.longitude,
        heading: pos.bearing ?? null,
        speed: pos.speed ?? null,
        route: v.trip?.routeId ?? '',
        mode: 'transit',
      });
      if (vehicles.length >= 3000) break;
    }
    res.setHeader('Cache-Control', 'public, max-age=15');
    res.status(200).json({ feed, vehicles });
  } catch (err) {
    res.status(502).json({ error: String(err?.message ?? err), vehicles: [] });
  }
}
