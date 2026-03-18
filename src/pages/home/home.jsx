import React, { useState, useEffect, useMemo, useRef } from "react";
import { Map as MapGL } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import DeckGL from "@deck.gl/react";
import { PathLayer, SolidPolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import { WebMercatorViewport, FlyToInterpolator } from "@deck.gl/core";
import CONFIG from "../../config.json";
import "./home.css";
import RiverModal from "../../components/RiverModal/RiverModal";
import LakeModal from "../../components/LakeModal/LakeModal";
import GlacierModal from "../../components/GlacierModal/GlacierModal";
import { processGeoJson } from "./functions";
import translations from "../../translations";
import AboutModal from "../../components/AboutModal/AboutModal";

const SUPPORTS_DASH = (() => {
  try {
    const canvas = document.createElement("canvas");
    return !!canvas.getContext("webgl2");
  } catch (_) {
    return false;
  }
})();

const GLACIER_YEAR_COLORS = {
  1850: [220, 80, 80],
  1931: [220, 150, 60],
  1973: [200, 200, 80],
  2010: [80, 190, 200],
  2016: [255, 255, 255],
};

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


const SwissRiversDeckGL = ({ language = "EN", languages = ["EN", "DE", "FR", "IT"], setLanguage }) => {
  const t = translations[language] ?? translations.EN;
  const [showAbout, setShowAbout] = useState(false);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [geojson, setGeojson] = useState(null);
  const [lakes, setLakes] = useState(null);
  const [glaciers, setGlaciers] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [hoveredName, setHoveredName] = useState(null);
  const [hoveredRiverId, setHoveredRiverId] = useState(null);
  const [hoveredTributaryName, setHoveredTributaryName] = useState(null);
  const [hoveredTributaryId, setHoveredTributaryId] = useState(null);
  const [hoveredLake, setHoveredLake] = useState(null);
  const [hoveredGlacier, setHoveredGlacier] = useState(null);
  const [selectedRiverName, setSelectedRiverName] = useState(null);
  const [riverHoverCoord, setRiverHoverCoord] = useState(null);
  const [mapHoverCoord, setMapHoverCoord] = useState(null);
  const [visibleSection, setVisibleSection] = useState(null);
  const [selectedLake, setSelectedLake] = useState(null);
  const [selectedGlacier, setSelectedGlacier] = useState(null);
  const [glacierHistory, setGlacierHistory] = useState(null);
  const [renderTick, setRenderTick] = useState(0);

  const clearHover = () => {
    setHoveredName(null);
    setHoveredRiverId(null);
    setHoveredTributaryName(null);
    setHoveredTributaryId(null);
    setHoveredLake(null);
    setHoveredGlacier(null);
    setHoverInfo(null);
    setMapHoverCoord(null);
  };
  const [mapIdle, setMapIdle] = useState(false);
  const [phase, setPhase] = useState(ANIMATE ? "loading" : "animating");
  const [animationStarted, setAnimationStarted] = useState(!ANIMATE);
  const [titleVisible, setTitleVisible] = useState(true);
  const [mapInteractive, setMapInteractive] = useState(false);
  const mapInteractiveRef = useRef(false);
  useEffect(() => { mapInteractiveRef.current = mapInteractive; }, [mapInteractive]);

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

  useEffect(() => {
    if (!selectedGlacier) { setGlacierHistory(null); return; }
    const sgiId = selectedGlacier["sgi-id"];
    if (!sgiId) { setGlacierHistory(null); return; }
    fetch(`/geodata/outputs/glaciers/${sgiId}.geojson`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          const features = [...data.features].sort((a, b) => a.properties.year - b.properties.year);
          setGlacierHistory({ ...data, features });
        } else {
          setGlacierHistory(null);
        }
      })
      .catch(() => setGlacierHistory(null));
  }, [selectedGlacier]);

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
    if (ANIMATE && mapIdle && geojson && lakes && glaciers) { setPhase("fading"); setAnimationStarted(true); }
  }, [mapIdle, geojson, lakes, glaciers]);

  // Auto-zoom to selected feature, fitting within the top half of the screen
  useEffect(() => {
    let coords = [];
    if (selectedRiverName && geojson) {
      const features = geojson.features.filter((f) => {
        const n = f.properties?.name;
        return n && n.split(" |").some((p) => p.trim() === selectedRiverName);
      });
      coords = features.flatMap((f) => f.geometry.coordinates).map((c) => [c[0], c[1]]);
    } else if (selectedLake && lakes) {
      const feature = lakes.features.find((f) => f.properties?.key === selectedLake.key);
      if (feature) {
        const rings = feature.geometry.type === "MultiPolygon"
          ? feature.geometry.coordinates.flat(1)
          : feature.geometry.coordinates;
        coords = rings.flat(1);
      }
    } else if (selectedGlacier && glaciers) {
      const feature = glaciers.features.find((f) => f.properties?.name === selectedGlacier.name);
      if (feature) coords = feature.geometry.coordinates.flat(1);
    }
    if (coords.length < 2) return;
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    try {
      const vp = new WebMercatorViewport({ width: window.innerWidth, height: window.innerHeight });
      const { longitude, latitude, zoom } = vp.fitBounds(
        [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: selectedLake || selectedGlacier
            ? { top: 80, bottom: 80, left: 80, right: 350 + 20 + 60 }
            : { top: 60, bottom: window.innerHeight * 0.5 + 80, left: 80, right: 80 } }
      );
      setViewState((prev) => ({
        ...prev,
        longitude,
        latitude,
        zoom: Math.min(zoom, 12),
        transitionDuration: 1000,
        transitionInterpolator: new FlyToInterpolator(),
      }));
    } catch (_) {}
  }, [selectedRiverName, selectedLake, selectedGlacier]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!animationStarted) return;
    const DURATION_MS = 9000;
    const titleId = setTimeout(() => setTitleVisible(false), Math.max(0, DURATION_MS - 6000));
    const interactId = setTimeout(() => setMapInteractive(true), DURATION_MS - 4000);
    return () => {
      clearTimeout(titleId);
      clearTimeout(interactId);
    };
  }, [animationStarted]);

  useEffect(() => {
    if (!ANIMATE || !riverData || !animationStarted) return;
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
  }, [riverData, animationStarted]);

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
            if (!mapInteractiveRef.current) return;
            if (info.index >= 0) {
              const name = riverData.names[info.index];
              setHoverInfo({ x: info.x, y: info.y, name, clickable: !!name });
              setHoveredName(name);
              setHoveredRiverId(geojson.features[info.index]?.properties?.id ?? null);
              if (name === selectedRiverName && info.coordinate) {
                setMapHoverCoord([info.coordinate[0], info.coordinate[1]]);
              } else {
                setMapHoverCoord(null);
                setRiverHoverCoord(null);
              }
            } else {
              setHoverInfo(null);
              setHoveredName(null);
              setHoveredRiverId(null);
              setMapHoverCoord(null);
            }
          },
          onClick: (info) => {
            if (!mapInteractiveRef.current) return;
            if (info.index >= 0) {
              setSelectedRiverName(riverData.names[info.index]);
              setSelectedLake(null);
              setSelectedGlacier(null);
            }
          },
        }),
      );
    }
    const getHighlightPaths = (name, riverId) => {
      if (!name || riverId === null || !geojson || !riverConnectivity) return [];
      const { upstream, downstream } = riverConnectivity;
      const visited = new Set();
      const queue = [riverId];
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
      return geojson.features
        .filter((f) => {
          const n = f.properties?.name;
          return visited.has(f.properties.id) && n?.split(" |").some((p) => p.trim() === name);
        })
        .map((f) => ({ path: f.geometry.coordinates.map(([x, y]) => [x, y]) }));
    };

    const selectedRiverId = selectedRiverName && geojson
      ? geojson.features.find((f) => {
          const n = f.properties?.name;
          return n && n.split(" |").some((p) => p.trim() === selectedRiverName);
        })?.properties?.id ?? null
      : null;

    const highlightPaths = [
      ...getHighlightPaths(selectedRiverName, selectedRiverId),
      ...(hoveredName && hoveredName !== selectedRiverName
        ? getHighlightPaths(hoveredName, hoveredRiverId)
        : []),
    ];
    if (highlightPaths.length) {
      result.push(
        new PathLayer({
          id: "river-highlight",
          data: highlightPaths,
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
    const tributaryPaths = hoveredTributaryName ? getHighlightPaths(hoveredTributaryName, hoveredTributaryId) : [];
    if (tributaryPaths.length) {
      result.push(
        new PathLayer({
          id: "river-tributary-highlight",
          data: tributaryPaths,
          getPath: (d) => d.path,
          getColor: [255, 255, 255, 200],
          getWidth: 2,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          pickable: false,
        }),
      );
    }
    if (visibleSection && visibleSection.length) {
      result.push(
        new PathLayer({
          id: "river-visible-section",
          data: visibleSection.map((path) => ({ path })),
          getPath: (d) => d.path,
          getColor: [255, 255, 255, 150],
          getWidth: 3,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          pickable: false,
        }),
      );
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
            if (!mapInteractiveRef.current) return;
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
            if (!mapInteractiveRef.current) return;
            if (info.object) {
              setSelectedLake(info.object.properties);
              setSelectedRiverName(null);
              setRiverHoverCoord(null);
              setSelectedGlacier(null);
            }
          },
        }),
      );
    }
    const hlLake = hoveredLake
      ?? (selectedLake && lakes ? lakes.features.find((f) => f.properties?.key === selectedLake.key) : null);
    if (hlLake) {
      result.push(
        new PathLayer({
          id: "lake-highlight",
          data: hlLake.geometry.coordinates.map((ring) => ({ path: ring })),
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
            if (!mapInteractiveRef.current) return;
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
            if (!mapInteractiveRef.current) return;
            if (info.object) {
              setSelectedGlacier(info.object.properties);
              setSelectedRiverName(null);
              setRiverHoverCoord(null);
              setSelectedLake(null);
            }
          },
        }),
      );
    }
    const chaikin = (pts, iterations = 3) => {
      let out = pts;
      for (let i = 0; i < iterations; i++) {
        const next = [];
        for (let j = 0; j < out.length - 1; j++) {
          const [x0, y0] = out[j];
          const [x1, y1] = out[j + 1];
          next.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
          next.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
        }
        next.push(next[0]);
        out = next;
      }
      return out;
    };
    if (hoveredGlacier) {
      result.push(
        new PathLayer({
          id: "glacier-highlight",
          data: hoveredGlacier.geometry.coordinates.map((ring) => ({ path: chaikin(ring) })),
          getPath: (d) => d.path,
          getColor: [255, 255, 255, 200],
          getWidth: 1,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          pickable: false,
        }),
      );
    }
    if (glacierHistory) {
      const years = glacierHistory.features.map((f) => f.properties.year);
      const lastYear = years[years.length - 1];
      const pathData = glacierHistory.features.flatMap((f) => {
        const year = f.properties.year;
        const isLast = year === lastYear;
        const color = GLACIER_YEAR_COLORS[year] ?? [255, 255, 255];
        const opacity = isLast ? 230 : 190;
        const rings = f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat();
        return rings.map((ring) => ({ path: chaikin(ring), color: [...color, opacity], dash: isLast ? [0, 0] : [6, 4] }));
      });
      result.push(
        new PathLayer({
          id: "glacier-history",
          data: pathData,
          getPath: (d) => d.path,
          getColor: (d) => d.color,
          getWidth: 1.5,
          widthUnits: "pixels",
          ...(SUPPORTS_DASH ? {
            getDashArray: (d) => d.dash,
            dashJustified: true,
            extensions: [new PathStyleExtension({ dash: true })],
          } : {}),
          capRounded: true,
          jointRounded: true,
          pickable: false,
        }),
      );
    } else if (selectedGlacier && glaciers && !hoveredGlacier) {
      const hlFeatures = glaciers.features.filter((f) => f.properties?.name === selectedGlacier.name);
      if (hlFeatures.length) {
        result.push(
          new PathLayer({
            id: "glacier-highlight",
            data: hlFeatures.flatMap((f) => f.geometry.coordinates.map((ring) => ({ path: chaikin(ring) }))),
            getPath: (d) => d.path,
            getColor: [255, 255, 255, 200],
            getWidth: 1,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            pickable: false,
          }),
        );
      }
    }
    if (riverHoverCoord) {
      result.push(
        new ScatterplotLayer({
          id: "river-hover-dot-glow2",
          data: [{ position: riverHoverCoord }],
          getPosition: (d) => d.position,
          getRadius: 8,
          radiusUnits: "pixels",
          getFillColor: [255, 255, 255, 20],
          stroked: false,
          pickable: false,
        }),
        new ScatterplotLayer({
          id: "river-hover-dot-glow1",
          data: [{ position: riverHoverCoord }],
          getPosition: (d) => d.position,
          getRadius: 5,
          radiusUnits: "pixels",
          getFillColor: [255, 255, 255, 50],
          stroked: false,
          pickable: false,
        }),
        new ScatterplotLayer({
          id: "river-hover-dot",
          data: [{ position: riverHoverCoord }],
          getPosition: (d) => d.position,
          getRadius: 4,
          radiusUnits: "pixels",
          getFillColor: [255, 255, 255, 230],
          stroked: false,
          pickable: false,
        }),
      );
    }
    return result;
  }, [riverData, lakes, glaciers, viewState.zoom, hoveredName, hoveredRiverId, hoveredTributaryName, hoveredTributaryId, geojson, hoveredLake, hoveredGlacier, renderTick, riverConnectivity, riverHoverCoord, selectedRiverName, selectedLake, selectedGlacier, visibleSection, glacierHistory]);

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
          <div className="loading-label">{t.loading}</div>
        </div>
      )}
      {selectedRiverName && geojson && (
        <RiverModal
          name={selectedRiverName}
          geojson={geojson}
          lakes={lakes}
          t={t}
          onHoverCoord={setRiverHoverCoord}
          onSelectRiver={setSelectedRiverName}
          onSelectLake={setSelectedLake}
          mapHoverCoord={mapHoverCoord}
          onMouseEnter={clearHover}
          onHoverTributary={(tributaryName) => {
            setHoveredTributaryName(tributaryName);
            setHoveredTributaryId(tributaryName && geojson
              ? geojson.features.find((f) => {
                  const n = f.properties?.name;
                  return n && n.split(" |").some((p) => p.trim() === tributaryName);
                })?.properties?.id ?? null
              : null);
          }}
          onVisibleSection={setVisibleSection}
          onClose={() => { setSelectedRiverName(null); setRiverHoverCoord(null); setMapHoverCoord(null); setVisibleSection(null); }}
        />
      )}
      {selectedLake && (
        <LakeModal
          properties={selectedLake}
          t={t}
          onMouseEnter={clearHover}
          onClose={() => setSelectedLake(null)}
        />
      )}
      {selectedGlacier && (
        <GlacierModal
          properties={selectedGlacier}
          t={t}
          onMouseEnter={clearHover}
          onClose={() => setSelectedGlacier(null)}
        />
      )}

      <div className="feature-info-stack">
        {(selectedRiverName || selectedLake || selectedGlacier) && (
          <div className="feature-label">
            <div className="feature-label-type">
              {selectedRiverName ? t.river : selectedLake ? t.lake : t.glacier}
            </div>
            <div className="feature-label-name">
              {selectedRiverName || selectedLake?.name || selectedGlacier?.name}
            </div>
          </div>
        )}

        {glacierHistory && (
          <div className="glacier-year-legend">
            {[...glacierHistory.features].reverse().map((f) => {
              const year = f.properties.year;
              const [r, g, b] = GLACIER_YEAR_COLORS[year] ?? [255, 255, 255];
              const isLast = year === glacierHistory.features[glacierHistory.features.length - 1].properties.year;
              return (
                <div key={year} className="glacier-year-legend-item">
                  <svg width="28" height="10" className="glacier-year-swatch">
                    <line
                      x1="0" y1="5" x2="28" y2="5"
                      stroke={`rgb(${r},${g},${b})`}
                      strokeWidth="1.5"
                      strokeDasharray={isLast ? "none" : "6 4"}
                    />
                  </svg>
                  <span style={{ color: `rgb(${r},${g},${b})` }}>{year}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="ui-overlay">
        <div className="top-rule" style={{ opacity: titleVisible ? 1 : 0 }} />
        <div className="title-block" style={{ opacity: titleVisible ? 1 : 0 }}>
          <div className="title-main">{t.title}</div>
          <div className="title-sub">{t.subtitle}</div>
          <div className="title-tagline">{t.tagline}</div>
        </div>
        <div className="legend">
          <div className="legend-items">
            <span className="legend-item">
              <span className="legend-swatch-river" />
              {t.rivers}
            </span>
            <span className="legend-item">
              <span className="legend-swatch-lake" />
              {t.lakes}
            </span>
            <span className="legend-item">
              <span className="legend-swatch-glacier" />
              {t.glaciers}
            </span>
          </div>
        </div>
      </div>

      <button className="about-btn" onClick={() => setShowAbout(true)} style={{ visibility: phase === "loading" ? "hidden" : "visible" }}>
        {t.about}
      </button>

      <div className="lang-switcher" style={{ visibility: phase === "loading" ? "hidden" : "visible" }}>
        {languages.map(lang => (
          <button
            key={lang}
            className={`lang-btn${language === lang ? " active" : ""}`}
            onClick={() => setLanguage({ target: { value: lang } })}
          >{lang}</button>
        ))}
      </div>

      {showAbout && <AboutModal t={t} onMouseEnter={clearHover} onClose={() => setShowAbout(false)} />}

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
