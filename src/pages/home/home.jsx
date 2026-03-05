import React, { useState, useEffect, useMemo } from "react";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import DeckGL from "@deck.gl/react";
import { PathLayer, SolidPolygonLayer } from "@deck.gl/layers";
import "./home.css";
import ElevationModal from "./ElevationModal";

const ANIMATE = true; // set to false to skip all animation and show everything immediately

// Build binary attribute buffers for PathLayer.
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
  const vertexElevations = new Float32Array(totalVertices);
  const startIndices = new Uint32Array(n + 1); // +1 for sentinel
  const widths = new Float32Array(n);
  const names = new Array(n);
  const elevations = new Float32Array(n);
  let maxGlobalElev = -Infinity;
  let minGlobalElev = Infinity;

  let vo = 0; // vertex offset into flat arrays

  for (let fi = 0; fi < n; fi++) {
    const feature = features[fi];
    startIndices[fi] = vo;
    names[fi] = feature.properties?.name ?? null;
    if (names[fi] && names[fi].includes(" |")) {
      names[fi] = names[fi].split(" |")[0];
    }

    const sourceElev = feature.geometry.coordinates[0]?.[2] ?? 0;
    elevations[fi] = sourceElev;
    if (sourceElev > maxGlobalElev) maxGlobalElev = sourceElev;
    if (sourceElev < minGlobalElev) minGlobalElev = sourceElev;

    for (const coord of feature.geometry.coordinates) {
      vertexElevations[vo] = coord[2] ?? 0;
      positions[vo * 2] = coord[0];
      positions[vo * 2 + 1] = coord[1];
      vo++;
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
    },
    widths,
    names,
    elevations,
    maxGlobalElev,
    minGlobalElev,
    vertexElevations,
    totalVertices,
  };
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
      tiles: ["https://pub-7ff8d4bb7f1b4656a69d50b620c6e05f.r2.dev/tiles_v5/{z}/{x}/{y}.png"],
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
      paint: { "background-color": "#434343" },
    },
    {
      id: "local-tiles",
      type: "raster",
      source: "local-tiles",
    },
  ],
};


