# hydro-cron

Cloudflare Worker that fetches live sensor data from BAFU and Datalakes every 30 minutes and writes the results to R2.

## What it does

**BAFU** (`src/bafu.js`) — fetches 4 Swiss Federal Office for the Environment APIs in parallel:
- Discharge & water level (`hydro_sensor_pq.geojson`)
- Temperature (`hydro_sensor_temperature.geojson`)
- Oxygen (`hydro_sensor_o2.geojson`)
- Turbidity (`hydro_sensor_murk.geojson`)

Merges all parameters by station (joined on the `key` field), converts coordinates from Swiss LV95 to WGS84, attaches a `river_id` and `lake_key` from the bundled `station_map.json`, and writes `hydro/stations.geojson` to the `rivers` R2 bucket.

**Datalakes** (`src/datalakes.js`) — fetches lake monitoring data from EAWAG Datalakes for each station defined in `src/datalakes.json`. Supports two parameter types:
- **Y-axis** (`/data/{id}/{axis}`): surface/atmospheric measurements returned as a single most-recent value
- **Z-axis** (`/files/recent/{id}` → `/files/{id}?get=raw`): depth profiles — sliced to the most recent time step, with values extracted at configured depths or at the depth of the maximum value (`max_depth: true`)

Writes `hydro/datalakes.json` to the `rivers` R2 bucket.

## One-time setup: generate station→river mapping

The Worker bundles a static mapping of BAFU station keys to river IDs (`src/station_map.json`). Generate it by running the snap script from the project root:

```bash
conda run -n rivers python scripts/snap_hydro_stations.py
```

This fetches the BAFU APIs, snaps each station to the nearest river in `rivers.geojson`, and writes `worker/src/station_map.json`. Re-run whenever `rivers.geojson` changes, then redeploy.

## Setup

```bash
npm install
```

Log in to Cloudflare (first time only):

```bash
npx wrangler login
```

## Run locally

```bash
npm run dev
```

This starts a local server at `http://localhost:8787` with the `--test-scheduled` flag enabled. To manually trigger the cron handler:

```bash
curl "http://localhost:8787/__scheduled?cron=*%2F30+*+*+*+*"
```

Note: local dev uses a simulated R2 — files won't be written to the real bucket.

To inspect the output after triggering:

```bash
# BAFU stations
curl http://localhost:8787/

# Datalakes stations
curl http://localhost:8787/datalakes
```

## Deploy to Cloudflare

```bash
npm run deploy
```

After deploying, you can trigger it immediately without waiting 30 minutes:
- Cloudflare Dashboard → Workers & Pages → `hydro-cron` → Triggers tab → **Test scheduled**

Then verify the output:
- `https://assets.headwater.ch/hydro/stations.geojson`
- `https://assets.headwater.ch/hydro/datalakes.json`

## View live logs

```bash
npm run tail
```
