import React, { useState, useEffect, useMemo } from "react";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import DeckGL from "@deck.gl/react";
import { PathLayer, SolidPolygonLayer } from "@deck.gl/layers";
import "./home.css";

// Interpolate blue -> red based on t (0..1)
const lerpColor = (t) => {
  //const r = Math.round(60 + t * 195); // 60 -> 255
  //const g = Math.round(140 - t * 100); // 140 -> 40
  //const b = Math.round(220 - t * 180); // 220 -> 40
  return [70, 150, 220, 150];
  //return [r, g, b, 255];
};

// Build binary attribute buffers for PathLayer.
// Each feature becomes a single path object with per-vertex gradient colors.
// Width is proportional to discharge_m3s from the feature's properties.
const processGeoJson = (geojson) => {
  const features = geojson.features;
  const n = features.length;

  // First pass: count total vertices and read discharge values
  const vertexCounts = new Array(n);
  const dischargeVals = new Float32Array(n);
  let totalVertices = 0;
  let maxDischarge = 1; // avoid divide-by-zero

  for (let fi = 0; fi < n; fi++) {
    const count = features[fi].geometry.coordinates.length;
    vertexCounts[fi] = count;
    totalVertices += count;

    const d = features[fi].properties?.discharge_m3s ?? 0;
    dischargeVals[fi] = d;
    if (d > maxDischarge) maxDischarge = d;
  }

  const logMax = Math.log1p(maxDischarge);

  const positions = new Float64Array(totalVertices * 2);
  const colors = new Uint8Array(totalVertices * 4);
  const startIndices = new Uint32Array(n + 1); // +1 for sentinel
  const widths = new Float32Array(n);
  const names = new Array(n);

  let vo = 0; // vertex offset into flat arrays

  for (let fi = 0; fi < n; fi++) {
    const feature = features[fi];
    startIndices[fi] = vo;
    names[fi] = feature.properties?.name ?? null;
    if (names[fi] && names[fi].includes(" |")) {
      names[fi] = names[fi].split(" |")[0];
    }

    const nv = vertexCounts[fi]; // total vertices for this feature
    let lv = 0; // local vertex index within the feature

    for (const coord of feature.geometry.coordinates) {
      const t = nv <= 1 ? 0.5 : lv / (nv - 1);
      const [r, g, b, a] = lerpColor(t);
      colors[vo * 4] = r;
      colors[vo * 4 + 1] = g;
      colors[vo * 4 + 2] = b;
      colors[vo * 4 + 3] = a;
      positions[vo * 2] = coord[0];
      positions[vo * 2 + 1] = coord[1];
      vo++;
      lv++;
    }

    // log scale to compress the large discharge range
    widths[fi] =
      30 + (logMax > 0 ? Math.log1p(dischargeVals[fi]) / logMax : 0) * 1200;
  }
  startIndices[n] = vo; // sentinel: end of last path

  return {
    length: n,
    startIndices,
    attributes: {
      getPath: { value: positions, size: 2 },
      getColor: { value: colors, size: 4 },
    },
    widths,
    names,
  };
};

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

const INITIAL_VIEW_STATE = {
  longitude: 8.2,
  latitude: 46.8,
  zoom: 7.5,
  pitch: 0,
  bearing: 0,
};

