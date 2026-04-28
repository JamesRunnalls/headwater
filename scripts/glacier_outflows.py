# -*- coding: utf-8 -*-
"""
Glacier outflow point computation
==================================
For each glacier in public/geodata/outputs/glaciers.geojson, finds the point on
the glacier boundary with the lowest DEM elevation (the terminus / outflow).

Writes public/geodata/outputs/glacier_outflows.json:
    { "<sgi-id>": [lon, lat], ... }

Usage (conda rivers env):
    conda run -n rivers python scripts/glacier_outflows.py
"""

import json
import logging
import os
import sys

import numpy as np
import rasterio
from shapely.geometry import shape

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLACIERS_PATH = os.path.join(ROOT, "public", "geodata", "outputs", "glaciers.geojson")
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

    with open(GLACIERS_PATH) as f:
        glaciers = json.load(f)

    log.info("Loaded %d glacier features", len(glaciers["features"]))

    outflows = {}

    with rasterio.open(DEM_PATH) as dem:
        nodata = dem.nodata
        b = dem.bounds

        for feat in glaciers["features"]:
            sgi_id = feat["properties"].get("sgi-id")
            if not sgi_id:
                continue

            geom = shape(feat["geometry"])
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

            valid = ~np.isnan(elevations)
            if not valid.any():
                log.warning("%s: all elevations nodata, using centroid", sgi_id)
                c = poly.centroid
                outflows[sgi_id] = [round(c.x, 6), round(c.y, 6)]
                continue

            idx = int(np.nanargmin(elevations))
            lon, lat = pts[idx]
            outflows[sgi_id] = [round(lon, 6), round(lat, 6)]

    log.info("Computed outflows for %d glaciers", len(outflows))

    with open(OUTPUT_PATH, "w") as f:
        json.dump(outflows, f, separators=(",", ":"))

    log.info("Written to %s", OUTPUT_PATH)


if __name__ == "__main__":
    main()
