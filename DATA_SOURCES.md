# Data sources

Every source ARGUS EYE uses, what it costs, its license posture, and where the
request goes. Two kinds of calls exist:

- **Direct (D)** — browser → provider. No proxy.
- **Proxied (P)** — browser → `/api/*` serverless function → provider, used
  only where the provider has no CORS headers or needs format conversion
  (GTFS-RT protobuf, XML). No keys are stored server-side; BYOK keys travel
  from the browser with each request and are never logged.

## Live feeds

| Layer | Source | Route | Cost | License / terms |
| --- | --- | --- | --- | --- |
| Flights | adsb.lol REST, fallback airplanes.live, then OpenSky | P `/api/flights` | Free | Community ADS-B, open use |
| Flight enrichment | adsbdb (airline/route/aircraft) | P `/api/flight-info` | Free | Free API, attribution appreciated |
| Military + traces | adsb.lol military feed + re-api.adsb.lol 24 h trace | P `/api/military`, `/api/trace` | Free | Community ADS-B |
| Satellites (TLE) | CelesTrak GP data | P `/api/tle` | Free | Free for non-commercial use, attribution |
| Earthquakes | USGS GeoJSON feed | D | Free | Public domain (US Gov) |
| Fires | NASA EONET v3 events | D | Free | Open, attribution |
| Fire hotspots | NASA FIRMS | D with BYOK | Free key | Open with free key |
| Fire perimeters | NIFC WFIGS ArcGIS | D | Free | Public domain (US Gov) |
| Weather overlays | NOAA nowCOAST WMS (radar, satellite, lightning) | D | Free | Public domain (US Gov) |
| Cyclones | NHC ATCF/GIS feeds | P `/api/cyclones` | Free | Public domain (US Gov) |
| Wind field | Open-Meteo forecast API (grid) | D | Free | CC BY 4.0 |
| Vessels | Digitraffic AIS (Finland) | D | Free | CC BY 4.0 |
| Vessels (global) | AISstream websocket | D with BYOK | Free key | Free tier, attribution |
| Transit/rail | Agency GTFS-RT feeds (protobuf → JSON) | P `/api/gtfsrt` | Free | Per-agency open data terms |
| Launches | Launch Library 2 | D | Free | Free tier, attribution |
| Radio | Radio Browser directory + station streams | D | Free | Community DB, open |
| Bike share | GBFS feeds (gbfs.city index) | D | Free | Open per-operator |
| News | GDELT GEO 2.0 API | P `/api/news` | Free | Open, attribution |
| CCTV | Austin (COA), Fintraffic, Tallinn, HK Transport | P `/api/cctv` | Free | Open data portals |
| Street level | Panoramax, KartaView | D | Free | Open imagery |
| Shipwrecks | Wikidata SPARQL | P `/api/wrecks` | Free | CC0 |
| Special-use airspace | FAA ArcGIS open data | D | Free | Public domain (US Gov) |
| Wildlife | iNaturalist, Acartia | D | Free | CC-BY-NC / open research data |
| Directions | OSRM (FOSSGIS demo server) | P `/api/route` | Free | ODbL, demo-server fair use |

## Base map & terrain

| Asset | Source | Notes |
| --- | --- | --- |
| Imagery | Esri World Imagery (keyless REST endpoint) | Free for open-source use with attribution; OSM tiles are the automatic fallback |
| Terrain | Esri WorldElevation3D via Cesium | Keyless |
| 3D tiles | Google Photorealistic 3D via Cesium ion | BYOK (Cesium ion key) |
| Search (keyless) | Bundled Natural Earth places + Photon + Nominatim | Natural Earth is public domain; Photon/Nominatim are OSM, ODbL |

## Bundled data packs (built at deploy time)

| Pack | Source | License |
| --- | --- | --- |
| places.json | Natural Earth 110 m populated places | Public domain |
| datacenters.json, dams.json | OpenStreetMap via Overpass | ODbL — (c) OpenStreetMap contributors |
| cables.geojson | TeleGeography submarine cable map | Non-commercial use with attribution |

Build script: `scripts/build-data.mjs` (runs in `npm run build`, fails soft —
a missing pack means an empty layer, never a broken deploy).

## Substitutions and why

A few capabilities in comparable projects rely on paid or card-gated services.
ARGUS EYE ships free alternatives instead, and offers the paid-tier upgrade
only as optional BYOK:

1. **Voice** — uses the browser's Web Speech API plus a local command grammar.
   A hosted realtime-voice service would need a paid server-side key; this is
   keyless, private, and offline-capable for commands. Trade-off: free-form
   conversation is narrower than a hosted LLM voice agent.
2. **Fires** — EONET is the default (keyless); FIRMS is higher resolution but
   requires a free NASA key, so it is BYOK rather than mandatory.
3. **Vessels** — Digitraffic covers Finnish/European waters keyless; truly
   global AIS has no free keyless feed, so AISstream is BYOK.
4. **Wind** — rendered from Open-Meteo's gridded API instead of downloading
   and decoding raw NOAA GRIB2 files server-side. Same underlying GFS model,
   no decoder infrastructure.
5. **Street level** — Panoramax and KartaView are keyless open imagery, so no
   key is needed at all here.
6. **Imagery/terrain** — Esri's keyless endpoints instead of paid Cesium ion
   or Google tiles by default; ion/Google 3D remain BYOK upgrades.

No source in this project requires a paid plan or a card on file to deploy or
to use at the default tier.
