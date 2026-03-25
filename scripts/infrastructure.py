"""Extract dams and hydropower stations and snap them to the river network.

Reads:
  - external/stauanlagen-bundesaufsicht_2056.gpkg   — Swiss federal supervision dams
  - external/statistik-wasserkraftanlagen_2056.gpkg — Swiss hydropower plant statistics
  - public/geodata/outputs/rivers.geojson            — processed river network (WGS84)

Outputs:
  - public/geodata/outputs/dams.geojson          — dam points with river_name (WGS84)
  - public/geodata/outputs/power_stations.geojson — power station points with river_name (WGS84)

Run from the project root:
  conda run -n rivers python scripts/infrastructure.py
"""

import json
import logging
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point, shape
from shapely import STRtree

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

ROOT = Path(__file__).parent.parent
DAM_PATH = ROOT / "external/stauanlagen-bundesaufsicht_2056.gpkg"
POWER_PATH = ROOT / "external/statistik-wasserkraftanlagen_2056.gpkg"
RIVERS_PATH = ROOT / "public/geodata/outputs/rivers.geojson"
DAMS_OUT = ROOT / "public/geodata/outputs/dams.geojson"
POWER_OUT = ROOT / "public/geodata/outputs/power_stations.geojson"

TARGET_CRS = "EPSG:4326"
SNAP_THRESHOLD_M = 200  # metres — max distance to nearest river before river_name=null


def load_river_index():
    """Load rivers.geojson and build a spatial index for snapping."""
    logger.info("Loading river network...")
    with open(RIVERS_PATH) as f:
        rivers_fc = json.load(f)

    geoms = []
    names = []
    for feat in rivers_fc["features"]:
        geom = shape(feat["geometry"])
        name = feat["properties"].get("name", "")
        # Take the first name before any pipe separator
        primary_name = name.split(" |")[0].strip() if name else None
        geoms.append(geom)
        names.append(primary_name)

    tree = STRtree(geoms)
    logger.info(f"  {len(geoms)} river segments indexed")
    return tree, geoms, names


def snap_to_river(points_wgs84, tree, geoms, names, threshold_deg):
    """For each point find the nearest river name within threshold (in degrees)."""
    river_names = []
    for pt in points_wgs84:
        idx = tree.nearest(pt)
        dist = pt.distance(geoms[idx])
        if dist <= threshold_deg:
            river_names.append(names[idx])
        else:
            river_names.append(None)
    return river_names


def meters_to_degrees(metres):
    """Rough conversion of metres to degrees at Swiss latitudes (~47°N)."""
    return metres / 111_000


def process_dams():
    logger.info("Processing dams...")

    # Dam type catalogue (code → English label)
    dam_types = gpd.read_file(DAM_PATH, layer="DamTypeCatalogue")
    type_map = dict(zip(dam_types["TID"], dam_types["EN"]))

    # Dam points
    dams = gpd.read_file(DAM_PATH, layer="Dam")
    logger.info(f"  {len(dams)} dams loaded")

    # Facility table (linked via Dam.facilityR2 == Facility.xtf_id)
    facility = gpd.read_file(DAM_PATH, layer="Facility")
    facility = facility[["xtf_id", "FacilityName", "BeginningOfOperation", "RiverName"]].copy()
    dams = dams.merge(
        facility,
        left_on="facilityR2",
        right_on="xtf_id",
        how="left",
        suffixes=("", "_fac"),
    )

    # Reservoir table (linked via Reservoir.facilityR3 == Facility.xtf_id)
    reservoir = gpd.read_file(DAM_PATH, layer="Reservoir")
    reservoir = reservoir[["facilityR3", "ImpoundmentVolume", "ImpoundmentLevel", "StorageLevel"]].copy()
    dams = dams.merge(
        reservoir,
        left_on="facilityR2",   # same xtf_id links both Facility and Reservoir
        right_on="facilityR3",
        how="left",
    )

    # Reproject to WGS84
    dams = dams.to_crs(TARGET_CRS)

    return dams, type_map


