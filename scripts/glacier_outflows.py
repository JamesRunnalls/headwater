# -*- coding: utf-8 -*-
"""
Glacier outflow point computation
==================================
For each glacier in public/geodata/outputs/glaciers.geojson, uses the more
detailed SGI 2016 outline to find the point on the glacier boundary with the
lowest DEM elevation (the terminus / outflow).

Writes public/geodata/outputs/glacier_outflows.json:
    { "<sgi-id>": [lon, lat], ... }

Usage (conda rivers env):
    /Users/jamesrunnalls/miniforge3/envs/rivers/bin/python scripts/glacier_outflows.py
"""

import json
import logging
import os
import sys

import geopandas as gpd
import numpy as np
import rasterio
from shapely.geometry import shape

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLACIERS_PATH = os.path.join(ROOT, "public", "geodata", "outputs", "glaciers.geojson")
SGI_SHP_PATH = os.path.join(ROOT, "external", "inventory_sgi2016_r2020", "SGI_2016_glaciers.shp")
DEM_PATH = "/Users/jamesrunnalls/Documents/rivers/swiss_dem_wh84_rescale_u16_3.tif"
OUTPUT_PATH = os.path.join(ROOT, "public", "geodata", "outputs", "glacier_outflows.json")

# Approximate degrees per 30 m at Swiss latitudes
STEP_DEG = 0.0003


def densify_ring(ring):
    length = ring.length
    if length == 0:
        return list(ring.coords[:1])
    n = max(4, int(length / STEP_DEG))
    return [ring.interpolate(float(i) / n, normalized=True).coords[0] for i in range(n)]


def largest_polygon(geom):
    if geom.geom_type == "Polygon":
        return geom
    return max(geom.geoms, key=lambda p: p.area)


def main():
    if not os.path.exists(DEM_PATH):
        log.error("DEM not found: %s", DEM_PATH)
        sys.exit(1)

    # Load the set of SGI IDs we want to process (from our app's glacier list)
    with open(GLACIERS_PATH) as f:
        glaciers_geojson = json.load(f)

    target_ids = {}
    for feat in glaciers_geojson["features"]:
        sgi_id = feat["properties"].get("sgi-id")
        if sgi_id:
            target_ids[sgi_id] = shape(feat["geometry"])

    log.info("Target glaciers from glaciers.geojson: %d", len(target_ids))

    # Load SGI 2016 shapefile and reproject to WGS84
    log.info("Loading SGI 2016 shapefile...")
    sgi = gpd.read_file(SGI_SHP_PATH).to_crs("EPSG:4326")
    sgi_lookup = {row["sgi-id"]: row.geometry for _, row in sgi.iterrows() if row["sgi-id"]}
    log.info("SGI 2016 features loaded: %d", len(sgi_lookup))

    outflows = {}

    with rasterio.open(DEM_PATH) as dem:
        nodata = dem.nodata
        b = dem.bounds

        for sgi_id, fallback_geom in target_ids.items():
            # Use detailed SGI 2016 outline; fall back to glaciers.geojson geometry
            geom = sgi_lookup.get(sgi_id, fallback_geom)
            if geom is None:
                geom = fallback_geom

            poly = largest_polygon(geom)
            pts = densify_ring(poly.exterior)

            # Clip to DEM extent
            pts = [(lon, lat) for lon, lat in pts
                   if b.left <= lon <= b.right and b.bottom <= lat <= b.top]
            if not pts:
                log.warning("%s: no boundary points within DEM extent, using centroid", sgi_id)
                c = poly.centroid
                outflows[sgi_id] = [round(c.x, 6), round(c.y, 6)]
                continue

            elevations = np.array(list(dem.sample(pts, indexes=1)), dtype=float).ravel()

            if nodata is not None:
                elevations[elevations == nodata] = np.nan

            valid = ~np.isnan(elevations) & (elevations > 2137)
            if not valid.any():
                log.warning("%s: all elevations nodata or below 1000 m, using centroid", sgi_id)
                c = poly.centroid
                outflows[sgi_id] = [round(c.x, 6), round(c.y, 6)]
                continue

            elevations[~valid] = np.nan
            idx = int(np.nanargmin(elevations))
            lon, lat = pts[idx]
            outflows[sgi_id] = [round(lon, 6), round(lat, 6)]

            source = "SGI2016" if sgi_id in sgi_lookup else "fallback"
            log.debug("%s: outflow at [%.6f, %.6f] (%s)", sgi_id, lon, lat, source)

    log.info("Computed outflows for %d glaciers", len(outflows))

    with open(OUTPUT_PATH, "w") as f:
        json.dump(outflows, f, separators=(",", ":"))

    log.info("Written to %s", OUTPUT_PATH)


if __name__ == "__main__":
    main()
