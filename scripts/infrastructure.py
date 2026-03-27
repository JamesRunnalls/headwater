"""Extract dams and hydropower stations and snap them to the river network.

Reads:
  - external/stauanlagen-bundesaufsicht_2056.gpkg   — Swiss federal supervision dams
  - external/statistik-wasserkraftanlagen_2056.gpkg — Swiss hydropower plant statistics
  - public/geodata/outputs/rivers.geojson            — processed river network (WGS84)

Outputs:
  - public/geodata/outputs/infrastructure.geojson — merged dam/power features with category
      category="dam"           — dam with no associated nearby power station
      category="power"         — power station with no associated nearby dam
      category="dam_with_power"— dam matched to a nearby power station (similar name + proximity)

Run from the project root:
  conda run -n rivers python scripts/infrastructure.py
"""

import json
import logging
import math
import unicodedata
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
INFRA_OUT = ROOT / "public/geodata/outputs/infrastructure.geojson"

TARGET_CRS = "EPSG:4326"
SNAP_THRESHOLD_M = 500  # metres — max distance to nearest river before river_name=null
NAME_MATCH_THRESHOLD_M = 10_000  # metres — max distance for name-based dam/power matching
PROXIMITY_ONLY_THRESHOLD_M = 1_000  # metres — fallback proximity match without name overlap

_STOPWORDS = {
    "kw", "kwz", "ag", "sa", "gmbh", "kraftwerk", "zentrale", "dotierzentrale",
    "pumpe", "fmm", "gd", "esg", "esa", "esb", "ahsag", "kvr", "alk",
}


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


def normalize_name(s):
    """Return a frozenset of significant tokens from an infrastructure name."""
    if not s:
        return frozenset()
    # Strip accents
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower()
    # Split on whitespace, hyphens, slashes, underscores
    import re
    tokens = re.split(r"[\s\-/_]+", s)
    # Remove stopwords and short tokens
    return frozenset(t for t in tokens if len(t) >= 3 and t not in _STOPWORDS)


