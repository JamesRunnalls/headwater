import React, { useState, useEffect, useMemo } from "react";
import { Map as MapGL } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import DeckGL from "@deck.gl/react";
import { PathLayer, SolidPolygonLayer } from "@deck.gl/layers";
import CONFIG from "../../config.json";
import "./home.css";
import ElevationModal from "../../components/ElevationModal/ElevationModal";
import LakeGlacierModal from "../../components/LakeGlacierModal/LakeGlacierModal";
import { processGeoJson } from "./functions";

const ANIMATE = true; // set to false to skip all animation and show everything immediately
const WAVE_WIDTH = 120; // meters — width of the soft leading edge

const INITIAL_VIEW_STATE = {
  longitude: 8.2,
  latitude: 46.8,
  zoom: window.innerWidth <= 768 ? 6.5 : 7.5,
  pitch: 0,
  bearing: 0,
};

const MAP_STYLE = {
  version: 8,
  sources: {
    "local-tiles": {
      type: "raster",
      tiles: [CONFIG.tiles],
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
      paint: { "background-color": "#343434" },
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
  const [hoveredRiverId, setHoveredRiverId] = useState(null);
  const [hoveredLake, setHoveredLake] = useState(null);
  const [hoveredGlacier, setHoveredGlacier] = useState(null);
  const [selectedRiverName, setSelectedRiverName] = useState(null);
  const [selectedLake, setSelectedLake] = useState(null);
  const [selectedGlacier, setSelectedGlacier] = useState(null);
  const [renderTick, setRenderTick] = useState(0);
  const [mapIdle, setMapIdle] = useState(false);
  const [phase, setPhase] = useState(ANIMATE ? "loading" : "animating");
  const [titleVisible, setTitleVisible] = useState(true);
  const [mapInteractive, setMapInteractive] = useState(false);

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
    const data = processGeoJson(geojson);
    if (!ANIMATE) {
      const { colors, totalVertices } = data;
      for (let i = 0; i < totalVertices; i++) {
        colors[i * 4]     = 70;
        colors[i * 4 + 1] = 117;
        colors[i * 4 + 2] = 134;
        colors[i * 4 + 3] = 255;
      }
    }
    return data;
  }, [geojson]);

  const riverConnectivity = useMemo(() => {
    if (!geojson) return null;
    const upstream = new Map();
    const downstream = new Map();
    for (const f of geojson.features) {
      const id = f.properties.id;
      const downId = f.properties.downstream_river_id ??
        (f.properties.downstream_lake_key ? f.properties.lake_outflow_river_id : null);
      downstream.set(id, downId);
      if (downId !== null) {
        if (!upstream.has(downId)) upstream.set(downId, []);
        upstream.get(downId).push(id);
      }
    }
    return { upstream, downstream };
  }, [geojson]);

  useEffect(() => {
    if (ANIMATE && mapIdle && geojson && lakes && glaciers) setPhase("fading");
  }, [mapIdle, geojson, lakes, glaciers]);

  useEffect(() => {
    if (phase !== "animating") return;
    const DURATION_MS = 8000;
    const titleId = setTimeout(() => setTitleVisible(false), Math.max(0, DURATION_MS - 6000));
    const interactId = setTimeout(() => setMapInteractive(true), DURATION_MS - 4000);
    return () => {
      clearTimeout(titleId);
      clearTimeout(interactId);
    };
  }, [phase]);

  useEffect(() => {
    if (!ANIMATE || !riverData || phase !== "animating") return;
    const DURATION_MS = 8000;
    const startTime = performance.now();
    const { maxGlobalElev, minGlobalElev, colors, vertexElevations, totalVertices } = riverData;
    const range = maxGlobalElev - minGlobalElev;
    const animStart = maxGlobalElev - range * 0.2; // skip top 20% of elevation
    const animRange = animStart - minGlobalElev;
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    let rafId;
    const animate = (now) => {
      const rawT = Math.min((now - startTime) / DURATION_MS, 1);
      const threshold = animStart - easeOut(rawT) * animRange;
      for (let i = 0; i < totalVertices; i++) {
        const distFromFront = vertexElevations[i] - (threshold - WAVE_WIDTH);
        const t = Math.max(0, Math.min(1, distFromFront / WAVE_WIDTH));
        colors[i * 4]     = Math.round(70  + (1 - t) * 185);
        colors[i * 4 + 1] = Math.round(117 + (1 - t) * 138);
        colors[i * 4 + 2] = Math.round(134 + (1 - t) * 121);
        colors[i * 4 + 3] = Math.round(t * 255);
      }
      setRenderTick((v) => v + 1);
      if (rawT < 1) rafId = requestAnimationFrame(animate);
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

      result.push(
        new PathLayer({
          id: "rivers",
          data: {
            ...riverData,
            attributes: {
              getPath: riverData.attributes.getPath,
              getColor: { value: riverData.colors, size: 4 },
            },
          },
          updateTriggers: { getColor: [renderTick] },
          getWidth: (_, { index }) => riverData.widths[index],
          widthScale,
          widthUnits: "meters",
          widthMinPixels: 1,
          widthMaxPixels: 28,
          capRounded: true,
          jointRounded: true,
          pickable: true,
          onHover: (info) => {
            if (info.index >= 0) {
              const name = riverData.names[info.index];
              setHoverInfo({ x: info.x, y: info.y, name, clickable: !!name });
              setHoveredName(name);
              setHoveredRiverId(geojson.features[info.index]?.properties?.id ?? null);
            } else {
              setHoverInfo(null);
              setHoveredName(null);
              setHoveredRiverId(null);
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
    if (hoveredName && hoveredRiverId !== null && geojson && riverConnectivity) {
      const { upstream, downstream } = riverConnectivity;
      const visited = new Set();
      const queue = [hoveredRiverId];
      while (queue.length) {
        const id = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        const downId = downstream.get(id);
        if (downId != null && !visited.has(downId)) queue.push(downId);
        for (const upId of upstream.get(id) ?? []) {
          if (!visited.has(upId)) queue.push(upId);
        }
      }
      const matchingPaths = geojson.features
        .filter((f) => {
          const name = f.properties?.name;
          return (
            visited.has(f.properties.id) &&
            name?.split(" |").some((part) => part.trim() === hoveredName)
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
              setHoverInfo({ x: info.x, y: info.y, name, clickable: true });
              setHoveredLake(info.object);
            } else {
              setHoverInfo(null);
              setHoveredLake(null);
            }
          },
          onClick: (info) => {
            if (info.object) {
              setSelectedLake(info.object.properties);
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
              setHoverInfo({ x: info.x, y: info.y, name, clickable: true });
              setHoveredGlacier(info.object);
            } else {
              setHoverInfo(null);
              setHoveredGlacier(null);
            }
          },
          onClick: (info) => {
            if (info.object) {
              setSelectedGlacier(info.object.properties);
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
  }, [riverData, lakes, glaciers, viewState.zoom, hoveredName, hoveredRiverId, geojson, hoveredLake, hoveredGlacier, renderTick, riverConnectivity]);

  return (
    <div className="map-root">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState }) => setViewState(viewState)}
ß        controller={{ minZoom: 6, maxZoom: 12 }}
        layers={layers}
        pickingRadius={10}
        getCursor={({ isDragging, isHovering }) => isDragging ? "grabbing" : isHovering ? "pointer" : "grab"}
      >
        <MapGL mapStyle={MAP_STYLE} onIdle={() => setMapIdle(true)} />
      </DeckGL>
      {phase !== "animating" && (
        <div
          className="loading-overlay"
          onTransitionEnd={() => setPhase("animating")}
          style={{
            opacity: phase === "fading" ? 0 : 1,
            pointerEvents: phase === "loading" ? "auto" : "none",
          }}
        >
          <div className="loading-spinner" />
          <div className="loading-label">LOADING HEADWATER</div>
        </div>
      )}
      {selectedRiverName && geojson && (
        <ElevationModal
          name={selectedRiverName}
          geojson={geojson}
          onClose={() => setSelectedRiverName(null)}
        />
      )}
      {selectedLake && (
        <LakeGlacierModal
          type="lake"
          properties={selectedLake}
          onClose={() => setSelectedLake(null)}
        />
      )}
      {selectedGlacier && (
        <LakeGlacierModal
          type="glacier"
          properties={selectedGlacier}
          onClose={() => setSelectedGlacier(null)}
        />
      )}
      {!mapInteractive && (
        <div style={{ position: "absolute", inset: 0, zIndex: 4 }} />
      )}
      <div className="ui-overlay">
        <div className="top-rule" style={{ opacity: titleVisible ? 1 : 0 }} />
        <div className="title-block" style={{ opacity: titleVisible ? 1 : 0 }}>
          <div className="title-main">Headwater</div>
          <div className="title-sub">RIVERS · LAKES · GLACIERS</div>
          <div className="title-tagline">An interactive exploration of the Swiss hydrological network</div>
        </div>
        <div className="legend">
          <div className="legend-items">
            <span className="legend-item">
              <span className="legend-swatch-river" />
              RIVERS
            </span>
            <span className="legend-item">
              <span className="legend-swatch-lake" />
              LAKES
            </span>
            <span className="legend-item">
              <span className="legend-swatch-glacier" />
              GLACIERS
            </span>
          </div>
        </div>
      </div>

      <div className="corner-frame">
        <div className="corner corner-tl" />
        <div className="corner corner-tr" />
        <div className="corner corner-bl" />
        <div className="corner corner-br" />
      </div>

      {hoverInfo && hoverInfo.name && (
        <div
          className="hover-tooltip"
          style={{ left: hoverInfo.x + 12, top: hoverInfo.y + 12 }}
        >
          {hoverInfo.name}
        </div>
      )}
    </div>
  );
};

export default SwissRiversDeckGL;
