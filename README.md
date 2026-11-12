# ARGUS EYE

A live, open-source situational-awareness globe for the browser. One page, one
camera, every layer of the planet you can pull from open data: air, sea, orbit,
ground, weather, news, and the streets themselves.

Built with Cesium on Vite + TypeScript. No build secrets required: every layer
runs on free, keyless open data out of the box, and optional capabilities are
unlocked in-app with your own API keys (POWER UP), stored only in your browser.

## Live

Deploy once and it stays live. The production link is in the repo's About
section after deploy (see [Deploy](#deploy)).

## The layer stack

- **Flights** — live global air traffic (adsb.lol, airplanes.live, OpenSky
  fallback), click any aircraft for airline/route enrichment.
- **Military** — tracked military/government aircraft with 24 h history traces.
- **Satellites** — full SGP4 propagation from CelesTrak TLEs, six classes
  (stations, Starlink, OneWeb, GNSS, weather, science), orbit rings, ground
  tracks, and pass prediction for your location.
- **ISS & crew** — the station, its track, and who is aboard.
- **Earthquakes** — USGS feed, magnitude-scaled, depth-ringed.
- **Vessels** — live AIS in covered waters (Digitraffic/Finland keyless;
  global AISstream with a free key).
- **Transit & rail** — GTFS-RT vehicles for supported agencies.
- **Traffic flow** — animated flow over the live road graph.
- **Fires** — NASA EONET active fire/detection events, plus WFIGS perimeters;
  FIRMS hotspots with a free NASA key.
- **Launches** — upcoming and past launches (Launch Library 2) with ascent
  replay.
- **Radio** — thousands of live stations (Radio Browser) with an analog tuner.
- **Bike share** — GBFS docks and availability worldwide.
- **Wind** — animated particle field from Open-Meteo gridded forecasts.
- **Weather** — radar/satellite mosaics, lightning, and active cyclones
  (nowCOAST WMS + NHC).
- **CCTV** — public traffic cameras (Austin, Finland, Tallinn, Hong Kong) with
  viewsheds; NEAREST jumps the camera to the closest feed.
- **Street level** — Panoramax/KartaView photo overlays (Mapillary and Google
  Street View with keys).
- **Surveillance map** — ALPR cameras and military installations from
  OpenStreetMap.
- **Special-use airspace & wildlife** — FAA SUA polygons, iNaturalist sightings,
  Acartia marine-mammal observations.
- **Infrastructure** — data centers, dams, submarine cables, shipwrecks.
- **News** — GDELT geolocated events, clustered on the globe, with a reading
  list in the dock.
- **Scenes** — scripted director tours (Orbital Watch, Ring of Fire).
- **Tools** — geocoding search, directions with fly-the-route, distance
  measurement, whiteboard drawing, shareable camera-state URLs.

## Sensor suite

Keys 1–5 switch the post-processing stack: NORMAL, CRT, NVG (night vision),
FLIR (thermal), NOIR. A sharpen pass keeps imagery crisp at every zoom.

## Voice

Say it or type it. "Show satellites", "fly to Tokyo", "military only",
"news on". The command grammar runs fully on-device (Web Speech API for
recognition, local intent parsing — no server, no key). See DATA_SOURCES.md
for why this replaces a hosted realtime-voice service.

## POWER UP (BYOK)

Open the key sheet (bottom-right). Every optional key is free to obtain and is
stored in `localStorage` in your browser only — nothing is proxied or logged:

| Key | Unlocks |
| --- | --- |
| Cesium ion | Google Photorealistic 3D tiles, ion assets |
| Google Maps | Street View overlay, Google geocoder |
| Mapillary | Mapillary street-level coverage |
| AISstream | Global live AIS websocket |
| NASA FIRMS | High-resolution fire hotspots |
| OpenSky | Authenticated flight fallback quota |

## Deploy

Zero-config on Vercel's free Hobby plan:

1. Import this repo at vercel.com/new.
2. That's it — `vercel.json` handles the build (`npm run build` → `dist`) and
   cache headers; the `/api/*` routes deploy as serverless functions within the
   Hobby limit.

Local dev: `npm install && npm run dev` (client on :4189, API proxied).

## Honesty notes

Everything in the feature list above is implemented and wired in this repo.
Where an original data feed or asset could not be reused on free terms, the
substitution is documented, source by source, in [DATA_SOURCES.md](DATA_SOURCES.md).

## License

MIT — see [LICENSE](LICENSE). Data remains under each provider's license;
see DATA_SOURCES.md for attribution.
