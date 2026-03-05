import React from "react";

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

const ElevationModal = ({ name, geojson, onClose }) => {
  const features = geojson.features.filter((f) => {
    const n = f.properties?.name;
    return n && n.split(" |").some((p) => p.trim() === name);
  });

  const allCoords = features
    .map((f) => {
      const coords = f.geometry.coordinates;
      const firstElev = coords[0]?.[2] ?? 0;
      const lastElev = coords[coords.length - 1]?.[2] ?? 0;
      return firstElev >= lastElev ? coords : [...coords].reverse();
    })
    .sort((a, b) => (b[0]?.[2] ?? 0) - (a[0]?.[2] ?? 0))
    .flat();

  let dist = 0;
  const points = allCoords.map((coord, i) => {
    if (i > 0) dist += haversineKm(allCoords[i - 1], coord);
    return { d: dist, e: coord[2] };
  });

  const validPoints = points.filter((p) => p.e != null);
  const totalDist = dist;
  const elevs = validPoints.map((p) => p.e);
  const minE = Math.min(...elevs);
  const maxE = Math.max(...elevs);
  const elevRange = maxE - minE || 1;

  const W = 560, H = 240;
  const pad = { top: 16, right: 16, bottom: 36, left: 56 };
  const iW = W - pad.left - pad.right;
  const iH = H - pad.top - pad.bottom;

  const xScale = (d) => (d / totalDist) * iW;
  const yScale = (e) => iH - ((e - minE) / elevRange) * iH;

  const pathD = validPoints
    .map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.d).toFixed(1)},${yScale(p.e).toFixed(1)}`)
    .join(" ");

  const areaD =
    pathD +
    ` L${xScale(validPoints[validPoints.length - 1].d).toFixed(1)},${iH} L0,${iH} Z`;

  const yTicks = 4;
  const xTicks = 5;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1e1e1e",
          border: "1px solid #444",
          borderRadius: 8,
          padding: "20px 24px",
          color: "#ddd",
          minWidth: W + 48,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600 }}>{name} — elevation profile</span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#aaa",
              fontSize: 20,
              cursor: "pointer",
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>
        <svg width={W} height={H}>
          <defs>
            <linearGradient id="elev-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4696e8" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#4696e8" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <g transform={`translate(${pad.left},${pad.top})`}>
            {Array.from({ length: yTicks + 1 }, (_, i) => {
              const frac = i / yTicks;
              const e = minE + frac * elevRange;
              const y = iH - frac * iH;
              return (
                <g key={i}>
                  <line x1={0} y1={y} x2={iW} y2={y} stroke="#333" strokeWidth={1} />
                  <text x={-8} y={y + 4} textAnchor="end" fontSize={10} fill="#888">
                    {Math.round(e)}
                  </text>
                </g>
              );
            })}
            {Array.from({ length: xTicks + 1 }, (_, i) => {
              const frac = i / xTicks;
              const d = frac * totalDist;
              const x = frac * iW;
              return (
                <g key={i}>
                  <line x1={x} y1={0} x2={x} y2={iH} stroke="#333" strokeWidth={1} />
                  <text x={x} y={iH + 18} textAnchor="middle" fontSize={10} fill="#888">
                    {d.toFixed(1)}
                  </text>
                </g>
              );
            })}
            <path d={areaD} fill="url(#elev-fill)" />
            <path d={pathD} stroke="#4696e8" strokeWidth={2} fill="none" />
            <text x={iW / 2} y={iH + 34} textAnchor="middle" fontSize={11} fill="#666">
              distance (km)
            </text>
            <text
              x={-iH / 2}
              y={-42}
              textAnchor="middle"
              fontSize={11}
              fill="#666"
              transform="rotate(-90)"
            >
              elevation (m)
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
};

export default ElevationModal;
