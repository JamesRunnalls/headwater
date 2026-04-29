# hydro-cron

Cloudflare Worker that fetches live hydro and glacier data on a schedule and writes the results to R2.

## What it does

### Every 30 minutes

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

### Daily at 07:00 UTC

**Mass balance** (`src/massbalance.js`) — fetches the ETH Zürich real-time Swiss glacier mass balance file. Parses each glacier record into:
- `sgi_id` — SGI glacier identifier
- `mass_balance_sigma` — mass balance anomaly in standard deviations
- `classification` — integer 1–5 (1 = strongly below average, 5 = strongly above average)
- `mass_balance_mwe` — mass balance in metres water equivalent
- `has_data` / `monitored` — boolean availability flags
- `name` — glacier name

Also includes top-level metadata: `state_date`, `evaluated_at`, and `reference_period`.

Writes `glaciers/massbalance.json` to the `rivers` R2 bucket.

**Runoff** (`src/runoff.js`) — fetches the ETH Zürich real-time Swiss glacier runoff file (same source, companion dataset). Parses each glacier record into:
- `sgi_id` — SGI glacier identifier
- `runoff_today` — current runoff in m³/s
- `pct_last_month` / `pct_last_2wk` / `pct_last_5d` — percentage change over past periods
- `pct_next_5d` — forecasted percentage change over next 5 days
- `has_data` / `monitored` — boolean availability flags
- `name` — glacier name

Also includes top-level metadata: `state_date`, `evaluated_at`, and `reference_period`.

Writes `glaciers/runoff.json` to the `rivers` R2 bucket.

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

This starts a local server at `http://localhost:8787` with the `--test-scheduled` flag enabled. To manually trigger the cron handlers:

```bash
# Hydro (BAFU + Datalakes) — runs every 30 minutes
curl "http://localhost:8787/__scheduled?cron=*%2F30+*+*+*+*"

# Mass balance + Runoff — runs daily at 07:00 UTC
curl "http://localhost:8787/__scheduled?cron=0+7+*+*+*"
```

Note: local dev uses a simulated R2 — files won't be written to the real bucket.

To inspect the output after triggering:

```bash
# BAFU stations
curl http://localhost:8787/

# Datalakes stations
curl http://localhost:8787/datalakes

# Glacier mass balance
curl http://localhost:8787/massbalance

# Glacier runoff
curl http://localhost:8787/runoff
```

## Deploy to Cloudflare

```bash
npm run deploy
```

After deploying, you can trigger either cron immediately without waiting for the next scheduled run:

```bash
# Hydro (BAFU + Datalakes) — runs every 30 minutes
curl -X POST https://hydro-cron.<your-subdomain>.workers.dev/trigger/hydro

# Mass balance + Runoff — runs daily at 07:00 UTC
curl -X POST https://hydro-cron.<your-subdomain>.workers.dev/trigger/glaciers
```

Then verify the output:
- `https://assets.headwater.ch/hydro/stations.geojson`
- `https://assets.headwater.ch/hydro/datalakes.json`
- `https://assets.headwater.ch/glaciers/massbalance.json`
- `https://assets.headwater.ch/glaciers/runoff.json`

## View live logs

```bash
npm run tail
```
