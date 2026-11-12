// /api/flight-info?hex= — enrichment: type/registration (adsbdb) + photo
// (planespotters) + route by callsign when known.
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const hex = (url.searchParams.get('hex') ?? '').replace(/[^0-9a-fA-F]/g, '');
  const callsign = (url.searchParams.get('callsign') ?? '').replace(/[^0-9A-Za-z]/g, '');
  if (!hex && !callsign) { res.status(400).json({ error: 'hex or callsign required' }); return; }

  const out = {};
  if (hex) {
    try {
      const r = await fetch(`https://api.adsbdb.com/v0/aircraft/${hex}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const data = await r.json();
        const a = data?.response?.aircraft;
        if (a) {
          out.type = a.type ?? a.icao_type;
          out.registration = a.registration;
          out.airline = a.airline?.name ?? a.registered_owner;
        }
      }
    } catch { /* optional */ }
    try {
      const r = await fetch(`https://api.planespotters.net/pub/photos/hex/${hex}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const data = await r.json();
        const photo = data?.photos?.[0];
        if (photo?.thumbnail_large?.src) {
          out.photo = photo.thumbnail_large.src;
          out.photoCredit = photo.photographer;
          out.photoLink = photo.link;
        }
      }
    } catch { /* optional */ }
  }
  if (callsign) {
    try {
      const r = await fetch(`https://api.adsbdb.com/v0/callsign/${callsign}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const data = await r.json();
        const fr = data?.response?.flightroute;
        if (fr) {
          out.origin = fr.origin?.iata ?? fr.origin?.icao;
          out.originName = fr.origin?.name;
          out.destination = fr.destination?.iata ?? fr.destination?.icao;
          out.destinationName = fr.destination?.name;
          out.airline = out.airline ?? fr.airline?.name;
        }
      }
    } catch { /* optional */ }
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json(out);
}
