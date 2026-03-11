"""
Glacier retreat SVG path pipeline
==================================
For each glacier in public/geodata/outputs/glaciers.geojson, finds its polygon
in the 5 Swiss Glacier Inventory (SGI) shapefiles (1850, 1931, 1973, 2010, 2016)
and writes a per-glacier JSON file to public/geodata/outputs/glaciers/{sgi-id}.json.

Each JSON file is an array of { "year": int, "path": "M x,y L x,y ... Z" } objects,
sorted by year, suitable for the GlacierMorph React component.

Usage:
    python scripts/glaciers.py          # run from project root
    python scripts/glaciers.py --dry-run  # print stats without writing files

Matching strategy:
    - 2016 and 2010/1973: direct ID match via SGI / sgi-id field
    - 1931 and 1850: spatial match (largest-intersection polygon, ≥5% of 2016 area)

SVG normalisation:
    All frames for one glacier share the same coordinate space (500×500, PAD=30 px).
    Y axis is flipped (SVG Y increases down; Swiss LV95 northing increases up).
    Simplification tolerance = 1% of max(bbox_width, bbox_height) in metres.
"""

import argparse
import json
import logging
import sys
from pathlib import Path

import geopandas as gpd
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.polygon import orient as shapely_orient
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

SVG_SIZE = 500
PAD = 30  # padding in SVG units

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
        # Assume Swiss LV95 if no CRS defined
        gdf = gdf.set_crs("EPSG:2056")
    elif gdf.crs.to_epsg() != 2056:
        gdf = gdf.to_crs("EPSG:2056")
    # Normalise the id field to lowercase with hyphen for easier access
    if id_field in gdf.columns:
        gdf["_sgi"] = gdf[id_field].astype(str).str.strip()
    else:
        log.warning("Field '%s' not found in %s — using empty IDs", id_field, path.name)
        gdf["_sgi"] = ""
    return gdf[["_sgi", "geometry"]].copy()


def largest_polygon(geom):
    """Return the largest Polygon from a geometry (handles MultiPolygon)."""
    if isinstance(geom, Polygon):
        return geom
    if isinstance(geom, MultiPolygon):
        return max(geom.geoms, key=lambda g: g.area)
    return geom


