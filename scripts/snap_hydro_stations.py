"""Snap BAFU hydro stations to the river network or lakes and write a key→id mapping.

River stations (kind="river") are snapped to the nearest river segment.
Lake stations (kind="lake") are matched to the lake polygon they fall within,
with a fallback to the nearest lake polygon centroid.

Reads:
  - public/geodata/outputs/rivers.geojson — processed river network (WGS84)
  - public/geodata/outputs/lakes.geojson  — lake polygons (WGS84)
  - 4 BAFU GeoJSON APIs (fetched at runtime)

Outputs:
  - worker/src/station_map.json — {key: {river_id, river_name, lake_key}} for each station

Re-run whenever rivers.geojson or lakes.geojson changes, then redeploy the Worker.

Run from the project root:
  conda run -n rivers python scripts/snap_hydro_stations.py
"""

import json
import logging
import urllib.request
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Point, shape
from shapely import STRtree

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

ROOT = Path(__file__).parent.parent
RIVERS_PATH = ROOT / "public/geodata/outputs/rivers.geojson"
LAKES_PATH = ROOT / "public/geodata/outputs/lakes.geojson"
OUT_PATH = ROOT / "worker/src/station_map.json"

SNAP_THRESHOLD_M = 150

EXCLUDED_RIVER_STATION_IDS = {"2499"}

APIS = [
    "https://www.hydrodaten.admin.ch/web-hydro-maps/hydro_sensor_pq.geojson",
    "https://www.hydrodaten.admin.ch/web-hydro-maps/hydro_sensor_temperature.geojson",
    "https://www.hydrodaten.admin.ch/web-hydro-maps/hydro_sensor_o2.geojson",
    "https://www.hydrodaten.admin.ch/web-hydro-maps/hydro_sensor_murk.geojson",
]

transformer = Transformer.from_crs("EPSG:2056", "EPSG:4326", always_xy=True)


def fetch_json(url):
    logger.info(f"Fetching {url}")
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read())


def load_river_index():
    """Load rivers.geojson and build a spatial index for snapping."""
    logger.info("Loading river network...")
    with open(RIVERS_PATH) as f:
        rivers_fc = json.load(f)

    geoms, names, ids = [], [], []
    for feat in rivers_fc["features"]:
        geom = shape(feat["geometry"])
        name = feat["properties"].get("name", "")
        primary_name = name.split(" |")[0].strip() if name else None
        geoms.append(geom)
        names.append(primary_name)
        ids.append(feat["properties"].get("id"))

    tree = STRtree(geoms)
    logger.info(f"  {len(geoms)} river segments indexed")
    return tree, geoms, names, ids


def load_lake_index():
    """Load lakes.geojson and build a spatial index for point-in-polygon matching."""
    logger.info("Loading lakes...")
    with open(LAKES_PATH) as f:
        lakes_fc = json.load(f)

    geoms, keys, names = [], [], []
    for feat in lakes_fc["features"]:
        geoms.append(shape(feat["geometry"]))
        keys.append(feat["properties"].get("key"))
        names.append(feat["properties"].get("name"))

    tree = STRtree(geoms)
    logger.info(f"  {len(geoms)} lakes indexed")
    return tree, geoms, keys, names


def meters_to_degrees(metres):
    """Rough conversion of metres to degrees at Swiss latitudes (~47°N)."""
    return metres / 111_000


def snap_to_lake(pt, tree, geoms, keys, names, max_distance_m=100):
    """Match a point to a lake. Returns (lake_key, lake_name) or (None, None)."""
    # First try point-in-polygon
    candidates = tree.query(pt, predicate="contains")
    if len(candidates) > 0:
        idx = candidates[0]
        return keys[idx], names[idx]
    # Fall back to nearest polygon within max_distance_m
    idx = tree.nearest(pt)
    nearest_geom = geoms[idx]
    distance_deg = pt.distance(nearest_geom)
    distance_m = distance_deg * 111_000
    if distance_m <= max_distance_m:
        return keys[idx], names[idx]
    return None, None


def main():
    river_tree, river_geoms, river_names, river_ids = load_river_index()
    lake_tree, lake_geoms, lake_keys, lake_names = load_lake_index()
    threshold_deg = meters_to_degrees(SNAP_THRESHOLD_M)

    # Collect unique stations from all 4 APIs, keeping kind where available
    stations = {}  # key → (lv95_e, lv95_n, label, kind)
    for url in APIS:
        fc = fetch_json(url)
        for feat in fc["features"]:
            key = str(feat["properties"]["key"])
            if key not in stations:
                e, n = feat["geometry"]["coordinates"]
                stations[key] = (
                    e, n,
                    feat["properties"].get("label", key),
                    feat["properties"].get("kind", "river"),
                )

    total = len(stations)
    river_stations = sum(1 for _, _, _, kind in stations.values() if kind == "river")
    lake_stations = total - river_stations
    logger.info(f"Total unique stations: {total} ({river_stations} river, {lake_stations} lake)")

    mapping = {}
    unmatched = []

    for key, (e, n, label, kind) in stations.items():
        lon, lat = transformer.transform(e, n)
        pt = Point(lon, lat)

        if kind == "lake":
            lake_key, lake_name = snap_to_lake(pt, lake_tree, lake_geoms, lake_keys, lake_names)
            mapping[key] = {"river_id": None, "river_name": None, "lake_key": lake_key}
            logger.debug(f"  Lake station {key} ({label}) → {lake_name}")
        elif key in EXCLUDED_RIVER_STATION_IDS:
            mapping[key] = {"river_id": None, "river_name": None, "lake_key": None}
            logger.info(f"  River station {key} ({label}) excluded")
        else:
            idx = river_tree.nearest(pt)
            dist = pt.distance(river_geoms[idx])
            if dist <= threshold_deg:
                mapping[key] = {"river_id": river_ids[idx], "river_name": river_names[idx], "lake_key": None}
            else:
                mapping[key] = {"river_id": None, "river_name": None, "lake_key": None}
                unmatched.append((key, label, lon, lat, dist * 111_000))

    snapped_rivers = sum(1 for v in mapping.values() if v["river_id"] is not None)
    snapped_lakes = sum(1 for v in mapping.values() if v["lake_key"] is not None)
    logger.info(f"Matched: {snapped_rivers} river stations, {snapped_lakes} lake stations")

    if unmatched:
        logger.warning(f"{len(unmatched)} river stations not matched (nearest river > {SNAP_THRESHOLD_M}m):")
        for key, label, lon, lat, dist_m in sorted(unmatched, key=lambda x: x[4]):
            logger.warning(f"  key={key}  {label}  [{lat:.5f}, {lon:.5f}]  (nearest river: {dist_m:.0f}m)")

    with open(OUT_PATH, "w") as f:
        json.dump(mapping, f, ensure_ascii=False, separators=(",", ":"))

    logger.info(f"Written to {OUT_PATH}")


if __name__ == "__main__":
    main()
