# Headwater

An interactive web map for exploring Switzerland's hydrological network — rivers, lakes, glaciers, dams, hydropower stations, and live monitoring data from BAFU gauging stations.

**Live site:** [headwater.ch](https://headwater.ch)

---

## Features

- **River network** — visualize rivers colored by elevation and scaled by discharge
- **Lakes** — polygon overlays with bathymetry heatmaps for 19 Swiss lakes
- **Glaciers** — outlines and historical retreat timelines from 1850 to 2016 (SGI)
- **Infrastructure** — dams and hydropower stations with capacity and construction data
- **Live hydro data** — real-time discharge, water level, temperature, oxygen, and turbidity from BAFU stations, updated every 30 minutes
- **Elevation profiles** — interactive D3 charts for individual rivers
- **Multi-language** — English, German, French, and Italian

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, react-map-gl, MapLibre GL, deck.gl, D3 |
| Data processing | Python 3.11, geopandas, networkx, shapely |
| Edge compute | Cloudflare Workers (live hydro cron) |
| Storage | Cloudflare R2 (geodata assets) |

---

## Data Sources

| Dataset | Provider |
|---|---|
| River network | swissTLM3D (swisstopo) |
| Dams | Federal dam supervision database (BAFU) |
| Hydropower stations | Swiss hydropower statistics |
| Glacier history | Swiss Glacier Inventory (SGI) 1850–2016 |
| Glacier metadata | GLAMOS |
| Live hydro readings | BAFU Hydrodaten API |
| Lake bathymetry | SwissTopo |

---

## Getting Started

### Frontend

```bash
npm install
npm start
```

Runs at `http://localhost:3000`.

### Data processing (Python)

```bash
conda env create -f environment.yml
conda activate rivers

python scripts/network.py            # River network → public/geodata/outputs/rivers.geojson
python scripts/infrastructure.py     # Dams & power stations → infrastructure.geojson
python scripts/glaciers.py           # Glacier timelines → glaciers.geojson
python scripts/snap_hydro_stations.py  # Snap BAFU stations → worker/src/station_map.json
python scripts/fetch_glacier_info.py   # Glacier descriptions & images
```

External source data (shapefiles, GeoPackages) goes in `external/` — not versioned.

### Cloudflare Worker (live data)

```bash
cd worker
npm install
npm run dev    # local test at http://localhost:8787
npm run deploy # deploy to Cloudflare (runs every 30 min)
```

The worker merges four BAFU API endpoints and writes `hydro/stations.geojson` to R2.

### Production build

```bash
npm run build
# Upload ./build to CDN / S3
```

---

## Configuration

**`src/config.json`** — asset bucket URL, basemap tile version, and list of lakes with bathymetry.

**`worker/wrangler.toml`** — Cloudflare Worker name, R2 bucket binding, and cron schedule (`*/30 * * * *`).

**`.env`** — sets `GENERATE_SOURCEMAP=false` for production builds.

---

## To Do (Before Deployment)


- [ ] Extend bathymetry coverage beyond the current 19 lakes (waiting on data from AtlasOfSwitzerland)
- [ ] Add lake stations from Datalakes
- [ ] Order a consistent icon set from fiverr
- [ ] Get a full pixel render of the basemap from a Blender farm

- [ ] Deploy site to headwater.ch
 