def process_power_stations():
    logger.info("Processing power stations...")

    # Type catalogue (TypeCode → DE/FR/IT labels; no EN, use DE)
    type_cat = gpd.read_file(POWER_PATH, layer="HydropowerPlantTypeCatalogue")
    type_map = dict(zip(type_cat["xtf_id"], type_cat["DE"]))

    # Operational status catalogue
    status_cat = gpd.read_file(POWER_PATH, layer="HydropowerPlantOperationalStatusCatalogue")
    status_map = dict(zip(status_cat["xtf_id"], status_cat["DE"]))

    # Power plant points
    plants = gpd.read_file(POWER_PATH, layer="HydropowerPlant")
    logger.info(f"  {len(plants)} power stations loaded")

    # Technical specifications — one row per year per plant; take the latest
    tech = gpd.read_file(POWER_PATH, layer="TechnicalSpecification")
    tech = tech.sort_values("DateOfStatistic", ascending=False)
    tech_latest = tech.drop_duplicates(subset="hydropowerPlantR", keep="first")
    tech_latest = tech_latest[[
        "hydropowerPlantR",
        "PerformanceGeneratorMaximum",
        "ProductionExpected",
        "OperationalStatusCode",
    ]].copy()

    plants = plants.merge(
        tech_latest,
        left_on="WASTANumber",
        right_on="hydropowerPlantR",
        how="left",
    )

    # Reproject to WGS84
    plants = plants.to_crs(TARGET_CRS)

    return plants, type_map, status_map


def build_dam_features(dams, type_map, river_names):
    features = []
    for (_, row), river_name in zip(dams.iterrows(), river_names):
        geom = row.geometry
        if geom is None or geom.is_empty or river_name is None:
            continue
        props = {
            "name": row.get("DamName") or row.get("FacilityName"),
            "dam_height_m": _round(row.get("DamHeight")),
            "crest_level_m": _round(row.get("CrestLevel")),
            "construction_year": _int(row.get("ConstructionYear")),
            "dam_type": type_map.get(row.get("DamType"), row.get("DamType")),
            "river_name": river_name,
            "reservoir_volume_hm3": _round(row.get("ImpoundmentVolume")),
            "reservoir_level_m": _round(row.get("ImpoundmentLevel")),
        }
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(geom.x, 6), round(geom.y, 6)]},
            "properties": props,
        })
    return features


def build_power_features(plants, type_map, status_map, river_names):
    features = []
    for (_, row), river_name in zip(plants.iterrows(), river_names):
        geom = row.geometry
        if geom is None or geom.is_empty or river_name is None:
            continue
        props = {
            "id": int(row["WASTANumber"]) if pd.notna(row.get("WASTANumber")) else None,
            "name": row.get("Name"),
            "location": row.get("Location"),
            "canton": row.get("Canton"),
            "type_de": type_map.get(row.get("TypeCode"), row.get("TypeCode")),
            "beginning_of_operation": _int(row.get("BeginningOfOperation")),
            "fall_height_m": _round(row.get("FallHeight")),
            "power_max_mw": _round(row.get("PerformanceGeneratorMaximum")),
            "production_gwh": _round(row.get("ProductionExpected")),
            "river_name": river_name,
        }
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(geom.x, 6), round(geom.y, 6)]},
            "properties": props,
        })
    return features


def _round(val, decimals=2):
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        return round(float(val), decimals)
    except (TypeError, ValueError):
        return None


def _int(val):
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def main():
    tree, geoms, names = load_river_index()
    threshold_deg = meters_to_degrees(SNAP_THRESHOLD_M)

    # --- Dams ---
    dams, dam_type_map = process_dams()
    dam_points = [Point(row.geometry.x, row.geometry.y) for _, row in dams.iterrows()]
    dam_river_names = snap_to_river(dam_points, tree, geoms, names, threshold_deg)

    snapped = sum(1 for n in dam_river_names if n is not None)
    logger.info(f"  {snapped}/{len(dams)} dams snapped to a river")

    dam_features = build_dam_features(dams, dam_type_map, dam_river_names)
    dam_fc = {"type": "FeatureCollection", "features": dam_features}
    with open(DAMS_OUT, "w") as f:
        json.dump(dam_fc, f, ensure_ascii=False, separators=(",", ":"))
    logger.info(f"Wrote {len(dam_features)} dams → {DAMS_OUT}")

    # --- Power stations ---
    plants, power_type_map, status_map = process_power_stations()
    plant_points = [Point(row.geometry.x, row.geometry.y) for _, row in plants.iterrows()]
    plant_river_names = snap_to_river(plant_points, tree, geoms, names, threshold_deg)

    snapped = sum(1 for n in plant_river_names if n is not None)
    logger.info(f"  {snapped}/{len(plants)} power stations snapped to a river")

    power_features = build_power_features(plants, power_type_map, status_map, plant_river_names)
    power_fc = {"type": "FeatureCollection", "features": power_features}
    with open(POWER_OUT, "w") as f:
        json.dump(power_fc, f, ensure_ascii=False, separators=(",", ":"))
    logger.info(f"Wrote {len(power_features)} power stations → {POWER_OUT}")


if __name__ == "__main__":
    main()
