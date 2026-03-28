"""Extract the river network downstream of headwater points.

Reads:
  - geodata/headwaters.geojson  — points defining major tributary headwaters
  - geodata/lakes.geojson       — lake polygons
  - swissTLM3D FlowingWater shapefile — full directed river network

Outputs:
  - public/geodata/rivers.geojson — filtered network, lake-interior segments removed (WGS84)
  - public/geodata/sinks.geojson  — network termination points with type property:
        "outlet"      — true river outlet (end of network, not in a lake)
        "lake_entry"  — where a river flows into a lake
        "lake_exit"   — where a river flows out of a lake (lake source)
        "lake_source" — headwater whose snap node lies inside / near a lake

Run from the project root:
  python scripts/network.py
"""

import json
import logging
import re
from pathlib import Path

import geopandas as gpd
import networkx as nx
import numpy as np
import pandas as pd
from shapely.geometry import LineString, MultiLineString, Point
from shapely.ops import linemerge, substring

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Paths relative to project root
ROOT = Path(__file__).parent.parent
HEADWATERS_PATH = ROOT / "public/geodata/inputs/headwaters.geojson"
LAKES_PATH = ROOT / "public/geodata/inputs/lakes.geojson"
GAUGES_PATH = ROOT / "external/camels_ch/catchment_delineations/CAMELS_CH_gauging_stations.shp"
GAUGE_ID_COL = "gauge_id"
GAUGE_SNAP_DISTANCE = 500  # metres — gauge must be within this distance of a reach
GDB_EP_SNAP_DISTANCE = 5.0  # metres — GDB endpoint must be this close to count as "on" the reach
RIVERS_PATH = (
    ROOT
    / "external/swisstlm3d_2025-03_2056_5728.shp/TLM_GEWAESSER"
    / "swissTLM3D_TLM_FLIESSGEWAESSER.shp"
)
OUTPUT_PATH = ROOT / "public/geodata/outputs/rivers.geojson"
LAKES_OUT_PATH = ROOT / "public/geodata/outputs/lakes.geojson"
HEADWATERS_OUT_PATH = ROOT / "public/geodata/outputs/natural_sources.geojson"
LAKE_SOURCES_PATH = ROOT / "public/geodata/outputs/lake_sources.geojson"
SINKS_PATH = ROOT / "public/geodata/outputs/sinks.geojson"
OUTPUT_SOURCES_AND_SINKS = False  # write headwaters, lake-sources, and sinks GeoJSONs
CAMELS_OBS_DIR = ROOT / "external/camels_ch/timeseries/observation_based"
CAMELS_SIM_DIR = ROOT / "external/camels_ch/timeseries/simulation_based"
GDB_MEAN_DISCHARGE_PATH = (
    ROOT / "external/mittlere-abfluesse_2056.gdb/Mittlere_Abfluesse.gdb"
)

TARGET_CRS = "EPSG:2056"
NODE_PRECISION = 0.1   # metres — coordinates rounded to this grid for node matching
MAX_SNAP_DISTANCE = 300  # metres — headwaters snapped to nearest segment within this distance
LAKE_BUFFER_M = 50  # metres — a point within this distance of a lake is "in" the lake
SIMPLIFY_TOLERANCE_M = 5.0  # metres — Douglas-Peucker simplification applied before export
COORD_PRECISION = 6         # decimal places for output lon/lat (~0.1 m at Swiss latitudes)


def round_coord(coord, precision=NODE_PRECISION):
    """Round coordinate to a fixed grid so nearby points map to the same node."""
    factor = 1.0 / precision
    return tuple(round(c * factor) / factor for c in coord[:2])


def extract_lines(geom):
    """Return a flat list of non-empty LineStrings from any Shapely geometry."""
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, LineString):
        return [geom]
    if isinstance(geom, MultiLineString):
        return [g for g in geom.geoms if not g.is_empty]
    if hasattr(geom, "geoms"):  # GeometryCollection
        result = []
        for g in geom.geoms:
            result.extend(extract_lines(g))
        return result
    return []