const SwissRiversDeckGL = () => {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [geojson, setGeojson] = useState(null);
  const [lakes, setLakes] = useState(null);
  const [glaciers, setGlaciers] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [hoveredName, setHoveredName] = useState(null);
  const [hoveredLake, setHoveredLake] = useState(null);
  const [hoveredGlacier, setHoveredGlacier] = useState(null);
  const [selectedRiverName, setSelectedRiverName] = useState(null);
  const [animThreshold, setAnimThreshold] = useState(ANIMATE ? Infinity : null);
  const [mapIdle, setMapIdle] = useState(false);
  const [phase, setPhase] = useState(ANIMATE ? "loading" : "animating");

  useEffect(() => {
    fetch("/geodata/outputs/rivers.geojson")
      .then((res) => res.json())
      .then(setGeojson);
    fetch("/geodata/outputs/lakes.geojson")
      .then((res) => res.json())
      .then(setLakes);
    fetch("/geodata/outputs/glaciers.geojson")
      .then((res) => res.json())
      .then((data) => {
        const features = data.features.flatMap((f) => {
          if (f.geometry.type === "MultiPolygon") {
            return f.geometry.coordinates.map((coords) => ({
              ...f,
              geometry: { type: "Polygon", coordinates: coords },
            }));
          }
          return [f];
        });
        setGlaciers({ ...data, features });
      });
  }, []);

  const riverData = useMemo(() => {
    if (!geojson) return null;
    return processGeoJson(geojson);
  }, [geojson]);

  useEffect(() => {
    if (ANIMATE && mapIdle && geojson && lakes && glaciers) setPhase("fading");
  }, [mapIdle, geojson, lakes, glaciers]);

  useEffect(() => {
    if (!ANIMATE || !riverData || phase !== "animating") return;
    const DURATION_MS = 8000;
    const startTime = performance.now();
    const { maxGlobalElev, minGlobalElev } = riverData;
    const range = maxGlobalElev - minGlobalElev;
    const animStart = maxGlobalElev - range * 0.2; // skip top 20% of elevation
    const animRange = animStart - minGlobalElev;
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    let rafId;
    const animate = (now) => {
      const rawT = Math.min((now - startTime) / DURATION_MS, 1);
      setAnimThreshold(animStart - easeOut(rawT) * animRange);
      if (rawT < 1) {
        rafId = requestAnimationFrame(animate);
      } else {
        setAnimThreshold(null);
      }
    };
    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [riverData, phase]);

  const layers = useMemo(() => {
    const result = [];
    if (riverData) {
      // widthScale cancels the zoom doubling so rivers stay a consistent screen size
      const widthScale =
        1 / Math.pow(2, viewState.zoom - INITIAL_VIEW_STATE.zoom);

      const WAVE_WIDTH = 200; // meters — width of the soft leading edge
      const colors = new Uint8Array(riverData.totalVertices * 4);
      for (let i = 0; i < riverData.totalVertices; i++) {
        if (animThreshold === null) {
          colors[i * 4]     = 70;
          colors[i * 4 + 1] = 150;
          colors[i * 4 + 2] = 220;
          colors[i * 4 + 3] = 255;
        } else {
          const distFromFront = riverData.vertexElevations[i] - (animThreshold - WAVE_WIDTH);
          const t = Math.max(0, Math.min(1, distFromFront / WAVE_WIDTH));
          colors[i * 4]     = Math.round(70  + (1 - t) * 185); // R: 70 → 255
          colors[i * 4 + 1] = Math.round(150 + (1 - t) * 105); // G: 150 → 255
          colors[i * 4 + 2] = 220;                              // B: constant
          colors[i * 4 + 3] = Math.round(t * 255);             // alpha: 0 → 255
        }
      }

      result.push(
        new PathLayer({
          id: "rivers",
          data: {
            ...riverData,
            attributes: {
              getPath: riverData.attributes.getPath,
              getColor: { value: colors, size: 4 },
            },
          },
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
          getFillColor: [0, 0, 0, 0],
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
    if (glaciers) {
      result.push(
        new SolidPolygonLayer({
          id: "glaciers",
          data: glaciers.features,
          getPolygon: (d) => d.geometry.coordinates,
          getFillColor: [0, 0, 0, 0],
          extruded: false,
          pickable: true,
          onHover: (info) => {
            if (info.object) {
              const name = info.object.properties?.name ?? null;
              setHoverInfo({ x: info.x, y: info.y, name });
              setHoveredGlacier(info.object);
            } else {
              setHoverInfo(null);
              setHoveredGlacier(null);
            }
          },
        }),
      );
    }
    if (hoveredGlacier) {
      result.push(
        new PathLayer({
          id: "glacier-highlight",
          data: hoveredGlacier.geometry.coordinates.map((ring) => ({ path: ring })),
          getPath: (d) => d.path,
          getColor: [255, 255, 255, 200],
          getWidth: 1,
          widthUnits: "pixels",
          pickable: false,
        }),
      );
    }
    return result;
  }, [riverData, lakes, glaciers, viewState.zoom, hoveredName, geojson, hoveredLake, hoveredGlacier, animThreshold]);

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
        <Map mapStyle={MAP_STYLE} onIdle={() => setMapIdle(true)} />
      </DeckGL>
      {phase !== "animating" && (
        <div
          onTransitionEnd={() => setPhase("animating")}
          style={{
            position: "absolute",
            inset: 0,
            background: "#333333",
            opacity: phase === "fading" ? 0 : 1,
            transition: "opacity 1.5s ease",
            zIndex: 10,
            pointerEvents: phase === "loading" ? "auto" : "none",
          }}
        />
      )}
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
