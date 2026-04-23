import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import * as d3 from "d3";
import FeatureModal from "../FeatureModal/FeatureModal";
import { stripRiverSuffix } from "../../pages/home/functions";
import "./RiverModal.css";

const haversineKm = ([lon1, lat1], [lon2, lat2]) => {
  const R = 6371;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const pad = { top: 40, right: 16, bottom: 36, left: 16 };

const SINK_COUNTRY = {
  "Le Rhône":     { flag: "🇫🇷", key: "france" },
  "Rotten":       { flag: "🇫🇷", key: "france" },
  "Le Doubs":     { flag: "🇫🇷", key: "france" },
  "L'Allaine":    { flag: "🇫🇷", key: "france" },
  "Rhein":        { flag: "🇩🇪", key: "germany" },
  "Doveria":      { flag: "🇮🇹", key: "italy" },
  "Tresa":        { flag: "🇮🇹", key: "italy" },
  "Breggia":      { flag: "🇮🇹", key: "italy" },
  "Mera":         { flag: "🇮🇹", key: "italy" },
  "Poschiavino":  { flag: "🇮🇹", key: "italy" },
  "Schergenbach": { flag: "🇩🇪", key: "germany" },
  "En":           { flag: "🇦🇹", key: "austria" },
  "Rom":          { flag: "🇦🇹", key: "austria" },
};

const RiverModal = ({ name, geojson, lakes, dams = [], powerStations = [], damWithPower = [], hydroStations = [], t = {}, onHoverCoord, onClose, onSelectRiver, onSelectLake, onHoverLake, onSelectInfra, mapHoverCoord, onMouseEnter, onHoverTributary, onVisibleSection, onHoverInfra, mapHoveredInfraName, onSelectHydroStation, onHoverHydroStation, mapHoveredHydroKey }) => {
  const svgRef = useRef(null);
  const overlayRef = useRef(null);
  const [transform, setTransform] = useState(() => d3.zoomIdentity);
  const [cursor, setCursor] = useState(null);
  const [svgDims, setSvgDims] = useState({ W: 800, H: 340 });
  const [snapIndex, setSnapIndex] = useState(1);
  const [hoveredDamKey, setHoveredDamKey] = useState(null);
  const [hoveredPowerKey, setHoveredPowerKey] = useState(null);
  const [hoveredDamWithPowerKey, setHoveredDamWithPowerKey] = useState(null);
  const [hoveredLakeKey, setHoveredLakeKey] = useState(null);
  const [hoveredHydroKey, setHoveredHydroKey] = useState(null);
  const isPeeking = window.innerWidth <= 768 && snapIndex === 0;

  const W = svgDims.W;
  const H = svgDims.H;
  const iW = W - pad.left - pad.right;
  const iH = H - pad.top - pad.bottom;

  useLayoutEffect(() => {
    if (!svgRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setSvgDims({ W: Math.floor(width), H: Math.floor(height) });
        setTransform(d3.zoomIdentity);
      }
    });
    ro.observe(svgRef.current);
    return () => ro.disconnect();
  }, []);

  const lakeLookup = useMemo(() => {
    if (!lakes) return {};
    return Object.fromEntries(
      lakes.features.map((f) => [f.properties.key, f.properties.name])
    );
  }, [lakes]);

  const lakePropsLookup = useMemo(() => {
    if (!lakes) return {};
    return Object.fromEntries(
      lakes.features.map((f) => [f.properties.key, f.properties])
    );
  }, [lakes]);

  const downstreamRiverName = useMemo(() => {
    if (!geojson || !name) return null;
    const features = geojson.features;
    const idToFeature = new Map(features.map((f) => [f.properties.id, f]));
    const currentIds = new Set(
      features
        .filter((f) => f.properties?.name?.split(" |").some((p) => p.trim() === name))
        .map((f) => f.properties.id)
    );
    for (const f of features) {
      if (!currentIds.has(f.properties.id)) continue;
      const effectiveDownId =
        f.properties.downstream_river_id ??
        (f.properties.downstream_lake_key ? f.properties.lake_outflow_river_id : null);
      if (!effectiveDownId || currentIds.has(effectiveDownId)) continue;
      const downFeature = idToFeature.get(effectiveDownId);
      if (!downFeature) continue;
      const downName = (downFeature.properties.name ?? "").split(" |")[0].trim();
      if (downName && downName !== name) return downName;
    }
    return null;
  }, [geojson, name]);

  const destinationCountry = SINK_COUNTRY[name] ?? null;

  const { validPoints, totalDist, minE, maxE, lakeBands, confluences, damMarkers, powerMarkers, damWithPowerMarkers, hydroMarkers } = useMemo(() => {
    const features = geojson.features.filter((f) => {
      const n = f.properties?.name;
      return n && n.split(" |").some((p) => p.trim() === name);
    });

    const orderedSegments = features
      .map((f) => {
        const coords = f.geometry.coordinates;
        const firstElev = coords[0]?.[2] ?? 0;
        const lastElev = coords[coords.length - 1]?.[2] ?? 0;
        return {
          feature: f,
          coords: firstElev >= lastElev ? coords : [...coords].reverse(),
        };
      })
      .sort((a, b) => (b.coords[0]?.[2] ?? 0) - (a.coords[0]?.[2] ?? 0));

    let dist = 0;
    let prevCoord = null;
    const allPoints = [];
    for (const seg of orderedSegments) {
      seg.startDist = dist;
      for (const coord of seg.coords) {
        if (prevCoord) dist += haversineKm(prevCoord, coord);
        allPoints.push({ d: dist, e: coord[2] ?? null, lon: coord[0], lat: coord[1] });
        prevCoord = coord;
      }
      seg.endDist = dist;
    }

    const validPoints = allPoints.filter((p) => p.e != null);
    const elevs = validPoints.map((p) => p.e);
    const minE = Math.min(...elevs);
    const maxE = Math.max(...elevs);
    const totalDist = dist;

    const lakeBands = orderedSegments
      .filter((seg) => seg.feature.properties.downstream_lake_key)
      .map((seg) => {
        const key = seg.feature.properties.downstream_lake_key;
        const lakeDistKm = (seg.feature.properties.lake_distance_m ?? 0) / 1000;
        const lastCoord = seg.coords[seg.coords.length - 1];
        const elev = lastCoord?.[2] ?? minE;
        return {
          key,
          entry: seg.endDist,
          exit: seg.endDist + lakeDistKm,
          elev,
          depth: seg.feature.properties.lake_depth_m ?? 200,
        };
      });

    const selectedIds = new Set(orderedSegments.map((s) => s.feature.properties.id));

    const confluences = geojson.features
      .filter((f) => {
        const downId = f.properties.downstream_river_id;
        if (!downId || !selectedIds.has(downId)) return false;
        const n = f.properties.name;
        if (!n) return false;
        return !n.split(" |").some((p) => p.trim() === name);
      })
      .map((f) => {
        const coords = f.geometry.coordinates;
        const firstElev = coords[0]?.[2] ?? 0;
        const lastElev = coords[coords.length - 1]?.[2] ?? 0;
        const oriented = firstElev >= lastElev ? coords : [...coords].reverse();
        const mouth = oriented[oriented.length - 1];
        let best = allPoints[0];
        let bestDist2 = Infinity;
        for (const pt of allPoints) {
          const dx = pt.lon - mouth[0];
          const dy = pt.lat - mouth[1];
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDist2) { bestDist2 = d2; best = pt; }
        }
        const tributaryName = (f.properties.name ?? "").split(" |")[0].trim();
        return { name: tributaryName, d: best.d, elev: best.e ?? minE };
      });

    const snapToProfile = (lon, lat) => {
      if (!validPoints.length) return null;
      let best = validPoints[0];
      let bestD2 = Infinity;
      for (const pt of validPoints) {
        const d2 = (pt.lon - lon) ** 2 + (pt.lat - lat) ** 2;
        if (d2 < bestD2) { bestD2 = d2; best = pt; }
      }
      return best;
    };

    const damMarkers = dams.map((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const pt = snapToProfile(lon, lat);
      return pt ? { name: f.properties.name, d: pt.d, elev: pt.e ?? minE, props: { ...f.properties, _lon: lon, _lat: lat }, lon, lat } : null;
    }).filter(Boolean);

    const powerMarkers = powerStations.map((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const pt = snapToProfile(lon, lat);
      return pt ? { name: f.properties.name, d: pt.d, elev: pt.e ?? minE, props: { ...f.properties, _lon: lon, _lat: lat } } : null;
    }).filter(Boolean);

    const damWithPowerMarkers = damWithPower.map((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const pt = snapToProfile(lon, lat);
      return pt ? { name: f.properties.name, d: pt.d, elev: pt.e ?? minE, props: { ...f.properties, _lon: lon, _lat: lat } } : null;
    }).filter(Boolean);

    const hydroMarkers = hydroStations.map((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const pt = snapToProfile(lon, lat);
      return pt ? { key: f.properties.key, label: f.properties.label, d: pt.d, elev: pt.e ?? minE, props: { ...f.properties, _lon: lon, _lat: lat } } : null;
    }).filter(Boolean);

    return { validPoints, totalDist, minE, maxE, lakeBands, confluences, damMarkers, powerMarkers, damWithPowerMarkers, hydroMarkers };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson, name, dams, powerStations, damWithPower, hydroStations]);

  const resolvedLakeBands = useMemo(
    () => lakeBands.map((lb) => ({ ...lb, name: lakeLookup[lb.key] ?? lb.key })),
    [lakeBands, lakeLookup]
  );

  const terminalLake = useMemo(
    () => resolvedLakeBands.find((lb) => lb.entry >= totalDist - 0.001) ?? null,
    [resolvedLakeBands, totalDist]
  );

  const xScaleBase = useMemo(
    () => d3.scaleLinear().domain([0, totalDist]).range([0, iW]),
    [totalDist, iW]
  );

  const xScaleZ = transform.rescaleX(xScaleBase);

  const { visMinE, visMaxE } = useMemo(() => {
    const d0 = xScaleZ.invert(0);
    const d1 = xScaleZ.invert(iW);
    const visible = validPoints.filter((p) => p.d >= d0 && p.d <= d1);
    if (!visible.length) return { visMinE: minE, visMaxE: maxE };
    const elevs = visible.map((p) => p.e);
    const lo = Math.min(...elevs);
    const hi = Math.max(...elevs);
    const p = (hi - lo) * 0.08 || 10;
    const visibleLakeBottom = lakeBands
      .filter((lb) => lb.entry <= d1 && lb.exit >= d0)
      .reduce((min, lb) => Math.min(min, lb.elev - (lb.depth ?? 0)), Infinity);
    const loWithLakes = isFinite(visibleLakeBottom) ? Math.min(lo, visibleLakeBottom) : lo;
    return { visMinE: Math.max(0, loWithLakes - p - 100), visMaxE: hi + 200 };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transform, validPoints, minE, maxE, iW, lakeBands]);

  const elevRange = visMaxE - visMinE || 1;
  const yS = (e) => iH - ((e - visMinE) / elevRange) * iH;

  const mapCursor = useMemo(() => {
    if (!mapHoverCoord || !validPoints.length) return null;
    const [lon, lat] = mapHoverCoord;
    let best = validPoints[0];
    let bestD2 = Infinity;
    for (const pt of validPoints) {
      const dx = pt.lon - lon;
      const dy = pt.lat - lat;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = pt; }
    }
    return { dist: best.d, e: best.e, elev: Math.round(best.e), lon: best.lon, lat: best.lat };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapHoverCoord, validPoints]);

  useEffect(() => {
    if (mapCursor) onHoverCoord?.([mapCursor.lon, mapCursor.lat]);
    else if (!cursor) onHoverCoord?.(null);
  }, [mapCursor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!onVisibleSection || !validPoints.length) return;
    if (transform.k <= 1) { onVisibleSection(null); return; }
    const d0 = xScaleZ.invert(0);
    const d1 = xScaleZ.invert(iW);
    const filtered = validPoints.filter((p) => p.d >= d0 && p.d <= d1);
    const paths = [];
    let current = [];
    for (const pt of filtered) {
      if (lakeBands.some((lb) => pt.d >= lb.entry && pt.d <= lb.exit)) {
        if (current.length >= 2) paths.push(current);
        current = [];
      } else {
        current.push([pt.lon, pt.lat]);
      }
    }
    if (current.length >= 2) paths.push(current);
    onVisibleSection(paths.length ? paths : null);
  }, [transform, validPoints, lakeBands, iW]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => onVisibleSection?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const zoom = d3
      .zoom()
      .scaleExtent([1, 30])
      .translateExtent([[0, 0], [iW, iH]])
      .on("zoom", (e) => setTransform(e.transform));
    d3.select(el).call(zoom);
    return () => d3.select(el).on(".zoom", null);
  }, [iW, iH]);

  const pathD = d3
    .line()
    .x((p) => xScaleZ(p.d))
    .y((p) => yS(p.e))
    .defined((p) => p.e != null)(validPoints);

  const areaD = d3
    .area()
    .x((p) => xScaleZ(p.d))
    .y0(iH)
    .y1((p) => yS(p.e))
    .defined((p) => p.e != null)(validPoints);

  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svgRef.current.getScreenCTM().inverse());
    const svgX = svgPt.x - pad.left;
    const dist = xScaleZ.invert(svgX);
    const bisect = d3.bisector((p) => p.d).left;
    const idx = Math.min(
      Math.max(0, bisect(validPoints, dist)),
      validPoints.length - 1
    );
    const p = validPoints[idx];
    if (p) {
      setCursor({ dist: p.d, e: p.e, elev: Math.round(p.e) });
      onHoverCoord?.([p.lon, p.lat]);
    }
  };


  return (
    <FeatureModal label={t.river} name={stripRiverSuffix(name)} onClose={onClose} overlayClassName="modal-bottom modal-river" hideHeader onMouseEnter={onMouseEnter} defaultSnapIndex={1} onSnapChange={setSnapIndex}>
      {isPeeking ? (
        <div className="river-modal-peek">
          <div className="river-modal-peek-stats">
            <span>{Math.round(totalDist)} km</span>
            <span>{Math.round(maxE)} m → {Math.round(minE)} m</span>
          </div>
          <div className="river-modal-peek-hint">{t.swipeUpForPlot ?? "swipe up for plot"}</div>
        </div>
      ) : null}
      <div className="river-modal-plot-wrap" style={{ display: isPeeking ? "none" : "block" }}>
        {terminalLake && (
          <div className="river-nav river-nav-downstream" style={downstreamRiverName ? { top: "calc(50% - 22px)" } : {}} onClick={() => onSelectLake?.(lakePropsLookup[terminalLake.key])} title={terminalLake.name}>
            <span className="river-nav-label">{terminalLake.name}</span>
            <span className="river-nav-arrow">›</span>
          </div>
        )}
        {downstreamRiverName && (
          <div className="river-nav river-nav-downstream" style={terminalLake ? { top: "calc(50% + 22px)" } : {}} onClick={() => onSelectRiver?.(downstreamRiverName)} title={downstreamRiverName}>
            <span className="river-nav-label">{stripRiverSuffix(downstreamRiverName)}</span>
            <span className="river-nav-arrow">›</span>
          </div>
        )}
      <svg ref={svgRef} width="100%" height="100%">
        <defs>
          <clipPath id="river-chart-clip">
            <rect x={0} y={0} width={iW} height={iH} />
          </clipPath>
          <linearGradient id="elev-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4696e8" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#4696e8" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="lake-depth-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4696e8" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#4696e8" stopOpacity="0.08" />
          </linearGradient>
          <filter id="dot-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="label-bg" x="-10%" y="-15%" width="120%" height="130%">
            <feFlood floodColor="#222" result="bg" />
            <feMerge>
              <feMergeNode in="bg" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g transform={`translate(${pad.left},${pad.top})`}>
{destinationCountry && (
            <foreignObject
              x={iW + 8 - iH / 2}
              y={iH / 2 - 12}
              width={iH}
              height={24}
              transform={`rotate(-90, ${iW + 8}, ${iH / 2})`}
              style={{ pointerEvents: "none", overflow: "visible" }}
            >
              <div
                xmlns="http://www.w3.org/1999/xhtml"
                className="river-modal-country-label"
                style={{ textAlign: "center", lineHeight: "24px" }}
              >
                {destinationCountry.flag} {t[destinationCountry.key] ?? destinationCountry.key}
              </div>
            </foreignObject>
          )}

          {/* Clipped chart area */}
          <g clipPath="url(#river-chart-clip)">
            {/* Lake cross-sections */}
            {resolvedLakeBands.map((lake) => {
              const x1 = xScaleZ(lake.entry);
              const x2 = xScaleZ(lake.exit);
              if (x2 < 0 || x1 > iW) return null;
              const mid = (x1 + x2) / 2;
              const surfaceY = yS(lake.elev);
              const bottomY = yS(lake.elev - lake.depth);
              const conicPath = `M${x1},${surfaceY} L${x2},${surfaceY} Q${mid},${2 * bottomY - surfaceY} ${x1},${surfaceY} Z`;
              const labelX = Math.max(20, Math.min(iW - 20, mid));
              const labelY = Math.max(10, surfaceY - 15);
              return (
                <g key={lake.key}>
                  <path d={conicPath} fill="url(#lake-depth-fill)" className={hoveredLakeKey === lake.key ? "river-modal-lake-shape river-modal-lake-shape-hovered" : "river-modal-lake-shape"} />
                  <line
                    x1={Math.max(0, x1)}
                    y1={surfaceY}
                    x2={Math.min(iW, x2)}
                    y2={surfaceY}
                    className="river-modal-lake-surface"
                  />
                  {lake.key !== terminalLake?.key && (
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor="start"
                      className={`river-modal-lake-label river-modal-lake-label-link${hoveredLakeKey === lake.key ? " river-modal-lake-label-hovered" : ""}`}
                      transform={`rotate(-90, ${labelX}, ${labelY})`}
                      style={{ pointerEvents: "none" }}
                    >
                      {lake.name}
                    </text>
                  )}
                  {lake.depth && (
                    <text
                      x={labelX}
                      y={bottomY + 14}
                      textAnchor="middle"
                      className="river-modal-lake-depth"
                    >
                      {`${Math.round(lake.depth)}m`}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Tributary confluence lines */}
            {[...confluences].sort((a, b) => a.d - b.d).map((conf) => {
              const x = xScaleZ(conf.d);
              if (x < 0 || x > iW) return null;
              const riverY = yS(conf.elev);
              return (
                <line
                  key={conf.name + conf.d}
                  x1={x} y1={0} x2={x} y2={riverY}
                  className="river-modal-confluence-line"
                />
              );
            })}

            {/* Dam hover line */}
            {hoveredDamKey && (() => {
              const m = damMarkers.find((m) => m.name + m.d === hoveredDamKey);
              if (!m) return null;
              const x = xScaleZ(m.d);
              if (x < 0 || x > iW) return null;
              return <line key="dam-hover-line" x1={x} y1={0} x2={x} y2={yS(m.elev)} className="river-modal-dam-hover-line" style={{ pointerEvents: "none" }} />;
            })()}

            {/* Power station hover line */}
            {hoveredPowerKey && (() => {
              const m = powerMarkers.find((m) => m.name + m.d === hoveredPowerKey);
              if (!m) return null;
              const x = xScaleZ(m.d);
              if (x < 0 || x > iW) return null;
              return <line key="power-hover-line" x1={x} y1={0} x2={x} y2={yS(m.elev)} className="river-modal-power-hover-line" style={{ pointerEvents: "none" }} />;
            })()}

            {/* Dam-with-power hover line */}
            {hoveredDamWithPowerKey && (() => {
              const m = damWithPowerMarkers.find((m) => m.name + m.d === hoveredDamWithPowerKey);
              if (!m) return null;
              const x = xScaleZ(m.d);
              if (x < 0 || x > iW) return null;
              return <line key="dwp-hover-line" x1={x} y1={0} x2={x} y2={yS(m.elev)} className="river-modal-dam-hover-line" style={{ pointerEvents: "none" }} />;
            })()}

            {/* Hydro station hover line */}
            {hoveredHydroKey && (() => {
              const m = hydroMarkers.find((m) => m.key === hoveredHydroKey);
              if (!m) return null;
              const x = xScaleZ(m.d);
              if (x < 0 || x > iW) return null;
              return <line key="hydro-hover-line" x1={x} y1={0} x2={x} y2={yS(m.elev)} className="river-modal-hydro-hover-line" style={{ pointerEvents: "none" }} />;
            })()}


            {/* Dam icons on line (visual only) */}
            {damMarkers.map((m) => {
              const x = xScaleZ(m.d);
              if (x < 0 || x > iW) return null;
              const y = yS(m.elev);
              const scale = hoveredDamKey === m.name + m.d || mapHoveredInfraName === m.name ? 1.3 : 1;
              return (
                <g key={"dam-icon-" + m.name + m.d} transform={`translate(${x}, ${y - 10})`} style={{ pointerEvents: "none" }}>
                  <g transform={`scale(${scale})`} style={{ transition: "transform 0.15s ease" }}>
                    <polygon points="-3.75,0 3.75,0 7.5,19.5 -7.5,19.5" className="river-modal-dam-icon" />
                  </g>
                </g>
              );
            })}

            {/* Elevation profile */}
            <path className="river-modal-area" d={areaD} />
            <path className="river-modal-path" d={pathD} />

            {/* Dam-with-power icons on line (visual only) */}
            {damWithPowerMarkers.map((m) => {
              const x = xScaleZ(m.d);
              if (x < 0 || x > iW) return null;
              const y = yS(m.elev);
              const scale = hoveredDamWithPowerKey === m.name + m.d || mapHoveredInfraName === m.name ? 1.3 : 1;
              return (
                <g key={"dwp-icon-" + m.name + m.d} transform={`translate(${x}, ${y - 10})`} style={{ pointerEvents: "none" }}>
                  <g transform={`scale(${scale})`} style={{ transition: "transform 0.15s ease" }}>
                    <polygon points="-3.75,0 3.75,0 7.5,19.5 -7.5,19.5" className="river-modal-dam-icon" />
                    <path d="M-3,0 L3,12 L-1.5,12 L3,21 L-4.5,9 L0,9 Z" className="river-modal-power-icon" />
                  </g>
                </g>
              );
            })}

            {/* Power station icons on line (visual only) */}
            {powerMarkers.map((m) => {
              const x = xScaleZ(m.d);
              if (x < 0 || x > iW) return null;
              const y = yS(m.elev);
              const scale = hoveredPowerKey === m.name + m.d || mapHoveredInfraName === m.name ? 1.3 : 1;
              return (
                <g key={"power-icon-" + m.name + m.d} transform={`translate(${x}, ${y})`} style={{ pointerEvents: "none" }}>
                  <g transform={`scale(${scale})`} style={{ transition: "transform 0.15s ease" }}>
                    <path d="M-3,0 L3,12 L-1.5,12 L3,21 L-4.5,9 L0,9 Z" className="river-modal-power-icon" transform="translate(0,-15.75) scale(1.5)" />
                  </g>
                </g>
              );
            })}

            {/* Hydro station icons on line (visual only) */}
            {hydroMarkers.map((m) => {
              const x = xScaleZ(m.d);
              if (x < 0 || x > iW) return null;
              const y = yS(m.elev);
              const scale = hoveredHydroKey === m.key || mapHoveredHydroKey === m.key ? 1.3 : 1;
              return (
                <g key={"hydro-icon-" + m.key} transform={`translate(${x}, ${y - 10})`} style={{ pointerEvents: "none" }}>
                  <g transform={`scale(${scale})`} style={{ transition: "transform 0.15s ease" }}>
                    <g transform="scale(0.5) translate(-27, -32)">
                      <rect x="18" y="8" width="18" height="48" rx="2" fill="#C084FC" opacity="0.35"/>
                      <rect x="18" y="30" width="18" height="26" rx="2" fill="#C084FC"/>
                    </g>
                  </g>
                </g>
              );
            })}

            {/* Hover dot */}
            {(cursor ?? mapCursor) && (() => {
              const c = cursor ?? mapCursor;
              const cx = xScaleZ(c.dist);
              const cy = yS(c.e);
              return (
                <>
                  <circle cx={cx} cy={cy} r={4} className="river-modal-dot" filter="url(#dot-glow)" />
                  <text x={cx} y={cy - 10} textAnchor="middle" className="river-modal-dot-label">{c.elev} m</text>
                </>
              );
            })()}
          </g>


          {/* Hydro station discharge lines and bottom labels */}
          {(() => {
            const candidates = hydroMarkers
              .map((m) => {
                const x = xScaleZ(m.d);
                if (x < 0 || x > iW) return null;
                const discharge = m.props.discharge;
                const dischargeRecent = discharge?.last_measured_at && (Date.now() - new Date(discharge.last_measured_at).getTime()) < 2 * 60 * 60 * 1000;
                const dischargeText = dischargeRecent && discharge.last_value != null ? `${parseFloat(discharge.last_value.toFixed(1))} ${discharge.unit ?? ''}` : null;
                if (!dischargeText) return null;
                return { key: m.key, x, y: yS(m.elev), dischargeText, value: discharge.last_value, halfWidth: (dischargeText.length * 8) / 2 + 6 };
              })
              .filter(Boolean)
              .sort((a, b) => b.value - a.value);
            const shown = [];
            for (const c of candidates) {
              if (!shown.some((s) => Math.abs(s.x - c.x) < s.halfWidth + c.halfWidth)) shown.push(c);
            }
            return shown.map((c) => (
              <g key={"hydro-discharge-" + c.key} style={{ pointerEvents: "none" }}>
                <line x1={c.x} y1={c.y} x2={c.x} y2={iH} className="river-modal-hydro-line" />
                <text x={c.x} y={iH + 18} textAnchor="middle" className="river-modal-hydro-value">{c.dischargeText}</text>
              </g>
            ));
          })()}

          {/* Interaction overlay — zoom + crosshair */}
          <rect
            ref={overlayRef}
            x={0}
            y={0}
            width={iW}
            height={iH}
            fill="transparent"
            style={{ cursor: "pointer" }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => { setCursor(null); onHoverCoord?.(null); }}
          />

          {/* Lake hit targets — above overlay to receive events */}
          {resolvedLakeBands.map((lake) => {
            const x1 = xScaleZ(lake.entry);
            const x2 = xScaleZ(lake.exit);
            if (x2 < 0 || x1 > iW) return null;
            const surfaceY = yS(lake.elev);
            const bottomY = yS(lake.elev - lake.depth);
            const cx1 = Math.max(0, x1);
            const cx2 = Math.min(iW, x2);
            const mid = (x1 + x2) / 2;
            const conicPath = `M${x1},${surfaceY} L${x2},${surfaceY} Q${mid},${2 * bottomY - surfaceY} ${x1},${surfaceY} Z`;
            const handlers = {
              onClick: () => onSelectLake?.(lakePropsLookup[lake.key]),
              onMouseEnter: () => { setHoveredLakeKey(lake.key); onHoverLake?.(lake.key); },
              onMouseLeave: () => { setHoveredLakeKey(null); onHoverLake?.(null); },
              style: { cursor: "pointer" },
            };
            return (
              <g key={"lake-hit-" + lake.key}>
                {/* label area above surface */}
                <rect x={cx1} y={0} width={cx2 - cx1} height={surfaceY} fill="transparent" {...handlers} />
                {/* conic depth area */}
                <path d={conicPath} fill="transparent" {...handlers} />
              </g>
            );
          })}

          {/* Dam icon hit targets — above overlay to receive events */}
          {damMarkers.map((m) => {
            const x = xScaleZ(m.d);
            if (x < 0 || x > iW) return null;
            const y = yS(m.elev);
            return (
              <g
                key={"dam-hit-" + m.name + m.d}
                transform={`translate(${x}, ${y - 10})`}
                style={{ cursor: "pointer" }}
                onClick={() => onSelectInfra?.(m.props, "dam")}
                onMouseEnter={() => { setHoveredDamKey(m.name + m.d); onHoverInfra?.(m.name); }}
                onMouseLeave={() => { setHoveredDamKey(null); onHoverInfra?.(null); }}
              >
                <polygon points="-7.5,0 7.5,0 12,25 -12,25" fill="transparent" />
              </g>
            );
          })}

          {/* Power station hit targets — above overlay to receive events */}
          {powerMarkers.map((m) => {
            const x = xScaleZ(m.d);
            if (x < 0 || x > iW) return null;
            const y = yS(m.elev);
            return (
              <g
                key={"power-hit-" + m.name + m.d}
                transform={`translate(${x}, ${y})`}
                style={{ cursor: "pointer" }}
                onClick={() => onSelectInfra?.(m.props, "power")}
                onMouseEnter={() => { setHoveredPowerKey(m.name + m.d); onHoverInfra?.(m.name); }}
                onMouseLeave={() => { setHoveredPowerKey(null); onHoverInfra?.(null); }}
              >
                <rect x={-10} y={-16} width={20} height={32} fill="transparent" />
              </g>
            );
          })}

          {/* Dam-with-power hit targets — above overlay to receive events */}
          {damWithPowerMarkers.map((m) => {
            const x = xScaleZ(m.d);
            if (x < 0 || x > iW) return null;
            const y = yS(m.elev);
            return (
              <g
                key={"dwp-hit-" + m.name + m.d}
                transform={`translate(${x}, ${y - 10})`}
                style={{ cursor: "pointer" }}
                onClick={() => onSelectInfra?.(m.props, "dam_with_power")}
                onMouseEnter={() => { setHoveredDamWithPowerKey(m.name + m.d); onHoverInfra?.(m.name); }}
                onMouseLeave={() => { setHoveredDamWithPowerKey(null); onHoverInfra?.(null); }}
              >
                <polygon points="-7.5,0 7.5,0 12,25 -12,25" fill="transparent" />
              </g>
            );
          })}

          {/* Hydro station hit targets */}
          {hydroMarkers.map((m) => {
            const x = xScaleZ(m.d);
            if (x < 0 || x > iW) return null;
            const y = yS(m.elev);
            const discharge = m.props.discharge;
            const hasDischarge = discharge?.last_value != null && discharge?.last_measured_at && (Date.now() - new Date(discharge.last_measured_at).getTime()) < 2 * 60 * 60 * 1000;
            const hitTop = hasDischarge ? -36 : -17;
            return (
              <g
                key={"hydro-hit-" + m.key}
                transform={`translate(${x}, ${y - 10})`}
                style={{ cursor: "pointer" }}
                onClick={() => onSelectHydroStation?.(m.props)}
                onMouseEnter={() => { setHoveredHydroKey(m.key); onHoverHydroStation?.(m.key); }}
                onMouseLeave={() => { setHoveredHydroKey(null); onHoverHydroStation?.(null); }}
              >
                <rect x={-35} y={hitTop} width={70} height={-hitTop + 10} fill="transparent" />
              </g>
            );
          })}

          {/* Tributary confluence labels — rendered above overlay to receive clicks */}
          {(() => {
            let lastX = -Infinity;
            return [...confluences].sort((a, b) => a.d - b.d).map((conf) => {
              const x = xScaleZ(conf.d);
              if (x < 0 || x > iW) return null;
              if (x - lastX < 14) return null;
              const displayName = stripRiverSuffix(conf.name);
              const lineHeight = yS(conf.elev);
              const labelLength = displayName.length * 7 + 10;
              if (lineHeight < labelLength) return null;
              lastX = x;
              return (
                <text
                  key={conf.name + conf.d}
                  x={x}
                  y={-4}
                  textAnchor="end"
                  className="river-modal-confluence-label"
                  transform={`rotate(-90, ${x}, 0)`}
                  style={{ cursor: "pointer" }}
                  onClick={() => onSelectRiver?.(conf.name)}
                  onMouseEnter={() => onHoverTributary?.(conf.name)}
                  onMouseLeave={() => onHoverTributary?.(null)}
                >
                  {displayName}
                </text>
              );
            });
          })()}

          {/* Dam hover label */}
          {hoveredDamKey && (() => {
            const m = damMarkers.find((m) => m.name + m.d === hoveredDamKey);
            if (!m) return null;
            const x = xScaleZ(m.d);
            if (x < 0 || x > iW) return null;
            return (
              <text
                key="dam-hover-label"
                x={x}
                y={-4}
                textAnchor="end"
                className="river-modal-dam-label"
                transform={`rotate(-90, ${x}, -4)`}
                filter="url(#label-bg)"
                style={{ pointerEvents: "none" }}
              >
                {m.name}
              </text>
            );
          })()}

          {/* Power station hover label */}
          {hoveredPowerKey && (() => {
            const m = powerMarkers.find((m) => m.name + m.d === hoveredPowerKey);
            if (!m) return null;
            const x = xScaleZ(m.d);
            if (x < 0 || x > iW) return null;
            return (
              <text
                key="power-hover-label"
                x={x}
                y={-4}
                textAnchor="end"
                className="river-modal-power-label"
                transform={`rotate(-90, ${x}, -4)`}
                filter="url(#label-bg)"
                style={{ pointerEvents: "none" }}
              >
                {m.name}
              </text>
            );
          })()}

          {/* Dam-with-power hover label */}
          {hoveredDamWithPowerKey && (() => {
            const m = damWithPowerMarkers.find((m) => m.name + m.d === hoveredDamWithPowerKey);
            if (!m) return null;
            const x = xScaleZ(m.d);
            if (x < 0 || x > iW) return null;
            return (
              <text
                key="dwp-hover-label"
                x={x}
                y={-4}
                textAnchor="end"
                className="river-modal-dam-with-power-label"
                transform={`rotate(-90, ${x}, -4)`}
                filter="url(#label-bg)"
                style={{ pointerEvents: "none" }}
              >
                {m.name}
              </text>
            );
          })()}

          {/* Hydro station hover label */}
          {hoveredHydroKey && (() => {
            const m = hydroMarkers.find((m) => m.key === hoveredHydroKey);
            if (!m) return null;
            const x = xScaleZ(m.d);
            if (x < 0 || x > iW) return null;
            return (
              <text
                key="hydro-hover-label"
                x={x}
                y={-4}
                textAnchor="end"
                className="river-modal-hydro-label"
                transform={`rotate(-90, ${x}, -4)`}
                filter="url(#label-bg)"
                style={{ pointerEvents: "none" }}
              >
                {m.label?.includes(' - ') ? m.label.split(' - ').slice(1).join(' - ') : m.label}
              </text>
            );
          })()}

        </g>
      </svg>
      </div>
    </FeatureModal>
  );
};

export default RiverModal;
