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

const pad = { top: 24, right: 16, bottom: 36, left: 56 };

const RiverModal = ({ name, geojson, lakes, onHoverCoord, onClose }) => {
  const svgRef = useRef(null);
  const overlayRef = useRef(null);
  const [transform, setTransform] = useState(() => d3.zoomIdentity);
  const [cursor, setCursor] = useState(null);
  const [svgDims, setSvgDims] = useState({ W: 800, H: 340 });

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

  const { validPoints, totalDist, minE, maxE, lakeBands } = useMemo(() => {
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

    return { validPoints, totalDist, minE, maxE, lakeBands };
  }, [geojson, name]);

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
    return { visMinE: lo - p, visMaxE: hi + p };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transform, validPoints, minE, maxE, iW]);

  const elevRange = visMaxE - visMinE || 1;
  const yS = (e) => iH - ((e - visMinE) / elevRange) * iH;

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
      setCursor({ svgX, dist: Math.max(0, dist).toFixed(1), elev: Math.round(p.e) });
      onHoverCoord?.([p.lon, p.lat]);
    }
  };

  const yTickVals = Array.from({ length: 5 }, (_, i) => {
    const frac = i / 4;
    return { e: visMinE + frac * elevRange, y: iH - frac * iH };
  });

  const xTickVals = Array.from({ length: 6 }, (_, i) => {
    const frac = i / 5;
    const d = frac * totalDist;
    return { d, x: xScaleZ(d) };
  }).filter(({ x }) => x >= 0 && x <= iW);

  return (
    <FeatureModal label="RIVER" name={name} onClose={onClose} overlayClassName="modal-bottom" hideHeader>
      <svg ref={svgRef} width="100%" height="100%" style={{ display: "block" }}>
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
        </defs>

        <g transform={`translate(${pad.left},${pad.top})`}>
          {/* Y axis */}
          {yTickVals.map(({ e, y }, i) => (
            <g key={i}>
              <line className="river-modal-grid-line" x1={0} y1={y} x2={iW} y2={y} />
              <text className="river-modal-tick-label" x={-8} y={y + 4} textAnchor="end">
                {Math.round(e)}
              </text>
            </g>
          ))}

          {/* X axis */}
          {xTickVals.map(({ d, x }, i) => (
            <g key={i}>
              <line className="river-modal-grid-line" x1={x} y1={0} x2={x} y2={iH} />
              <text className="river-modal-tick-label" x={x} y={iH + 18} textAnchor="middle">
                {d.toFixed(1)}
              </text>
            </g>
          ))}

          {/* Clipped chart area */}
          <g clipPath="url(#river-chart-clip)">
            {/* Lake cross-sections */}
            {resolvedLakeBands.map((lake) => {
              const x1 = xScaleZ(lake.entry);
              const x2 = xScaleZ(lake.exit);
              if (x2 < 0 || x1 > iW) return null;
              const mid = (x1 + x2) / 2;
              const surfaceY = yS(lake.elev);
              const depthPx = (lake.depth / elevRange) * iH;
              const bottomY = Math.min(iH + 10, surfaceY + depthPx);
              const conicPath = `M${x1},${surfaceY} L${x2},${surfaceY} Q${mid},${bottomY} ${x1},${surfaceY} Z`;
              const labelX = Math.max(20, Math.min(iW - 20, mid));
              const labelY = Math.max(10, surfaceY - 6);
              return (
                <g key={lake.key}>
                  <path d={conicPath} fill="url(#lake-depth-fill)" />
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
                    className="river-modal-lake-label"
                    transform={`rotate(-90, ${labelX}, ${labelY})`}
                  >
                    {lake.name}
                  </text>
                </g>
              );
            })}

            {/* Elevation profile */}
            <path className="river-modal-area" d={areaD} />
            <path className="river-modal-path" d={pathD} />

            {/* Crosshair */}
            {cursor && (
              <line
                x1={cursor.svgX}
                y1={0}
                x2={cursor.svgX}
                y2={iH}
                className="river-modal-crosshair"
              />
            )}
          </g>

          {/* Tooltip (outside clip) */}
          {cursor && (() => {
            const tipX = cursor.svgX > iW - 100 ? cursor.svgX - 94 : cursor.svgX + 8;
            return (
              <g transform={`translate(${tipX},8)`}>
                <rect className="river-modal-tooltip-bg" width={86} height={38} rx={3} />
                <text className="river-modal-tooltip-text" x={8} y={15}>
                  {cursor.dist} km
                </text>
                <text className="river-modal-tooltip-text" x={8} y={30}>
                  {cursor.elev} m asl
                </text>
              </g>
            );
          })()}

          {/* Axis labels */}
          <text className="river-modal-axis-label" x={iW / 2} y={iH + 34} textAnchor="middle">
            distance (km)
          </text>
          <text
            className="river-modal-axis-label"
            x={-iH / 2}
            y={-42}
            textAnchor="middle"
            transform="rotate(-90)"
          >
            elevation (m)
          </text>

          {/* Interaction overlay — zoom + crosshair */}
          <rect
            ref={overlayRef}
            x={0}
            y={0}
            width={iW}
            height={iH}
            fill="transparent"
            style={{ cursor: "crosshair" }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => { setCursor(null); onHoverCoord?.(null); }}
          />
        </g>
      </svg>
    </FeatureModal>
  );
};

export default RiverModal;