const MAP_STYLE = {
  version: 8,
  sources: {
    "local-tiles": {
      type: "raster",
      tiles: ["https://pub-7ff8d4bb7f1b4656a69d50b620c6e05f.r2.dev/tiles_v4/{z}/{x}/{y}.png"],
      tileSize: 256,
      minzoom: 7,
      maxzoom: 12,
      bounds: [2.8125, 43.0689, 14.0625, 48.9225],
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#333333" },
    },
    {
      id: "local-tiles",
      type: "raster",
      source: "local-tiles",
    },
  ],
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

const SwissRiversDeckGL = () => {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [geojson, setGeojson] = useState(null);
  const [lakes, setLakes] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [hoveredName, setHoveredName] = useState(null);
  const [hoveredLake, setHoveredLake] = useState(null);
  const [selectedRiverName, setSelectedRiverName] = useState(null);

  useEffect(() => {
    fetch("/geodata/outputs/rivers.geojson")
      .then((res) => res.json())
      .then(setGeojson);
    fetch("/geodata/outputs/lakes.geojson")
      .then((res) => res.json())
      .then(setLakes);
  }, []);

  const riverData = useMemo(() => {
    if (!geojson) return null;
    return processGeoJson(geojson);
  }, [geojson]);

  const layers = useMemo(() => {
    const result = [];
    if (riverData) {
      // widthScale cancels the zoom doubling so rivers stay a consistent screen size
      const widthScale =
        1 / Math.pow(2, viewState.zoom - INITIAL_VIEW_STATE.zoom);
      result.push(
        new PathLayer({
          id: "rivers",
          data: riverData,
          getWidth: (_, { index }) => riverData.widths[index],
          widthScale,
          widthUnits: "meters",
          widthMinPixels: 1,
          widthMaxPixels: 20,
          capRounded: true,
          jointRounded: true,
          pickable: true,
          onHover: (info) => {
            if (info.index >= 0) {
              const name = riverData.names[info.index];
              setHoverInfo({ x: info.x, y: info.y, name });
              setHoveredName(name);
            } else {
              setHoverInfo(null);
              setHoveredName(null);
            }
          },
          onClick: (info) => {
            if (info.index >= 0) {
              setSelectedRiverName(riverData.names[info.index]);
            }
          },
        }),
      );
    }
    if (hoveredName && geojson) {
      const matchingPaths = geojson.features
        .filter((f) => {
          const name = f.properties?.name;
          return (
            name &&
            name.split(" |").some((part) => part.trim() === hoveredName)
          );
        })
        .map((f) => ({ path: f.geometry.coordinates.map(([x, y]) => [x, y]) }));
      if (matchingPaths.length) {
        result.push(
          new PathLayer({
            id: "river-highlight",
            data: matchingPaths,
            getPath: (d) => d.path,
            getColor: [255, 255, 255, 150],
            getWidth: 2,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            pickable: false,
          }),
        );
      }
    }
    if (lakes) {
      result.push(
        new SolidPolygonLayer({
          id: "lakes",
          data: lakes.features,
          getPolygon: (d) => d.geometry.coordinates,
          getFillColor: [60, 120, 200, 255],
          extruded: false,
          pickable: true,
          onHover: (info) => {
            if (info.object) {
              const name = info.object.properties?.name ?? null;
              setHoverInfo({ x: info.x, y: info.y, name });
              setHoveredLake(info.object);
            } else {
              setHoverInfo(null);
              setHoveredLake(null);
            }
          },
        }),
      );
    }
    if (hoveredLake) {
      result.push(
        new PathLayer({
          id: "lake-highlight",
          data: hoveredLake.geometry.coordinates.map((ring) => ({ path: ring })),
          getPath: (d) => d.path,
          getColor: [255, 255, 255, 200],
          getWidth: 1,
          widthUnits: "pixels",
          pickable: false,
        }),
      );
    }
    return result;
  }, [riverData, lakes, viewState.zoom, hoveredName, geojson, hoveredLake]);

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        background: "#333333",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState }) => setViewState(viewState)}
ß        controller={{ minZoom: 7, maxZoom: 12 }}
        layers={layers}
        pickingRadius={10}
      >
        <Map mapStyle={MAP_STYLE} />
      </DeckGL>
      {selectedRiverName && geojson && (
        <ElevationModal
          name={selectedRiverName}
          geojson={geojson}
          onClose={() => setSelectedRiverName(null)}
        />
      )}
      {hoverInfo && hoverInfo.name && (
        <div
          style={{
            position: "absolute",
            left: hoverInfo.x + 12,
            top: hoverInfo.y + 12,
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            padding: "4px 10px",
            borderRadius: 4,
            fontSize: 13,
            pointerEvents: "none",
          }}
        >
          {hoverInfo.name}
        </div>
      )}
    </div>
  );
};

export default SwissRiversDeckGL;