def build_graph(rivers):
    """Build a directed NetworkX graph from river segment geometries.

    Tags each edge with `druckstollen=True` for pressure-tunnel segments so the
    tracer can prefer surface-water routes and only fall back to tunnels when
    there is no other way forward.

    Returns (G, edge_geom) where edge_geom maps (u, v, key) → LineString.
    """
    G = nx.MultiDiGraph()
    edge_geom = {}

    obj_vals = rivers["OBJEKTART"].values if "OBJEKTART" in rivers.columns else None
    geoms = rivers.geometry.values
    n = len(geoms)
    log_step = max(1, n // 10)

    for ridx, line in enumerate(geoms):
        if ridx % log_step == 0:
            logger.info("  Building graph: %d/%d segments", ridx, n)

        if line is None or line.is_empty:
            continue

        is_druckstollen = obj_vals is not None and obj_vals[ridx] == "Druckstollen"
        sub_lines = list(line.geoms) if isinstance(line, MultiLineString) else [line]

        for sub_line in sub_lines:
            coords = list(sub_line.coords)
            if len(coords) < 2:
                continue
            u = round_coord(coords[0])
            v = round_coord(coords[-1])
            if u == v:
                continue
            key = G.add_edge(
                u, v,
                river_idx=ridx,
                length=sub_line.length,
                druckstollen=is_druckstollen,
            )
            edge_geom[(u, v, key)] = sub_line

    return G, edge_geom


def snap_headwaters(headwaters, rivers):
    """Snap each headwater point to the upstream end of the nearest river segment.

    Returns:
        snap_nodes   : list of graph-node coordinate tuples (one per matched headwater)
        snap_points  : list of the original headwater Points in TARGET_CRS (same order)
    """
    sindex = rivers.sindex
    snap_nodes = []
    snap_points = []
    n_failed = 0

    for idx, hw in headwaters.iterrows():
        pt = hw.geometry
        if pt is None or pt.is_empty:
            n_failed += 1
            continue

        try:
            result = sindex.nearest(pt, max_distance=MAX_SNAP_DISTANCE, return_all=True)
            candidates = list(result[1])
        except Exception:
            candidates = []

        if not candidates:
            logger.warning(
                "Headwater %d: no segment within %dm — skipped", idx, MAX_SNAP_DISTANCE
            )
            n_failed += 1
            continue

        # Pick the geometrically closest segment
        best_dist = np.inf
        best_ridx = None

        for cidx in candidates:
            line = rivers.geometry.iloc[cidx]
            if line is None or line.is_empty:
                continue
            seg = list(line.geoms)[0] if isinstance(line, MultiLineString) else line
            d = seg.distance(pt)
            if d < best_dist:
                best_dist = d
                best_ridx = cidx

        if best_ridx is None:
            n_failed += 1
            continue

        line = rivers.geometry.iloc[best_ridx]
        seg = list(line.geoms)[0] if isinstance(line, MultiLineString) else line
        snap_nodes.append(round_coord(list(seg.coords)[0]))
        snap_points.append(pt)

    logger.info(
        "Snapped %d/%d headwaters (failed: %d)",
        len(snap_nodes), len(headwaters), n_failed,
    )
    return snap_nodes, snap_points


def trace_all_downstream(G, snap_nodes):
    """Trace downstream from every snap node, collecting visited edge tuples.

    At each node the tracer prefers surface-water edges over Druckstollen and,
    among those, follows the longest outgoing edge (main-channel heuristic).
    Druckstollen are used only when there is no surface-water alternative.

    Returns a set of (u, v, key) edge tuples.
    """
    all_visited = set()

    for i, start_node in enumerate(snap_nodes):
        if i % 50 == 0:
            logger.info(
                "  Tracing headwater %d/%d — %d edges collected so far",
                i, len(snap_nodes), len(all_visited),
            )

        if start_node not in G:
            continue

        current = start_node
        local_visited = set()

        for _ in range(200_000):  # safety limit against infinite loops
            out_edges = list(G.out_edges(current, keys=True, data=True))
            if not out_edges:
                break

            unvisited = [
                (u, v, k, d)
                for u, v, k, d in out_edges
                if (u, v, k) not in local_visited
            ]
            if not unvisited:
                break

            # Prefer surface water; fall back to Druckstollen only if necessary
            surface = [(u, v, k, d) for u, v, k, d in unvisited if not d.get("druckstollen")]
            pool = surface if surface else unvisited

            u, v, k, data = max(pool, key=lambda x: x[3].get("length", 0))
            local_visited.add((u, v, k))
            all_visited.add((u, v, k))
            current = v

    return all_visited


def propagate_gauge_ids(G, visited_edges, gauges, rivers):
    """Propagate CAMELS gauge IDs downstream through the visited network.

    Each edge receives the set of gauge IDs that are upstream of it, using a
    reset-at-gauge rule: when the propagation reaches a gauge node it resets to
    just that gauge's ID (because a gauge integrates all upstream flow, so
    downstream you only need to reference that single gauge).

    Algorithm: single topological forward pass (upstream → downstream).
      - Gauge node  → emit {gauge_id}  (reset)
      - Other node  → emit union of sets received from all in-edges

    Parameters
    ----------
    G            : full MultiDiGraph (all TLM segments)
    visited_edges: set of (u, v, key) in the traced network
    gauges       : GeoDataFrame of CAMELS gauging stations (in TARGET_CRS)
    rivers       : GeoDataFrame of TLM river segments (for spatial index)

    Returns
    -------
    edge_gauge_sets : dict[(u, v, key) → frozenset[int]]
    """
    # Build subgraph of visited edges
    H = nx.MultiDiGraph()
    for u, v, k in visited_edges:
        H.add_edge(u, v, key=k, **G.edges[u, v, k])

    # Snap each gauge to the nearest node present in H
    sindex = rivers.sindex
    gauge_node_map: dict = {}  # graph_node_tuple → int gauge_id

    for _, gauge in gauges.iterrows():
        pt = gauge.geometry
        if pt is None or pt.is_empty:
            continue
        gid = gauge[GAUGE_ID_COL]
        try:
            gid = int(gid) if gid is not None and not np.isnan(float(gid)) else None
        except (TypeError, ValueError):
            gid = None
        if gid is None:
            continue

        try:
            result = sindex.nearest(pt, max_distance=GAUGE_SNAP_DISTANCE, return_all=True)
            candidates = list(result[1])
        except Exception:
            candidates = []
        if not candidates:
            continue

        best_dist, best_node = np.inf, None
        for cidx in candidates:
            line = rivers.geometry.iloc[cidx]
            if line is None or line.is_empty:
                continue
            seg = list(line.geoms)[0] if isinstance(line, MultiLineString) else line
            for coord in (list(seg.coords)[0], list(seg.coords)[-1]):
                node = round_coord(coord)
                if node not in H:
                    continue
                d = pt.distance(Point(coord))
                if d < best_dist:
                    best_dist, best_node = d, node

        if best_node is not None and best_dist <= GAUGE_SNAP_DISTANCE:
            gauge_node_map[best_node] = gid

    logger.info("Snapped %d gauges to graph nodes for propagation", len(gauge_node_map))

    # Topological order: upstream nodes first
    try:
        topo_order = list(nx.topological_sort(H))
    except nx.NetworkXUnfeasible:
        logger.warning("Graph has cycles — gauge propagation may be incomplete")
        topo_order = list(H.nodes())

    # Forward pass: compute the gauge set emitted downstream by each node
    node_out_set: dict = {}
    edge_gauge_sets: dict = {}

    for node in topo_order:
        if node in gauge_node_map:
            # RESET: this gauge integrates all upstream flow
            node_out_set[node] = frozenset([gauge_node_map[node]])
        else:
            in_sets = [
                node_out_set.get(u, frozenset())
                for u, v, k in H.in_edges(node, keys=True)
            ]
            node_out_set[node] = frozenset().union(*in_sets) if in_sets else frozenset()

        out_set = node_out_set[node]
        for u, v, k in H.out_edges(node, keys=True):
            edge_gauge_sets[(u, v, k)] = out_set

    assigned = sum(1 for s in edge_gauge_sets.values() if s)
    logger.info(
        "Gauge propagation: %d/%d edges have a gauge association",
        assigned, len(visited_edges),
    )
    return edge_gauge_sets


def merge_network(visited_edges, G, edge_geom, edge_gauge_sets=None):
    """Merge chains of edges between junction nodes into single LineStrings.

    A junction node is any node that is not a simple pass-through (i.e. it has
    in-degree ≠ 1 or out-degree ≠ 1 in the visited subgraph). Edges between
    two consecutive junction nodes are concatenated into one LineString.

    Returns (output_geoms, output_ridxs, output_gauge_sets).
    output_gauge_sets[i] is a frozenset of gauge IDs for reach i (empty if none).
    """
    # Build subgraph of visited edges only
    H = nx.MultiDiGraph()
    for u, v, k in visited_edges:
        data = G.edges[u, v, k]
        H.add_edge(u, v, key=k, **data)

    # Junction nodes: sources, sinks, confluences, bifurcations
    junction_nodes = {
        node for node in H.nodes()
        if H.in_degree(node) != 1 or H.out_degree(node) != 1
    }

    logger.info(
        "Subgraph: %d nodes, %d edges, %d junction nodes",
        H.number_of_nodes(), H.number_of_edges(), len(junction_nodes),
    )

    output_geoms = []
    output_ridxs = []       # parallel: river_idx values per merged reach
    output_gauge_sets = []  # parallel: frozenset of gauge IDs per merged reach
    seen_edges = set()

    for start_node in sorted(junction_nodes):
        for u, v, k in H.out_edges(start_node, keys=True):
            if (u, v, k) in seen_edges:
                continue

            # Walk the chain from this edge until the next junction node or dead end
            chain = []
            chain_ridxs = []
            chain_gauge_sets = []
            cu, cv, ck = u, v, k

            while True:
                seen_edges.add((cu, cv, ck))
                geom = edge_geom.get((cu, cv, ck))
                if geom is not None:
                    chain.append(geom)
                ridx = H.edges[cu, cv, ck].get("river_idx")
                if ridx is not None:
                    chain_ridxs.append(ridx)
                if edge_gauge_sets is not None:
                    chain_gauge_sets.append(
                        edge_gauge_sets.get((cu, cv, ck), frozenset())
                    )

                if cv in junction_nodes:
                    break

                # Follow the single outgoing edge from this pass-through node
                next_edges = list(H.out_edges(cv, keys=True))
                if not next_edges or next_edges[0] in seen_edges:
                    break
                cu, cv, ck = next_edges[0]

            if not chain:
                continue

            merged = linemerge(chain) if len(chain) > 1 else chain[0]
            output_geoms.append(merged)
            output_ridxs.append(chain_ridxs)
            chain_gauge_set = (
                frozenset().union(*chain_gauge_sets) if chain_gauge_sets else frozenset()
            )
            output_gauge_sets.append(chain_gauge_set)

    return output_geoms, output_ridxs, output_gauge_sets


def _extract_points(geom):
    """Recursively extract all Point geometries from a Shapely geometry."""
    if geom is None or geom.is_empty:
        return []
    if geom.geom_type == "Point":
        return [geom]
    if hasattr(geom, "geoms"):
        result = []
        for g in geom.geoms:
            result.extend(_extract_points(g))
        return result
    return []


def process_lakes(merged_geoms, lake_union):
    """Clip merged river geometries against lake polygons.

    River segments that pass through a lake are split at the lake boundary:
    the lake-interior portions are removed and their endpoints are recorded
    as lake entry / exit points.

    Returns:
        clipped_geoms  : river segments outside lakes
        lake_entries   : Points (EPSG:2056) where rivers enter lakes
        lake_exits     : Points (EPSG:2056) where rivers exit lakes
    """
    clipped_geoms = []
    lake_entries = []
    lake_exits = []

    for geom in merged_geoms:
        if not geom.intersects(lake_union):
            clipped_geoms.append(geom)
            continue

        # Keep the parts outside the lake
        outside = geom.difference(lake_union)
        outside_lines = extract_lines(outside)
        clipped_geoms.extend(outside_lines)

        if not outside_lines:
            # Line is entirely inside the lake — no boundary crossing, so no
            # entry/exit points to record (the segment is simply dropped).
            continue

        # Line crosses the lake boundary: find the exact boundary crossing points
        # by intersecting with the lake boundary rather than using segment endpoints.
        # This guarantees the points sit on the boundary, not inside the lake.
        crossings = geom.intersection(lake_union.boundary)
        cross_pts = _extract_points(crossings)
        if not cross_pts:
            continue

        # Sort crossings by distance along the line, then classify as entry/exit
        # by tracking whether we are currently inside or outside the lake.
        cross_pts.sort(key=lambda p: geom.project(p))

        # Determine state at the very start of the line (interpolate 1 cm in to
        # avoid boundary ambiguity when the line begins exactly on the shore).
        probe = geom.interpolate(min(0.01, geom.length * 0.01))
        inside_lake = lake_union.contains(probe)

        for pt in cross_pts:
            if inside_lake:
                lake_exits.append(pt)
            else:
                lake_entries.append(pt)
            inside_lake = not inside_lake

    logger.info(
        "Lake clipping: %d lines → %d clipped, %d entries, %d exits",
        len(merged_geoms), len(clipped_geoms), len(lake_entries), len(lake_exits),
    )
    return clipped_geoms, lake_entries, lake_exits


def assign_gauges_to_reaches(reaches_2d, gauges):
    """Snap gauging stations to river reaches and embed gauge IDs as properties.

    Each gauge is assigned to the nearest reach within GAUGE_SNAP_DISTANCE.
    Reaches with a single gauge keep their geometry; reaches with multiple gauges
    are split at the midpoint between each consecutive pair of gauges so that
    every sub-reach carries exactly one gauge ID.

    Parameters
    ----------
    reaches_2d : list of (LineString, name, gauge_set)  — in TARGET_CRS
                 gauge_set is a frozenset[int] from propagate_gauge_ids
    gauges     : GeoDataFrame with GAUGE_ID_COL column, in TARGET_CRS

    Returns
    -------
    list of (LineString, name, gauge_id, gauge_set)
        gauge_id  : int or None  — directly proximate gauge (≤GAUGE_SNAP_DISTANCE m)
        gauge_set : frozenset[int] — propagated upstream gauge IDs (passed through)
    """
    reach_geoms = [g for g, *_ in reaches_2d]
    sindex = gpd.GeoDataFrame(geometry=reach_geoms, crs=TARGET_CRS).sindex

    # reach_idx → [(gauge_id, dist_along_reach)]
    reach_gauge_map = {i: [] for i in range(len(reaches_2d))}

    for _, gauge in gauges.iterrows():
        pt = gauge.geometry
        if pt is None or pt.is_empty:
            continue

        try:
            result = sindex.nearest(pt, max_distance=GAUGE_SNAP_DISTANCE, return_all=True)
            candidates = list(result[1])
        except Exception:
            candidates = []

        if not candidates:
            continue

        best_dist, best_ridx = np.inf, None
        for cidx in candidates:
            d = reach_geoms[cidx].distance(pt)
            if d < best_dist:
                best_dist, best_ridx = d, cidx

        if best_ridx is None:
            continue

        gid = gauge[GAUGE_ID_COL]
        gid = int(gid) if gid is not None and not np.isnan(float(gid)) else None
        dist_along = reach_geoms[best_ridx].project(pt)
        reach_gauge_map[best_ridx].append((gid, dist_along))

    result_out = []
    n_split = 0

    for i, (geom, name, gauge_set) in enumerate(reaches_2d):
        gauges_here = sorted(reach_gauge_map[i], key=lambda x: x[1])

        if not gauges_here:
            result_out.append((geom, name, None, gauge_set))
            continue

        if len(gauges_here) == 1:
            result_out.append((geom, name, gauges_here[0][0], gauge_set))
            continue

        # Multiple gauges: split at midpoints between consecutive gauge positions
        dists = [d for _, d in gauges_here]
        gids  = [gid for gid, _ in gauges_here]
        cuts  = [0.0]
        for j in range(len(dists) - 1):
            cuts.append((dists[j] + dists[j + 1]) / 2.0)
        cuts.append(geom.length)

        for j in range(len(cuts) - 1):
            if cuts[j + 1] - cuts[j] < NODE_PRECISION:
                continue
            sub = substring(geom, cuts[j], cuts[j + 1])
            if sub is not None and not sub.is_empty and sub.length >= NODE_PRECISION:
                result_out.append((sub, name, gids[j], gauge_set))
        n_split += 1

    logger.info(
        "Gauge assignment: %d reaches → %d (split %d multi-gauge reaches)",
        len(reaches_2d), len(result_out), n_split,
    )
    return result_out


def compute_reach_connectivity(flat_reaches, snap_nodes, lake_entries, lake_exits, lakes):
    """Compute topology metadata for each reach using rounded-coordinate exact matching.

    Coordinates are rounded to NODE_PRECISION (0.1 m) — the same grid used when
    building the directed graph — so that graph-node-level junctions collapse to
    the same key, giving exact connectivity without any distance tolerance.

    Parameters
    ----------
    flat_reaches : list of (LineString, name, gauge_id, gauge_set) — in TARGET_CRS
    snap_nodes   : list of (x, y) tuples — headwater graph nodes (already rounded)
    lake_entries : list of Points — where rivers enter lakes, in TARGET_CRS
    lake_exits   : list of Points — where rivers exit lakes, in TARGET_CRS
    lakes        : GeoDataFrame — lake polygons, in TARGET_CRS

    Returns
    -------
    list of dicts, one per reach, with keys:
        id, has_natural_source, is_sink,
        downstream_river_id, downstream_lake_key,
        lake_outflow_river_id, lake_depth_m, lake_distance_m
    """
    # --- Build lookup: rounded start coord → reach ID (1-indexed) ---
    start_to_id: dict = {}
    for i, (geom, *_) in enumerate(flat_reaches):
        coords = list(geom.coords)
        if coords:
            start_to_id[round_coord(coords[0])] = i + 1

    # --- Headwater nodes (already rounded to NODE_PRECISION) ---
    snap_node_set = set(snap_nodes)

    # --- Assign each lake entry/exit point to the lake polygon it belongs to ---
    def nearest_lake_idx(pt):
        best_j, best_d = None, np.inf
        for j in range(len(lakes)):
            d = lakes.geometry.iloc[j].distance(pt)
            if d < best_d:
                best_d, best_j = d, j
        return best_j if best_d < LAKE_BUFFER_M else None

    # entry rounded coord → lake info dict
    entry_coord_to_lake: dict = {}
    for pt in lake_entries:
        key = round_coord((pt.x, pt.y))
        lake_idx = nearest_lake_idx(pt)
        if lake_idx is not None:
            lake_row = lakes.iloc[lake_idx]
            entry_coord_to_lake[key] = {
                "lake_key": lake_row["key"] if "key" in lake_row.index else str(lake_idx),
                "lake_depth_m": lake_row["max_depth"] if "max_depth" in lake_row.index else None,
                "lake_idx": lake_idx,
            }

    # lake_idx → list of exit Points (for distance and outflow lookup)
    exits_by_lake: dict = {}
    for pt in lake_exits:
        lake_idx = nearest_lake_idx(pt)
        if lake_idx is not None:
            exits_by_lake.setdefault(lake_idx, []).append(pt)

    # exit rounded coord → reach ID (the reach that starts at this exit)
    exit_coord_to_reach_id: dict = {}
    for pt in lake_exits:
        key = round_coord((pt.x, pt.y))
        reach_id = start_to_id.get(key)
        if reach_id is not None:
            exit_coord_to_reach_id[key] = reach_id

    # --- Compute per-reach metadata ---
    results = []
    for i, (geom, *_) in enumerate(flat_reaches):
        reach_id = i + 1
        coords = list(geom.coords)

        if not coords:
            results.append({
                "id": reach_id, "has_natural_source": False, "is_sink": True,
                "downstream_river_id": None, "downstream_lake_key": None,
                "lake_outflow_river_id": None, "lake_depth_m": None, "lake_distance_m": None,
            })
            continue

        start_key = round_coord(coords[0])
        end_key = round_coord(coords[-1])

        has_natural_source = start_key in snap_node_set

        downstream_river_id = None
        downstream_lake_key = None
        lake_outflow_river_id = None
        lake_depth_m = None
        lake_distance_m = None
        is_sink = False

        # 1. Direct river-to-river connection
        ds_id = start_to_id.get(end_key)
        if ds_id is not None and ds_id != reach_id:
            downstream_river_id = ds_id
        else:
            # 2. Lake entry
            lake_info = entry_coord_to_lake.get(end_key)
            if lake_info is not None:
                downstream_lake_key = lake_info["lake_key"]
                lake_depth_m = lake_info["lake_depth_m"]
                exit_pts = exits_by_lake.get(lake_info["lake_idx"], [])
                entry_pt = Point(coords[-1][0], coords[-1][1])
                if exit_pts:
                    best_d, best_exit_reach_id = np.inf, None
                    for exit_pt in exit_pts:
                        d = entry_pt.distance(Point(exit_pt.x, exit_pt.y))
                        if d < best_d:
                            best_d = d
                            exit_key = round_coord((exit_pt.x, exit_pt.y))
                            best_exit_reach_id = exit_coord_to_reach_id.get(exit_key)
                    lake_distance_m = round(best_d, 1)
                    lake_outflow_river_id = best_exit_reach_id
            else:
                # 3. True sink
                is_sink = True

        results.append({
            "id": reach_id,
            "has_natural_source": has_natural_source,
            "is_sink": is_sink,
            "downstream_river_id": downstream_river_id,
            "downstream_lake_key": downstream_lake_key,
            "lake_outflow_river_id": lake_outflow_river_id,
            "lake_depth_m": lake_depth_m,
            "lake_distance_m": lake_distance_m,
        })

    logger.info(
        "Connectivity: %d reaches — %d natural sources, %d sinks, %d lake entries",
        len(flat_reaches),
        sum(1 for r in results if r["has_natural_source"]),
        sum(1 for r in results if r["is_sink"]),
        sum(1 for r in results if r["downstream_lake_key"] is not None),
    )
    return results


def load_mean_discharge(obs_dir, sim_dir):
    """Compute long-term mean discharge (m³/s) per CAMELS-CH gauge.

    Reads all observation-based timeseries files; falls back to simulation-based
    when the observed mean is NaN or the file is absent.

    Returns
    -------
    dict[int, float]  gauge_id → mean discharge in m³/s
    """
    mean_q = {}
    n_obs, n_sim, n_missing = 0, 0, 0

    obs_files = {
        int(m.group(1)): p
        for p in obs_dir.glob("CAMELS_CH_obs_based_*.csv")
        if (m := re.search(r"_(\d+)\.csv$", p.name))
    }
    sim_files = {
        int(m.group(1)): p
        for p in sim_dir.glob("CAMELS_CH_sim_based_*.csv")
        if (m := re.search(r"_(\d+)\.csv$", p.name))
    }

    all_gauge_ids = set(obs_files) | set(sim_files)
    for gid in all_gauge_ids:
        val = float("nan")

        if gid in obs_files:
            try:
                val = pd.read_csv(obs_files[gid], usecols=["discharge_vol(m3/s)"])[
                    "discharge_vol(m3/s)"
                ].mean()
            except Exception:
                pass

        if np.isnan(val) and gid in sim_files:
            try:
                val = pd.read_csv(sim_files[gid], usecols=["discharge_vol_sim(m3/s)"])[
                    "discharge_vol_sim(m3/s)"
                ].mean()
                if not np.isnan(val):
                    n_sim += 1
            except Exception:
                pass
        elif not np.isnan(val):
            n_obs += 1

        if np.isnan(val):
            n_missing += 1
        else:
            mean_q[gid] = val

    logger.info(
        "Discharge timeseries: %d obs, %d sim fallback, %d missing (of %d gauges)",
        n_obs, n_sim, n_missing, len(all_gauge_ids),
    )
    return mean_q


def load_gdb_mean_discharge(gdb_path):
    """Load BAFU/FOEN mean annual discharge from the Mittlere Abfluesse GDB.

    Reads layer 'MittlererAbfluss_Regimetyp', reprojects to EPSG:2056, drops
    rows with null MQN_JAHR values, and returns a GeoDataFrame ready for
    nearest-neighbour lookup.

    Returns
    -------
    GeoDataFrame  columns: geometry (EPSG:2056), discharge_m3s (float)
    None          if the file does not exist or cannot be read
    """
    if not gdb_path.exists():
        logger.warning("GDB mean discharge not found, skipping fallback: %s", gdb_path)
        return None

    logger.info("Loading GDB mean discharge from %s", gdb_path)
    try:
        gdf = gpd.read_file(gdb_path, layer="MittlererAbfluss_Regimetyp", engine="pyogrio")
    except Exception as exc:
        logger.warning("Failed to read GDB mean discharge (%s), skipping fallback", exc)
        return None

    if "MQN_JAHR" not in gdf.columns:
        logger.warning(
            "GDB layer missing expected field 'MQN_JAHR' — found: %s", list(gdf.columns)
        )
        return None

    gdf = gdf.to_crs(TARGET_CRS)
    gdf = gdf.explode(index_parts=False).reset_index(drop=True)
    gdf = gdf[gdf["MQN_JAHR"].notna()][["geometry", "MQN_JAHR"]].rename(
        columns={"MQN_JAHR": "discharge_m3s"}
    )
    _ = gdf.sindex  # pre-build spatial index
    logger.info("GDB mean discharge: %d segments loaded", len(gdf))
    return gdf


def main():
    # --- Load data ---
    logger.info("Loading headwaters from %s", HEADWATERS_PATH)
    headwaters = gpd.read_file(HEADWATERS_PATH)
    if headwaters.crs is None or headwaters.crs.to_epsg() != 2056:
        logger.info("Reprojecting headwaters to EPSG:2056")
        headwaters = headwaters.to_crs(TARGET_CRS)
    logger.info("Loaded %d headwater points", len(headwaters))

    logger.info("Loading gauging stations from %s", GAUGES_PATH)
    gauges = gpd.read_file(GAUGES_PATH)
    if gauges.crs is None or gauges.crs.to_epsg() != 2056:
        gauges = gauges.to_crs(TARGET_CRS)
    gauges = gauges[gauges["type"] != "lake"]  # exclude lake gauges
    logger.info("Loaded %d gauging stations", len(gauges))

    logger.info("Loading lakes from %s", LAKES_PATH)
    lakes = gpd.read_file(LAKES_PATH, on_invalid='fix')
    if lakes.crs is None or lakes.crs.to_epsg() != 2056:
        lakes = lakes.to_crs(TARGET_CRS)
    lake_union = lakes.geometry.union_all()
    logger.info("Loaded %d lake polygons", len(lakes))

    logger.info("Loading river network from %s", RIVERS_PATH)
    rivers = gpd.read_file(RIVERS_PATH)
    logger.info("Loaded %d river segments", len(rivers))

    # --- Build directed graph (all segments; Druckstollen tagged but not removed) ---
    logger.info("Building directed graph...")
    G, edge_geom = build_graph(rivers)
    logger.info(
        "Graph complete: %d nodes, %d edges", G.number_of_nodes(), G.number_of_edges()
    )

    # --- Snap headwaters ---
    snap_nodes, snap_points = snap_headwaters(headwaters, rivers)

    # --- Trace downstream ---
    logger.info("Tracing downstream from %d snapped headwaters...", len(snap_nodes))
    visited_edges = trace_all_downstream(G, snap_nodes)
    logger.info("Collected %d unique edges", len(visited_edges))

    # --- Propagate gauge IDs downstream ---
    logger.info("Propagating gauge IDs through network...")
    edge_gauge_sets = propagate_gauge_ids(G, visited_edges, gauges, rivers)

    # --- Merge chains between junctions ---
    logger.info("Merging edge chains between junction nodes...")
    merged_geoms, merged_ridxs, merged_gauge_sets = merge_network(
        visited_edges, G, edge_geom, edge_gauge_sets
    )
    logger.info("Merged into %d lines", len(merged_geoms))

    # --- Compute modal river name for each merged reach ---
    name_vals = rivers["NAME"].values if "NAME" in rivers.columns else None

    def modal_name(ridxs):
        """Return the most common non-null NAME among the given river_idx values."""
        if name_vals is None:
            return None
        counts = {}
        for ridx in ridxs:
            n = name_vals[ridx]
            if n and str(n).strip() and str(n).lower() != "nan":
                counts[n] = counts.get(n, 0) + 1
        return max(counts, key=counts.get) if counts else None

    reach_names = [modal_name(ridxs) for ridxs in merged_ridxs]

    # --- Clip against lakes, carrying names and gauge sets through ---
    logger.info("Clipping river lines against lake polygons...")
    clipped_data = []  # (LineString, name, gauge_set)
    lake_entries = []
    lake_exits = []

    for geom, name, gauge_set in zip(merged_geoms, reach_names, merged_gauge_sets):
        if not geom.intersects(lake_union):
            for seg in extract_lines(geom):
                clipped_data.append((seg, name, gauge_set))
            continue

        outside_lines = extract_lines(geom.difference(lake_union))
        for seg in outside_lines:
            clipped_data.append((seg, name, gauge_set))

        if not outside_lines:
            continue  # entirely inside lake — drop silently, no entry/exit points

        # Find exact boundary crossing points and classify as entry/exit
        crossings = geom.intersection(lake_union.boundary)
        cross_pts = _extract_points(crossings)
        if not cross_pts:
            continue

        cross_pts.sort(key=lambda p: geom.project(p))
        probe = geom.interpolate(min(0.01, geom.length * 0.01))
        inside_lake = lake_union.contains(probe)

        for pt in cross_pts:
            if inside_lake:
                lake_exits.append(pt)
            else:
                lake_entries.append(pt)
            inside_lake = not inside_lake

    logger.info(
        "Lake clipping: %d reaches → %d segments, %d entries, %d exits",
        len(merged_geoms), len(clipped_data), len(lake_entries), len(lake_exits),
    )

    # --- Assign gauge IDs, splitting reaches with multiple gauges ---
    logger.info("Assigning gauging stations to reaches...")
    reaches_out = assign_gauges_to_reaches(clipped_data, gauges)

    # --- Export rivers ---
    logger.info("Computing reach connectivity...")
    # Flatten any MultiLineStrings so every entry is a plain LineString with a
    # unique sequential ID, then derive the topology from graph-node coordinates.
    flat_reaches = []  # (LineString, name, gauge_id, gauge_set) — in TARGET_CRS
    for geom, name, gauge_id, gauge_set in reaches_out:
        lines = list(geom.geoms) if isinstance(geom, MultiLineString) else [geom]
        for line in lines:
            if line is not None and not line.is_empty and line.length > 0:
                flat_reaches.append((line, name, gauge_id, gauge_set))

    connectivity = compute_reach_connectivity(
        flat_reaches, snap_nodes, lake_entries, lake_exits, lakes
    )

    # --- Load mean discharge per gauge ---
    mean_q = load_mean_discharge(CAMELS_OBS_DIR, CAMELS_SIM_DIR)

    # --- GDB mean discharge fallback (fills reaches with no CAMELS gauge) ---
    gdb_gdf = load_gdb_mean_discharge(GDB_MEAN_DISCHARGE_PATH)
    gdb_discharge = {}  # reach_index → float
    if gdb_gdf is not None:
        # Build spatial index of GDB downstream endpoints (last coord of each segment,
        # assuming upstream→downstream digitization convention).
        gdb_down_pts = gpd.GeoDataFrame(
            {"gdb_idx": range(len(gdb_gdf))},
            geometry=[Point(geom.coords[-1][:2]) for geom in gdb_gdf.geometry],
            crs=TARGET_CRS,
        )
        _ = gdb_down_pts.sindex  # pre-build

        n_filled = 0
        n_no_camels = 0
        for i, (line_2056, name, gauge_id, gauge_set) in enumerate(flat_reaches):
            if gauge_id is not None and gauge_id in mean_q:
                continue  # already covered by CAMELS
            n_no_camels += 1

            # Find GDB downstream endpoints near this reach, try nearest first.
            # Accept the first GDB segment whose upstream end is also on the reach
            # (both endpoints contained → segment is unambiguously on this river).
            result = gdb_down_pts.sindex.nearest(
                line_2056, max_distance=GDB_EP_SNAP_DISTANCE, return_all=True
            )
            candidates = sorted(
                result[1],
                key=lambda ep_i: line_2056.distance(gdb_down_pts.geometry.iloc[ep_i]),
            )
            for ep_i in candidates:
                gdb_seg_idx = int(gdb_down_pts["gdb_idx"].iloc[ep_i])
                up_pt = Point(gdb_gdf.geometry.iloc[gdb_seg_idx].coords[0][:2])
                if line_2056.distance(up_pt) <= GDB_EP_SNAP_DISTANCE:
                    gdb_discharge[i] = round(
                        float(gdb_gdf["discharge_m3s"].iloc[gdb_seg_idx]), 3
                    )
                    n_filled += 1
                    break

        logger.info(
            "GDB discharge fallback: filled %d of %d reaches with no CAMELS data",
            n_filled, n_no_camels,
        )

    # --- Topology-based discharge prediction for remaining nulls ---
    # Build reach_discharge: all discharges resolved so far (CAMELS + GDB)
    reach_discharge = {}  # reach_id → float
    for i, (_, _, gauge_id, _) in enumerate(flat_reaches):
        rid = connectivity[i]["id"]
        q = (
            round(mean_q[gauge_id], 3) if gauge_id is not None and gauge_id in mean_q
            else gdb_discharge.get(i)
        )
        if q is not None:
            reach_discharge[rid] = q

    # upstream_map[rid] = reach IDs that flow directly into rid
    upstream_map = {}
    for conn in connectivity:
        for ds_key in ("downstream_river_id", "lake_outflow_river_id"):
            ds = conn[ds_key]
            if ds is not None:
                upstream_map.setdefault(ds, []).append(conn["id"])

    # Pass 1: sum known upstream discharges (iterates until stable — fills mid-river nulls)
    changed = True
    n_pass1 = 0
    while changed:
        changed = False
        for conn in connectivity:
            rid = conn["id"]
            if rid in reach_discharge:
                continue
            ups = [reach_discharge[u] for u in upstream_map.get(rid, []) if u in reach_discharge]
            if ups:
                reach_discharge[rid] = round(sum(ups), 3)
                n_pass1 += 1
                changed = True
    logger.info("Topology pass 1 (upstream sum): filled %d reaches", n_pass1)

    # Pass 2: downstream fractional split (fills headwater nulls with no upstream data)
    id_to_conn = {conn["id"]: conn for conn in connectivity}

    def nearest_downstream_q(start_id, max_hops=20):
        rid = start_id
        for _ in range(max_hops):
            c = id_to_conn.get(rid)
            if c is None:
                break
            ds = c["downstream_river_id"] or c["lake_outflow_river_id"]
            if ds is None:
                break
            if ds in reach_discharge:
                null_ups = [u for u in upstream_map.get(ds, []) if u not in reach_discharge]
                if not null_ups:
                    break
                known_q = sum(reach_discharge[u] for u in upstream_map.get(ds, []) if u in reach_discharge)
                remainder = reach_discharge[ds] - known_q
                if remainder > 0:
                    return round(remainder / len(null_ups), 3)
            rid = ds
        return None

    n_pass2 = 0
    for conn in connectivity:
        rid = conn["id"]
        if rid in reach_discharge:
            continue
        q = nearest_downstream_q(rid)
        if q is not None:
            reach_discharge[rid] = q
            n_pass2 += 1
    logger.info("Topology pass 2 (downstream split): filled %d reaches", n_pass2)

    # --- Monotonicity: discharge must not decrease downstream ---
    # If a reach has lower discharge than any of its immediate upstream reaches,
    # replace it with the maximum upstream value.  Iterate until stable so that
    # corrections propagate all the way to the outlet.
    changed = True
    n_mono = 0
    while changed:
        changed = False
        for conn in connectivity:
            rid = conn["id"]
            if rid not in reach_discharge:
                continue
            ups_q = [reach_discharge[u] for u in upstream_map.get(rid, []) if u in reach_discharge]
            if not ups_q:
                continue
            max_up = max(ups_q)
            if reach_discharge[rid] < max_up:
                reach_discharge[rid] = max_up
                n_mono += 1
                changed = True
    logger.info("Monotonicity correction: adjusted %d reaches", n_mono)

    logger.info("Simplifying and reprojecting rivers...")
    simplified = [
        g.simplify(SIMPLIFY_TOLERANCE_M, preserve_topology=True)
        for g, *_ in flat_reaches
    ]
    flat_gdf = gpd.GeoDataFrame(
        geometry=simplified, crs=TARGET_CRS
    ).to_crs("EPSG:4326")

    def serialise_coords(geom):
        """Return a 3-D coordinate list with lon/lat at 6 dp and Z at 2 dp."""
        return [
            [round(x, COORD_PRECISION), round(y, COORD_PRECISION), round(z, 2)]
            for x, y, z in geom.coords
        ]

    river_features = []
    for i, ((line_2056, name, gauge_id, gauge_set), geom_4326, conn) in enumerate(zip(
        flat_reaches, flat_gdf.geometry, connectivity
    )):
        if geom_4326 is None or geom_4326.is_empty:
            continue

        discharge = reach_discharge.get(conn["id"])

        river_features.append({
            "type": "Feature",
            "properties": {
                "id": conn["id"],
                "name": name,
                "gauge_id": gauge_id,
                "discharge_m3s": discharge,
                "has_natural_source": conn["has_natural_source"],
                "is_sink": conn["is_sink"],
                "downstream_river_id": conn["downstream_river_id"],
                "downstream_lake_key": conn["downstream_lake_key"],
                "lake_outflow_river_id": conn["lake_outflow_river_id"],
                "lake_depth_m": conn["lake_depth_m"],
                "lake_distance_m": conn["lake_distance_m"],
            },
            "geometry": {
                "type": "LineString",
                "coordinates": serialise_coords(geom_4326),
            },
        })

    # --- Deduplicate same-name disconnected rivers (e.g. two rivers both named "Glatt") ---
    id_to_feature = {f["properties"]["id"]: f for f in river_features}
    upstream_of = {}
    for f in river_features:
        down = f["properties"]["downstream_river_id"]
        if down is not None:
            upstream_of.setdefault(down, []).append(f["properties"]["id"])

    def connected_ids(start_id):
        seen, q = set(), [start_id]
        while q:
            cur = q.pop()
            if cur in seen or cur not in id_to_feature:
                continue
            seen.add(cur)
            down = id_to_feature[cur]["properties"]["downstream_river_id"]
            if down is not None:
                q.append(down)
            q.extend(upstream_of.get(cur, []))
        return seen

    from collections import defaultdict
    name_groups = defaultdict(list)
    for f in river_features:
        n = f["properties"]["name"]
        if n:
            name_groups[n].append(f["properties"]["id"])

    for rname, ids in name_groups.items():
        if len(ids) <= 1:
            continue
        components, assigned = [], set()
        for rid in ids:
            if rid in assigned:
                continue
            comp = connected_ids(rid) & set(ids)
            components.append(comp)
            assigned |= comp
        if len(components) <= 1:
            continue  # all connected — genuine multi-segment river, no suffix needed
        components.sort(
            key=lambda c: sum(id_to_feature[i]["properties"]["discharge_m3s"] or 0 for i in c),
            reverse=True,
        )
        for suffix_n, comp in enumerate(components[1:], start=2):
            for rid in comp:
                id_to_feature[rid]["properties"]["name"] = f"{rname}_{suffix_n}"
        logger.info("Disambiguated %d components for river name '%s'", len(components), rname)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump({"type": "FeatureCollection", "features": river_features}, f)
    logger.info("Saved %d river features to %s", len(river_features), OUTPUT_PATH)

    # --- Export lakes reprojected to EPSG:4326 ---
    lakes_4326 = lakes.to_crs("EPSG:4326")
    lake_features = [
        {"type": "Feature", "properties": {k: v for k, v in dict(row.drop("geometry")).items() if not (isinstance(v, float) and pd.isna(v))},
         "geometry": row.geometry.__geo_interface__}
        for _, row in lakes_4326.iterrows()
        if row.geometry is not None and not row.geometry.is_empty
    ]
    with open(LAKES_OUT_PATH, "w") as f:
        json.dump({"type": "FeatureCollection", "features": lake_features}, f)
    logger.info("Saved %d lake polygons to %s", len(lake_features), LAKES_OUT_PATH)

    # --- Build and classify all point features ---
    graph_sources = {u for u, v, k in visited_edges}
    graph_sinks = {v for u, v, k in visited_edges} - graph_sources

    sink_pts_2056 = []       # true outlets + lake entries
    lake_source_pts_2056 = []  # lake exits + headwaters starting in a lake

    for node in graph_sinks:
        pt = Point(node)
        if lake_union.distance(pt) < LAKE_BUFFER_M:
            # Skip — this node is inside or on the lake boundary; the geometry-level
            # lake_entries (clipped at the exact lake boundary) represent this better.
            continue
        sink_pts_2056.append(pt)

    # Geometry-level lake entries (at the lake boundary, from process_lakes clipping)
    sink_pts_2056.extend(lake_entries)
    # Geometry-level lake exits
    lake_source_pts_2056.extend(lake_exits)

    # Headwater snap points that lie inside / near a lake → lake sources
    hw_pts_2056 = []
    for pt in snap_points:
        if lake_union.distance(pt) < LAKE_BUFFER_M:
            lake_source_pts_2056.append(pt)
        else:
            hw_pts_2056.append(pt)

    def pts_to_geojson(pts_2056):
        """Reproject a list of EPSG:2056 Points and return a GeoJSON FeatureCollection."""
        if not pts_2056:
            return {"type": "FeatureCollection", "features": []}
        gdf = gpd.GeoDataFrame(geometry=pts_2056, crs=TARGET_CRS).to_crs("EPSG:4326")
        features = [
            {"type": "Feature", "properties": {},
             "geometry": {"type": "Point", "coordinates": [g.x, g.y]}}
            for g in gdf.geometry if g is not None and not g.is_empty
        ]
        return {"type": "FeatureCollection", "features": features}

    # --- Write the four output files ---
    if OUTPUT_SOURCES_AND_SINKS:
        with open(HEADWATERS_OUT_PATH, "w") as f:
            gc = pts_to_geojson(hw_pts_2056)
            json.dump(gc, f)
        logger.info("Saved %d headwater points to %s", len(gc["features"]), HEADWATERS_OUT_PATH)

        with open(LAKE_SOURCES_PATH, "w") as f:
            gc = pts_to_geojson(lake_source_pts_2056)
            json.dump(gc, f)
        logger.info("Saved %d lake-source points to %s", len(gc["features"]), LAKE_SOURCES_PATH)

        with open(SINKS_PATH, "w") as f:
            gc = pts_to_geojson(sink_pts_2056)
            json.dump(gc, f)
        logger.info("Saved %d sink points to %s", len(gc["features"]), SINKS_PATH)

    print(f"\nDone.")
    print(f"  {len(river_features):>6} river reaches  → {OUTPUT_PATH}")
    if OUTPUT_SOURCES_AND_SINKS:
        print(f"  {len(hw_pts_2056):>6} headwaters     → {HEADWATERS_OUT_PATH}")
        print(f"  {len(lake_source_pts_2056):>6} lake sources   → {LAKE_SOURCES_PATH}")
        print(f"  {len(sink_pts_2056):>6} sinks          → {SINKS_PATH}")


if __name__ == "__main__":
    main()
