"""
Glacier retreat GeoJSON pipeline
==================================
For each glacier in public/geodata/outputs/glaciers.geojson, finds its polygon
in the 5 Swiss Glacier Inventory (SGI) shapefiles (1850, 1931, 1973, 2010, 2016)
and writes a per-glacier GeoJSON file to public/geodata/outputs/glaciers/{sgi-id}.geojson.

Each GeoJSON file is a FeatureCollection with one Feature per inventory year,
each Feature having a { "year": int } property and a WGS84 geometry.

Usage:
    python scripts/glaciers.py          # run from project root
    python scripts/glaciers.py --dry-run  # print stats without writing files

Matching strategy:
    - 2016 and 2010/1973: direct ID match via SGI / sgi-id field
    - 1931 and 1850: spatial match (largest-intersection polygon, ≥5% of 2016 area)
"""

import argparse
import json
import logging
import sys
from pathlib import Path

import geopandas as gpd
from shapely.geometry import mapping
from shapely.ops import unary_union

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths (relative to project root)
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent

INVENTORIES = [
    # (year, shapefile_path, id_field, match_strategy)
    (
        1850,
        ROOT / "external/glaciers/inventory_sgi1850_r1992/SGI_1850.shp",
        "SGI",
        "spatial",
    ),
    (
        1931,
        ROOT / "external/glaciers/inventory_sgi1931_r2022/SGI_1931.shp",
        "SGI",
        "spatial",
    ),
    (
        1973,
        ROOT / "external/glaciers/inventory_sgi1973_r1976/SGI_1973.shp",
        "SGI",
        "direct",
    ),
    (
        2010,
        ROOT / "external/glaciers/inventory_sgi2010_r2010/SGI_2010.shp",
        "SGI",
        "direct",
    ),
    (
        2016,
        ROOT / "external/glaciers/inventory_sgi2016_r2020/SGI_2016_glaciers.shp",
        "sgi-id",
        "direct",
    ),
]

GLACIERS_GEOJSON = ROOT / "public/geodata/outputs/glaciers.geojson"
OUTPUT_DIR = ROOT / "public/geodata/outputs/glaciers"

# Minimum spatial overlap fraction for spatial matching (5% of 2016 glacier area)
MIN_OVERLAP_FRAC = 0.05

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def load_inventory(path: Path, id_field: str) -> gpd.GeoDataFrame:
    """Load a shapefile, ensure it is in EPSG:2056, return only geometry + ID field."""
    log.info("Loading %s", path.name)
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:2056")
    elif gdf.crs.to_epsg() != 2056:
        gdf = gdf.to_crs("EPSG:2056")
    if id_field in gdf.columns:
        gdf["_sgi"] = gdf[id_field].astype(str).str.strip()
    else:
        log.warning("Field '%s' not found in %s — using empty IDs", id_field, path.name)
        gdf["_sgi"] = ""
    return gdf[["_sgi", "geometry"]].copy()


def find_spatial_match(ref_geom, inventory_gdf: gpd.GeoDataFrame):
    """
    Find the polygon(s) in inventory_gdf with maximum intersection area with ref_geom.
    Returns the matched geometry (union of all polygons if multiple qualify) or None.
    """
    ref_area = ref_geom.area
    if ref_area == 0:
        return None

    candidates = inventory_gdf[inventory_gdf.geometry.intersects(ref_geom)]
    if candidates.empty:
        return None

    intersections = candidates.geometry.intersection(ref_geom)
    fracs = intersections.area / ref_area

    qualifying = candidates[fracs >= MIN_OVERLAP_FRAC]
    if qualifying.empty:
        best_frac = fracs.max()
        if best_frac >= 0.01:
            qualifying = candidates[[fracs.idxmax()]]
        else:
            return None

    matched_geoms = qualifying.geometry.tolist()
    if len(matched_geoms) == 1:
        return matched_geoms[0]
    return unary_union(matched_geoms)


def geom_to_wgs84(geom, project_fn):
    """Reproject a shapely geometry using a callable that transforms coordinates."""
    import shapely.ops
    return shapely.ops.transform(project_fn, geom)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(dry_run: bool = False):
    from pyproj import Transformer

    # Transformer from EPSG:2056 → EPSG:4326
    transformer = Transformer.from_crs("EPSG:2056", "EPSG:4326", always_xy=True)

    log.info("Loading reference glaciers from %s", GLACIERS_GEOJSON)
    ref = gpd.read_file(GLACIERS_GEOJSON)
    if ref.crs is None or ref.crs.to_epsg() != 2056:
        ref = ref.to_crs("EPSG:2056")

    log.info("%d reference glaciers to process", len(ref))

    inv_data = {}
    for year, path, id_field, strategy in INVENTORIES:
        if not path.exists():
            log.warning("Shapefile not found, skipping %d: %s", year, path)
            continue
        inv_data[year] = (load_inventory(path, id_field), strategy)

    if not dry_run:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    stats = {"written": 0, "skipped_too_few_frames": 0, "skipped_no_2016": 0}

    for _, row in ref.iterrows():
        sgi_id = row.get("sgi-id") or row.get("sgi_id") or ""
        sgi_id = str(sgi_id).strip()
        if not sgi_id:
            stats["skipped_no_2016"] += 1
            continue

        inv_2016_gdf, _ = inv_data.get(2016, (None, None))
        if inv_2016_gdf is None:
            log.error("2016 inventory not loaded")
            break
        ref_2016_matches = inv_2016_gdf[inv_2016_gdf["_sgi"] == sgi_id]
        if ref_2016_matches.empty:
            stats["skipped_no_2016"] += 1
            continue

        ref_2016_geom = unary_union(ref_2016_matches.geometry.tolist())

        frames_raw = []  # list of (year, shapely geometry in EPSG:2056)

        for year, path, id_field, strategy in INVENTORIES:
            if year not in inv_data:
                continue
            inv_gdf, strat = inv_data[year]

            if strat == "direct":
                matches = inv_gdf[inv_gdf["_sgi"] == sgi_id]
                if matches.empty:
                    continue
                geom = unary_union(matches.geometry.tolist())
            else:
                geom = find_spatial_match(ref_2016_geom, inv_gdf)
                if geom is None:
                    continue

            if geom is None or geom.is_empty:
                continue

            frames_raw.append((year, geom))

        frames_raw.sort(key=lambda t: t[0])

        if len(frames_raw) < 2:
            stats["skipped_too_few_frames"] += 1
            continue

        # Convert to WGS84 and build GeoJSON features
        features = []
        for year, geom in frames_raw:
            geom_4326 = geom_to_wgs84(geom, transformer.transform)
            features.append({
                "type": "Feature",
                "geometry": mapping(geom_4326),
                "properties": {"year": year},
            })

        feature_collection = {"type": "FeatureCollection", "features": features}

        if not dry_run:
            out_path = OUTPUT_DIR / f"{sgi_id}.geojson"
            with open(out_path, "w") as f:
                json.dump(feature_collection, f, separators=(",", ":"))

        stats["written"] += 1
        log.debug("Wrote %s (%d frames)", sgi_id, len(features))

    log.info(
        "Done — %d written, %d skipped (too few frames), %d skipped (no 2016 match)",
        stats["written"],
        stats["skipped_too_few_frames"],
        stats["skipped_no_2016"],
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate per-glacier GeoJSON data")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Process without writing output files",
    )
    args = parser.parse_args()
    main(dry_run=args.dry_run)