def haversine_m(lon1, lat1, lon2, lat2):
    """Return great-circle distance in metres between two WGS84 points."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def match_dams_to_power(dam_features, power_features):
    """
    Match dams to power stations using name token overlap + proximity.

    Returns:
        matched: list of (dam_feature, power_feature) tuples
        unmatched_dams: list of unmatched dam features
        unmatched_power: list of unmatched power features
    """
    claimed_power = set()  # indices into power_features

    # Build all candidate (dam_idx, power_idx, score) triples
    candidates = []
    for di, df in enumerate(dam_features):
        dam_coords = df["geometry"]["coordinates"]
        dam_tokens = normalize_name(df["properties"].get("name", ""))
        for pi, pf in enumerate(power_features):
            power_coords = pf["geometry"]["coordinates"]
            dist = haversine_m(dam_coords[0], dam_coords[1], power_coords[0], power_coords[1])
            if dist > NAME_MATCH_THRESHOLD_M:
                continue
            power_tokens = normalize_name(pf["properties"].get("name", ""))
            overlap = dam_tokens & power_tokens
            if not overlap:
                continue
            score = len(overlap) * 2 - dist / 5000
            candidates.append((score, di, pi, dist))

    # Greedy one-to-one assignment by descending score
    candidates.sort(reverse=True)
    matched_dam = {}   # dam_idx → power_idx
    for score, di, pi, dist in candidates:
        if di in matched_dam or pi in claimed_power:
            continue
        matched_dam[di] = pi
        claimed_power.add(pi)

    # Proximity-only fallback for still-unmatched dams
    unmatched_dam_idxs = [i for i in range(len(dam_features)) if i not in matched_dam]
    for di in unmatched_dam_idxs:
        dam_coords = dam_features[di]["geometry"]["coordinates"]
        best_dist = PROXIMITY_ONLY_THRESHOLD_M + 1
        best_pi = None
        for pi, pf in enumerate(power_features):
            if pi in claimed_power:
                continue
            power_coords = pf["geometry"]["coordinates"]
            dist = haversine_m(dam_coords[0], dam_coords[1], power_coords[0], power_coords[1])
            if dist < best_dist:
                best_dist = dist
                best_pi = pi
        if best_pi is not None:
            matched_dam[di] = best_pi
            claimed_power.add(best_pi)

    matched = [(dam_features[di], power_features[pi]) for di, pi in matched_dam.items()]
    unmatched_dams = [dam_features[i] for i in range(len(dam_features)) if i not in matched_dam]
    unmatched_power = [power_features[i] for i in range(len(power_features)) if i not in claimed_power]

    logger.info(
        f"Matching: {len(matched)} dam_with_power, "
        f"{len(unmatched_dams)} dam-only, {len(unmatched_power)} power-only"
    )
    return matched, unmatched_dams, unmatched_power


def build_infra_features(matched, unmatched_dams, unmatched_power):
    """Build the combined infrastructure feature list with category property."""
    features = []

    for dam_f, power_f in matched:
        dp = dam_f["properties"]
        pp = power_f["properties"]
        props = {
            "category": "dam_with_power",
            "name": dp.get("name"),
            "power_name": pp.get("name"),
            "river_name": dp.get("river_name"),
            "dam_height_m": dp.get("dam_height_m"),
            "crest_level_m": dp.get("crest_level_m"),
            "construction_year": dp.get("construction_year"),
            "dam_type": dp.get("dam_type"),
            "reservoir_volume_hm3": dp.get("reservoir_volume_hm3"),
            "reservoir_level_m": dp.get("reservoir_level_m"),
            "power_id": pp.get("id"),
            "location": pp.get("location"),
            "canton": pp.get("canton"),
            "type_de": pp.get("type_de"),
            "beginning_of_operation": pp.get("beginning_of_operation"),
            "fall_height_m": pp.get("fall_height_m"),
            "power_max_mw": pp.get("power_max_mw"),
            "production_gwh": pp.get("production_gwh"),
        }
        # Remove None values to keep file lean
        props = {k: v for k, v in props.items() if v is not None}
        features.append({"type": "Feature", "geometry": dam_f["geometry"], "properties": props})

    for dam_f in unmatched_dams:
        props = {**dam_f["properties"], "category": "dam"}
        features.append({"type": "Feature", "geometry": dam_f["geometry"], "properties": props})

    for power_f in unmatched_power:
        pp = power_f["properties"]
        props = {k: v for k, v in pp.items() if k != "id"}
        props["power_id"] = pp.get("id")
        props["category"] = "power"
        features.append({"type": "Feature", "geometry": power_f["geometry"], "properties": props})

    return features


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
            "name": _str(row.get("DamName") or row.get("FacilityName")),
            "dam_height_m": _round(row.get("DamHeight")),
            "crest_level_m": _round(row.get("CrestLevel")),
            "construction_year": _int(row.get("ConstructionYear")),
            "dam_type": _str(type_map.get(row.get("DamType"), row.get("DamType"))),
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
            "name": _str(row.get("Name")),
            "location": _str(row.get("Location")),
            "canton": _str(row.get("Canton")),
            "type_de": _str(type_map.get(row.get("TypeCode"), row.get("TypeCode"))),
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


def _str(val):
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    return str(val)


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

    # --- Power stations ---
    plants, power_type_map, status_map = process_power_stations()
    plant_points = [Point(row.geometry.x, row.geometry.y) for _, row in plants.iterrows()]
    plant_river_names = snap_to_river(plant_points, tree, geoms, names, threshold_deg)

    snapped = sum(1 for n in plant_river_names if n is not None)
    logger.info(f"  {snapped}/{len(plants)} power stations snapped to a river")

    power_features = build_power_features(plants, power_type_map, status_map, plant_river_names)

    # --- Merged infrastructure ---
    matched, unmatched_dams, unmatched_power = match_dams_to_power(dam_features, power_features)
    infra_features = build_infra_features(matched, unmatched_dams, unmatched_power)
    infra_fc = {"type": "FeatureCollection", "features": infra_features}
    with open(INFRA_OUT, "w") as f:
        json.dump(infra_fc, f, ensure_ascii=False, separators=(",", ":"))
    logger.info(f"Wrote {len(infra_features)} infrastructure features → {INFRA_OUT}")


if __name__ == "__main__":
    main()