def find_spatial_match(ref_geom, inventory_gdf: gpd.GeoDataFrame):
    """
    Find the polygon in inventory_gdf with maximum intersection area with ref_geom.
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
        # Relax: just take the single best match if ≥1% overlap
        best_frac = fracs.max()
        if best_frac >= 0.01:
            qualifying = candidates[[fracs.idxmax()]]
        else:
            return None

    matched_geoms = qualifying.geometry.tolist()
    if len(matched_geoms) == 1:
        return matched_geoms[0]
    return unary_union(matched_geoms)


def ring_to_svg(coords, transform):
    """Convert a coordinate ring to an SVG subpath string (M ... L ... Z)."""
    # Drop closing duplicate
    if len(coords) > 1 and coords[0] == coords[-1]:
        coords = coords[:-1]
    parts = []
    for i, (x, y) in enumerate(coords):
        sx, sy = transform(x, y)
        parts.append(f"{'M' if i == 0 else 'L'} {sx:.1f},{sy:.1f}")
    parts.append("Z")
    return " ".join(parts)


def polygon_to_svg_path(poly: Polygon, minx, miny, maxx, maxy) -> str:
    """
    Convert a Shapely Polygon (including any interior rings / holes) to an
    SVG path string using the even-odd fill rule.  Holes are encoded as
    additional subpaths appended to the same `d` attribute; the SVG renderer
    punches them out when fillRule="evenodd" is set on the element.

    Y is flipped: geographic N (large y) maps to SVG top (small svg_y).
    """
    span_x = maxx - minx
    span_y = maxy - miny
    if span_x == 0:
        span_x = 1.0
    if span_y == 0:
        span_y = 1.0

    scale = SVG_SIZE - 2 * PAD

    def transform(x, y):
        svg_x = PAD + (x - minx) / span_x * scale
        svg_y = (SVG_SIZE - PAD) - (y - miny) / span_y * scale
        return svg_x, svg_y

    subpaths = [ring_to_svg(list(poly.exterior.coords), transform)]
    for interior in poly.interiors:
        subpaths.append(ring_to_svg(list(interior.coords), transform))

    return " ".join(subpaths)


def build_bounding_box(geometries):
    """Compute the union bounding box across a list of geometries."""
    minx = min(g.bounds[0] for g in geometries)
    miny = min(g.bounds[1] for g in geometries)
    maxx = max(g.bounds[2] for g in geometries)
    maxy = max(g.bounds[3] for g in geometries)
    return minx, miny, maxx, maxy


def prepare_frames(frames_raw):
    """Enforce CCW winding on all frames for consistent SVG fill direction."""
    return [(year, shapely_orient(geom, sign=1.0)) for year, geom in frames_raw]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(dry_run: bool = False):
    # Load the reference glacier list
    log.info("Loading reference glaciers from %s", GLACIERS_GEOJSON)
    ref = gpd.read_file(GLACIERS_GEOJSON)
    if ref.crs is None or ref.crs.to_epsg() != 2056:
        ref = ref.to_crs("EPSG:2056")

    log.info("%d reference glaciers to process", len(ref))

    # Load all inventory shapefiles upfront
    inv_data = {}  # year -> GeoDataFrame with _sgi + geometry
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
            log.debug("Row without sgi-id, skipping")
            stats["skipped_no_2016"] += 1
            continue

        # Find the 2016 reference geometry for this glacier (used for spatial matching)
        ref_2016_rows = inv_data.get(2016, (None, None))[0]
        if ref_2016_rows is None:
            log.error("2016 inventory not loaded")
            break
        inv_2016_gdf, _ = inv_data[2016]
        ref_2016_matches = inv_2016_gdf[inv_2016_gdf["_sgi"] == sgi_id]
        if ref_2016_matches.empty:
            log.debug("No 2016 geometry for %s", sgi_id)
            stats["skipped_no_2016"] += 1
            continue

        ref_2016_geom = unary_union(ref_2016_matches.geometry.tolist())

        # Collect frames across all inventories
        frames_raw = []  # list of (year, shapely geometry)

        for year, path, id_field, strategy in INVENTORIES:
            if year not in inv_data:
                continue
            inv_gdf, strat = inv_data[year]

            if strat == "direct":
                matches = inv_gdf[inv_gdf["_sgi"] == sgi_id]
                if matches.empty:
                    continue
                geom = unary_union(matches.geometry.tolist())
            else:  # spatial
                geom = find_spatial_match(ref_2016_geom, inv_gdf)
                if geom is None:
                    continue

            # Ensure we have a simple polygon (take largest part of MultiPolygon)
            geom = largest_polygon(geom)
            if geom is None or geom.is_empty:
                continue

            frames_raw.append((year, geom))

        # Sort by year ascending
        frames_raw.sort(key=lambda t: t[0])

        if len(frames_raw) < 2:
            log.debug("Skipping %s — only %d frame(s)", sgi_id, len(frames_raw))
            stats["skipped_too_few_frames"] += 1
            continue

        # Normalise winding direction and align start vertices between frames so
        # flubber interpolates with minimal rotation (key for consistent area decrease)
        frames_raw = prepare_frames(frames_raw)

        all_geoms = [g for _, g in frames_raw]
        minx, miny, maxx, maxy = build_bounding_box(all_geoms)

        # Convert to SVG paths with no simplification
        output_frames = []
        for year, geom in frames_raw:
            if geom is None or geom.is_empty:
                continue
            path_str = polygon_to_svg_path(geom, minx, miny, maxx, maxy)
            output_frames.append({"year": year, "path": path_str})

        if len(output_frames) < 2:
            stats["skipped_too_few_frames"] += 1
            continue

        if not dry_run:
            out_path = OUTPUT_DIR / f"{sgi_id}.json"
            with open(out_path, "w") as f:
                json.dump(output_frames, f, separators=(",", ":"))

        stats["written"] += 1
        log.debug("Wrote %s (%d frames)", sgi_id, len(output_frames))

    log.info(
        "Done — %d written, %d skipped (too few frames), %d skipped (no 2016 match)",
        stats["written"],
        stats["skipped_too_few_frames"],
        stats["skipped_no_2016"],
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate glacier morph SVG data")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Process without writing output files",
    )
    args = parser.parse_args()
    main(dry_run=args.dry_run)
