import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import * as d3 from "d3";
import FeatureModal from "../FeatureModal/FeatureModal";
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

const RiverModal = ({ name, geojson, lakes, dams = [], powerStations = [], damWithPower = [], t = {}, onHoverCoord, onClose, onSelectRiver, onSelectLake, onHoverLake, onSelectInfra, mapHoverCoord, onMouseEnter, onHoverTributary, onVisibleSection }) => {
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

  const { validPoints, totalDist, minE, maxE, lakeBands, confluences, damMarkers, powerMarkers, damWithPowerMarkers } = useMemo(() => {
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

    return { validPoints, totalDist, minE, maxE, lakeBands, confluences, damMarkers, powerMarkers, damWithPowerMarkers };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson, name, dams, powerStations, damWithPower]);

  const resolvedLakeBands = useMemo(
    () => lakeBands.map((lb) => ({ ...lb, name: lakeLookup[lb.key] ?? lb.key })),
    [lakeBands, lakeLookup]
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
    return { visMinE: Math.max(0, loWithLakes - p - 100), visMaxE: hi + p + 100 };
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
    return { svgX: xScaleZ(best.d), svgY: yS(best.e), elev: Math.round(best.e), lon: best.lon, lat: best.lat };
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
    const el = overlayRef.current;
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
      setCursor({ svgX, svgY: yS(p.e), elev: Math.round(p.e) });
      onHoverCoord?.([p.lon, p.lat]);
    }
  };


  return (
    <FeatureModal label={t.river} name={name} onClose={onClose} overlayClassName="modal-bottom modal-river" hideHeader onMouseEnter={onMouseEnter} defaultSnapIndex={1} onSnapChange={setSnapIndex}>
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
        <div className="river-modal-plot-title">Elevation profile</div>
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
        </defs>

        <g transform={`translate(${pad.left},${pad.top})`}>
          {/* Corner annotations */}
          <text className="river-modal-corner-label" x={0} y={-6} textAnchor="start">
            {Math.round(visMaxE)} m
          </text>

          <text className="river-modal-corner-label" x={0} y={iH + 14} textAnchor="start">
            {Math.round(visMinE)} m
          </text>
          <text className="river-modal-corner-label" x={iW} y={iH + 14} textAnchor="end">
            {totalDist.toFixed(1)} km
          </text>

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
              const labelY = Math.max(10, surfaceY - 10);
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

            {/* Dam icons on line (visual only) */}
            {damMarkers.map((m) => {
              const x = xScaleZ(m.d);
              if (x < 0 || x > iW) return null;
              const y = yS(m.elev);
              const scale = hoveredDamKey === m.name + m.d ? 1.3 : 1;
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
              const scale = hoveredDamWithPowerKey === m.name + m.d ? 1.3 : 1;
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
              const scale = hoveredPowerKey === m.name + m.d ? 1.3 : 1;
              return (
                <g key={"power-icon-" + m.name + m.d} transform={`translate(${x}, ${y - 10})`} style={{ pointerEvents: "none" }}>
                  <g transform={`scale(${scale})`} style={{ transition: "transform 0.15s ease" }}>
                    <path d="M-3,0 L3,12 L-1.5,12 L3,21 L-4.5,9 L0,9 Z" className="river-modal-power-icon" />
                  </g>
                </g>
              );
            })}

            {/* Hover dot */}
            {(cursor ?? mapCursor) && (() => {
              const c = cursor ?? mapCursor;
              return (
                <>
                  <circle cx={c.svgX} cy={c.svgY} r={4} className="river-modal-dot" filter="url(#dot-glow)" />
                  <text x={c.svgX} y={c.svgY - 10} textAnchor="middle" className="river-modal-dot-label">{c.elev} m</text>
                </>
              );
            })()}
          </g>


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
                onMouseEnter={() => setHoveredDamKey(m.name + m.d)}
                onMouseLeave={() => setHoveredDamKey(null)}
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
                transform={`translate(${x}, ${y - 10})`}
                style={{ cursor: "pointer" }}
                onClick={() => onSelectInfra?.(m.props, "power")}
                onMouseEnter={() => setHoveredPowerKey(m.name + m.d)}
                onMouseLeave={() => setHoveredPowerKey(null)}
              >
                <rect x={-8} y={0} width={16} height={24} fill="transparent" />
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
                onMouseEnter={() => setHoveredDamWithPowerKey(m.name + m.d)}
                onMouseLeave={() => setHoveredDamWithPowerKey(null)}
              >
                <polygon points="-7.5,0 7.5,0 12,25 -12,25" fill="transparent" />
              </g>
            );
          })}

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
                style={{ pointerEvents: "none" }}
              >
                {m.name}
              </text>
            );
          })()}

          {/* Tributary confluence labels — rendered above overlay to receive clicks */}
          {(() => {
            let lastX = -Infinity;
            return [...confluences].sort((a, b) => a.d - b.d).map((conf) => {
              const x = xScaleZ(conf.d);
              if (x < 0 || x > iW) return null;
              if (x - lastX < 14) return null;
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
                  {conf.name}
                </text>
              );
            });
          })()}

        </g>
      </svg>
      </div>
    </FeatureModal>
  );
};

export default RiverModal;
