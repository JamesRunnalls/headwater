import React, { useState, useEffect, useMemo, useRef } from "react";
import { Map as MapGL, Source, Layer } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import DeckGL from "@deck.gl/react";
import { PathLayer, SolidPolygonLayer, ScatterplotLayer, IconLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import { WebMercatorViewport, FlyToInterpolator } from "@deck.gl/core";
import CONFIG from "../../config.json";
import "./home.css";
import RiverModal from "../../components/RiverModal/RiverModal";
import NatureModal from "../../components/NatureModal/NatureModal";
import { processGeoJson } from "./functions";
import translations from "../../translations";
import AboutModal from "../../components/AboutModal/AboutModal";
import InfraModal from "../../components/InfraModal/InfraModal";

const makeIconAtlas = (drawFn) => {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  drawFn(ctx);
  return canvas.toDataURL("image/png");
};

const DAM_ATLAS = makeIconAtlas((ctx) => {
  ctx.beginPath();
  ctx.moveTo(12, 4); ctx.lineTo(20, 4); ctx.lineTo(24, 28); ctx.lineTo(8, 28);
  ctx.closePath();
  ctx.fill();
});
const DAM_ICON_MAPPING = { dam: { x: 0, y: 0, width: 32, height: 32, mask: true } };

const POWER_ATLAS = makeIconAtlas((ctx) => {
  ctx.beginPath();
  ctx.moveTo(19, 2); ctx.lineTo(8, 18); ctx.lineTo(16, 18); ctx.lineTo(12, 30); ctx.lineTo(24, 14); ctx.lineTo(16, 14);
  ctx.closePath();
  ctx.fill();
});
const POWER_ICON_MAPPING = { power: { x: 0, y: 0, width: 32, height: 32, mask: true } };

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
      tiles: [`${CONFIG.bucket}/${CONFIG.basemap}/{z}/{x}/{y}.png`],
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
  const [dams, setDams] = useState(null);
  const [powerStations, setPowerStations] = useState(null);
  const [selectedDam, setSelectedDam] = useState(null);
  const [selectedPowerStation, setSelectedPowerStation] = useState(null);
  const [hoveredDamName, setHoveredDamName] = useState(null);
  const [hoveredPowerStationName, setHoveredPowerStationName] = useState(null);
  const [glacierHistory, setGlacierHistory] = useState(null);
  const [renderTick, setRenderTick] = useState(0);
  const HILLSHADE_FADE_MS = 800;
  const [hillshadeKey, setHillshadeKey] = useState(null);
  const [hillshadeOpacity, setHillshadeOpacity] = useState(0);
  const hillshadeTimerRef = useRef(null);
  const hillshadePendingRef = useRef(false);
  const mapRef = useRef(null);
  const hillshadeBounds = useMemo(() => {
    if (!hillshadeKey || !lakes) return null;
    const feature = lakes.features.find((f) => f.properties?.key === hillshadeKey);
    if (!feature) return null;
    const coords = feature.geometry.type === "MultiPolygon"
      ? feature.geometry.coordinates.flat(2)
      : feature.geometry.coordinates.flat(1);
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  }, [hillshadeKey, lakes]);

  const [forecastTemperatures, setForecastTemperatures] = useState({});
  const [bathymetryLoading, setBathymetryLoading] = useState(false);
  const [lakeDepth, setLakeDepth] = useState(null);
  const [mousePos, setMousePos] = useState(null);
  const [touchDepth, setTouchDepth] = useState(null);

  const depthRequestIdRef = useRef(0);
  const terrainTileCache = useRef({});

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
    const newKey = selectedLake?.key ?? null;
    if (hillshadeTimerRef.current) {
      clearTimeout(hillshadeTimerRef.current);
      hillshadeTimerRef.current = null;
    }
    if (newKey && CONFIG.bathymetry.includes(newKey)) {
      setHillshadeKey(newKey);
      setHillshadeOpacity(0);
      setBathymetryLoading(true);
      hillshadePendingRef.current = true;
    } else {
      hillshadePendingRef.current = false;
      setBathymetryLoading(false);
      setLakeDepth(null);
      setMousePos(null);
      setTouchDepth(null);
      setHillshadeOpacity(0);
      hillshadeTimerRef.current = setTimeout(() => setHillshadeKey(null), HILLSHADE_FADE_MS);
    }
    return () => {
      if (hillshadeTimerRef.current) clearTimeout(hillshadeTimerRef.current);
    };
  }, [selectedLake]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch("/geodata/outputs/rivers.geojson")
      .then((res) => res.json())
      .then(setGeojson);
    fetch("/geodata/outputs/lakes.geojson")
      .then((res) => res.json())
      .then(setLakes);
    fetch(`https://alplakes-eawag.s3.eu-central-1.amazonaws.com/simulations/forecast.json?timestamp=${Date.now()}`)
      .then((res) => res.json())
      .then((data) => {
        const now = Date.now();
        const temps = {};
        for (const [key, entry] of Object.entries(data)) {
          const { time, temperature } = entry;
          let closest = 0;
          let minDiff = Infinity;
          for (let i = 0; i < time.length; i++) {
            const diff = Math.abs(time[i] - now);
            if (diff < minDiff) { minDiff = diff; closest = i; }
          }
          temps[key] = temperature[closest];
        }
        setForecastTemperatures(temps);
      })
      .catch(() => {});
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
    fetch("/geodata/outputs/dams.geojson")
      .then((res) => res.json())
      .then(setDams)
      .catch(() => {});
    fetch("/geodata/outputs/power_stations.geojson")
      .then((res) => res.json())
      .then(setPowerStations)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedGlacier) { setGlacierHistory(null); return; }
    const sgiId = selectedGlacier["sgi-id"];
    if (!sgiId) { setGlacierHistory(null); return; }
    fetch(`${CONFIG.bucket}/glaciers/outlines/${sgiId}.geojson`)
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

  const riverDams = useMemo(() => {
    if (!dams || !selectedRiverName) return [];
    return dams.features.filter((f) => f.properties.river_name === selectedRiverName);
  }, [dams, selectedRiverName]);

  const riverPowerStations = useMemo(() => {
    if (!powerStations || !selectedRiverName) return [];
    return powerStations.features.filter((f) => f.properties.river_name === selectedRiverName);
  }, [powerStations, selectedRiverName]);

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
            ? window.innerWidth <= 768
              ? { top: 40, bottom: 150, left: 20, right: 20 }
              : { top: 80, bottom: 80, left: 80, right: 350 + 20 + 60 }
            : window.innerWidth <= 768
              ? { top: 60, bottom: window.innerHeight * 0.5 + 40, left: 40, right: 40 }
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
    const interactId = setTimeout(() => setMapInteractive(true), DURATION_MS - 4000);
    return () => {
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
      const waveMin = threshold - WAVE_WIDTH;
      for (let i = 0; i < totalVertices; i++) {
        const elev = vertexElevations[i];
        if (elev > threshold) continue;          // wave hasn't reached this vertex yet
        if (colors[i * 4 + 3] === 255) continue; // already fully revealed, skip
        const distFromFront = elev - waveMin;
        const t = distFromFront < 0 ? 0 : distFromFront > WAVE_WIDTH ? 1 : distFromFront / WAVE_WIDTH;
        colors[i * 4]     = (70  + (1 - t) * 185 + 0.5) | 0;
        colors[i * 4 + 1] = (117 + (1 - t) * 138 + 0.5) | 0;
        colors[i * 4 + 2] = (134 + (1 - t) * 121 + 0.5) | 0;
        colors[i * 4 + 3] = (t * 255 + 0.5) | 0;
      }
      setRenderTick((v) => v + 1);
      if (rawT < 1) rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [riverData, animationStarted]);

  const glacierHistoryPaths = useMemo(() => {
    if (!glacierHistory) return null;
    const years = glacierHistory.features.map((f) => f.properties.year);
    const lastYear = years[years.length - 1];
    return glacierHistory.features.flatMap((f) => {
      const year = f.properties.year;
      const isLast = year === lastYear;
      const color = GLACIER_YEAR_COLORS[year] ?? [255, 255, 255];
      const opacity = isLast ? 230 : 190;
      const rings = f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat();
      return rings.map((ring) => ({ path: chaikin(ring), color: [...color, opacity], dash: isLast ? [0, 0] : [6, 4] }));
    });
  }, [glacierHistory]);

  const hoveredGlacierPaths = useMemo(() => {
    if (!hoveredGlacier) return null;
    return hoveredGlacier.geometry.coordinates.map((ring) => ({ path: chaikin(ring) }));
  }, [hoveredGlacier]);

  const selectedGlacierHighlightPaths = useMemo(() => {
    if (!selectedGlacier || !glaciers || hoveredGlacier) return null;
    const hlFeatures = glaciers.features.filter((f) => f.properties?.name === selectedGlacier.name);
    if (!hlFeatures.length) return null;
    return hlFeatures.flatMap((f) => f.geometry.coordinates.map((ring) => ({ path: chaikin(ring) })));
  }, [selectedGlacier, glaciers, hoveredGlacier]);

  const riverHighlightPaths = useMemo(() => {
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
    const highlight = [
      ...getHighlightPaths(selectedRiverName, selectedRiverId),
      ...(hoveredName && hoveredName !== selectedRiverName
        ? getHighlightPaths(hoveredName, hoveredRiverId)
        : []),
    ];
    const tributary = hoveredTributaryName
      ? getHighlightPaths(hoveredTributaryName, hoveredTributaryId)
      : [];
    return { highlight, tributary };
  }, [geojson, riverConnectivity, hoveredName, hoveredRiverId, hoveredTributaryName, hoveredTributaryId, selectedRiverName]);

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
    if (riverHighlightPaths.highlight.length) {
      result.push(
        new PathLayer({
          id: "river-highlight",
          data: riverHighlightPaths.highlight,
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
    if (riverHighlightPaths.tributary.length) {
      result.push(
        new PathLayer({
          id: "river-tributary-highlight",
          data: riverHighlightPaths.tributary,
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
              setSelectedRiverName(null);
              setRiverHoverCoord(null);
              setSelectedGlacier(null);
              setHoverInfo(null);
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
              setSelectedRiverName(null);
              setRiverHoverCoord(null);
              setSelectedLake(null);
              setHoverInfo(null);
            }
          },
        }),
      );
    }
    if (hoveredGlacierPaths) {
      result.push(
        new PathLayer({
          id: "glacier-highlight",
          data: hoveredGlacierPaths,
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
    if (glacierHistoryPaths) {
      result.push(
        new PathLayer({
          id: "glacier-history",
          data: glacierHistoryPaths,
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
    } else if (selectedGlacierHighlightPaths) {
      result.push(
        new PathLayer({
          id: "glacier-highlight",
          data: selectedGlacierHighlightPaths,
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
    if (riverDams.length) {
      result.push(
        new IconLayer({
          id: "dams",
          data: riverDams,
          getPosition: (d) => d.geometry.coordinates,
          getIcon: () => "dam",
          getSize: (d) => d.properties.name === hoveredDamName ? 36 : 24,
          sizeUnits: "pixels",
          getColor: [122, 154, 184, 255],
          iconAtlas: DAM_ATLAS,
          iconMapping: DAM_ICON_MAPPING,
          pickable: true,
          updateTriggers: { getSize: [hoveredDamName] },
          onHover: (info) => {
            if (info.object) {
              setHoveredDamName(info.object.properties.name);
              setHoverInfo({ x: info.x, y: info.y, name: info.object.properties.name, clickable: true });
            } else {
              setHoveredDamName(null);
              setHoverInfo(null);
            }
          },
          onClick: (info) => {
            if (info.object) {
              setSelectedDam({ ...info.object.properties, _lon: info.object.geometry.coordinates[0], _lat: info.object.geometry.coordinates[1] });
              setSelectedPowerStation(null);
              setHoverInfo(null);
            }
          },
        }),
      );
    }
    if (riverPowerStations.length) {
      result.push(
        new IconLayer({
          id: "power-stations",
          data: riverPowerStations,
          getPosition: (d) => d.geometry.coordinates,
          getIcon: () => "power",
          getSize: (d) => d.properties.name === hoveredPowerStationName ? 36 : 24,
          sizeUnits: "pixels",
          getColor: [232, 164, 58, 220],
          iconAtlas: POWER_ATLAS,
          iconMapping: POWER_ICON_MAPPING,
          pickable: true,
          updateTriggers: { getSize: [hoveredPowerStationName] },
          onHover: (info) => {
            if (info.object) {
              setHoveredPowerStationName(info.object.properties.name);
              setHoverInfo({ x: info.x, y: info.y, name: info.object.properties.name, clickable: true });
            } else {
              setHoveredPowerStationName(null);
              setHoverInfo(null);
            }
          },
          onClick: (info) => {
            if (info.object) {
              setSelectedPowerStation({ ...info.object.properties, _lon: info.object.geometry.coordinates[0], _lat: info.object.geometry.coordinates[1] });
              setSelectedDam(null);
              setHoverInfo(null);
            }
          },
        }),
      );
    }
    return result;
  }, [riverData, lakes, glaciers, viewState.zoom, geojson, hoveredLake, hoveredGlacierPaths, renderTick, riverHoverCoord, selectedRiverName, selectedLake, visibleSection, glacierHistoryPaths, selectedGlacierHighlightPaths, riverHighlightPaths, riverDams, riverPowerStations, hoveredDamName, hoveredPowerStationName]);

  const getTerrainDepth = (lng, lat, zoom, key) => {
    const z = Math.max(7, Math.min(12, Math.round(zoom)));
    const n = Math.pow(2, z);
    const x = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    const tileSize = 256;
    const px = Math.floor(((lng + 180) / 360 * n * tileSize) % tileSize);
    const py = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n * tileSize) % tileSize);
    const url = `${CONFIG.bucket}/tiles_${key}_terrain/${z}/${x}/${y}.png`;
    if (!terrainTileCache.current[url]) {
      terrainTileCache.current[url] = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          resolve(ctx);
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
    }
    return terrainTileCache.current[url].then((ctx) => {
      if (!ctx) return null;
      const d = ctx.getImageData(px, py, 1, 1).data;
      return -10000 + (d[0] * 65536 + d[1] * 256 + d[2]) * 0.1;
    });
  };

  const handleMapHover = (info) => {
    const key = selectedLake?.key;
    if (!key || !CONFIG.bathymetry.includes(key) || !info.coordinate) {
      setLakeDepth(null);
      setMousePos(null);
      return;
    }
    const [lng, lat] = info.coordinate;
    setMousePos({ x: info.x, y: info.y });
    const reqId = ++depthRequestIdRef.current;
    getTerrainDepth(lng, lat, viewState.zoom, key).then((depth) => {
      if (depthRequestIdRef.current === reqId) setLakeDepth(depth);
    });
  };

  const handleMapClick = (info) => {
    setTitleVisible(false);
    if (!window.matchMedia("(hover: none)").matches) return;
    const key = selectedLake?.key;
    if (!key || !CONFIG.bathymetry.includes(key) || bathymetryLoading || !info.coordinate) {
      setTouchDepth(null);
      return;
    }
    const [lng, lat] = info.coordinate;
    const reqId = ++depthRequestIdRef.current;
    getTerrainDepth(lng, lat, viewState.zoom, key).then((depth) => {
      if (depthRequestIdRef.current === reqId && depth > 0) {
        setTouchDepth({ x: info.x, y: info.y, depth });
      } else {
        setTouchDepth(null);
      }
    });
  };

  return (
    <div className="map-root">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState, interactionState }) => {
          setViewState(viewState);
          if (interactionState?.isDragging || interactionState?.isPanning || interactionState?.isZooming || interactionState?.isRotating) {
            setTitleVisible(false);
          }
        }}
ß        controller={{ minZoom: 6, maxZoom: 14 }}
        layers={layers}
        pickingRadius={10}
        onHover={handleMapHover}
        onClick={handleMapClick}
        getCursor={({ isDragging, isHovering }) => isDragging ? "grabbing" : isHovering ? "pointer" : "grab"}
      >
        <MapGL
          ref={mapRef}
          mapStyle={MAP_STYLE}
          onIdle={(e) => {
            setMapIdle(true);
            if (hillshadePendingRef.current && e.target.isSourceLoaded("hillshade")) {
              hillshadePendingRef.current = false;
              setBathymetryLoading(false);
              setHillshadeOpacity(1);
            }
          }}
        >
          {hillshadeKey && (
            <Source
              key={`hillshade-${hillshadeKey}`}
              id="hillshade"
              type="raster"
              tiles={[`${CONFIG.bucket}/tiles_${hillshadeKey}_hillshade/{z}/{x}/{y}.png`]}
              tileSize={256}
              bounds={hillshadeBounds}
            >
              <Layer
                id="hillshade-layer"
                type="raster"
                paint={{
                  "raster-opacity": hillshadeOpacity,
                  "raster-opacity-transition": { duration: HILLSHADE_FADE_MS, delay: 0 },
                }}
              />
            </Source>
          )}
          {hillshadeKey && (
            <Source
              key={`terrain-${hillshadeKey}`}
              id="terrain"
              type="raster"
              tiles={[`${CONFIG.bucket}/tiles_${hillshadeKey}_terrain/{z}/{x}/{y}.png`]}
              tileSize={256}
              bounds={hillshadeBounds}
            >
              <Layer id="terrain-layer" type="raster" paint={{ "raster-opacity": 0 }} />
            </Source>
          )}
        </MapGL>
      </DeckGL>
      {selectedLake?.key && lakeDepth > 0 && mousePos && !window.matchMedia("(hover: none)").matches && (
        <div
          className="depth-tooltip"
          style={{ left: mousePos.x + 12, top: mousePos.y - 8 }}
        >
          {t.depth}: {Math.round(lakeDepth)} m
        </div>
      )}
      {touchDepth && (
        <div
          className="depth-tooltip"
          style={{ left: touchDepth.x + 12, top: touchDepth.y - 8 }}
        >
          {t.depth}: {Math.round(touchDepth.depth)} m
        </div>
      )}
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
          dams={riverDams}
          powerStations={riverPowerStations}
          t={t}
          onHoverCoord={setRiverHoverCoord}
          onSelectRiver={setSelectedRiverName}
          onSelectLake={setSelectedLake}
          onSelectDam={setSelectedDam}
          onSelectPowerStation={setSelectedPowerStation}
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
        <NatureModal
          variant="lake"
          properties={selectedLake}
          temperature={forecastTemperatures[selectedLake.key]}
          t={t}
          onMouseEnter={clearHover}
          onClose={() => setSelectedLake(null)}
        />
      )}
      {selectedGlacier && (
        <NatureModal
          variant="glacier"
          properties={selectedGlacier}
          language={language.toLowerCase()}
          t={t}
          onMouseEnter={clearHover}
          onClose={() => setSelectedGlacier(null)}
        />
      )}
      {selectedDam && (
        <InfraModal
          variant="dam"
          properties={selectedDam}
          t={t}
          onMouseEnter={clearHover}
          onClose={() => setSelectedDam(null)}
        />
      )}
      {selectedPowerStation && (
        <InfraModal
          variant="powerstation"
          properties={selectedPowerStation}
          t={t}
          onMouseEnter={clearHover}
          onClose={() => setSelectedPowerStation(null)}
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

        {bathymetryLoading && (
          <div className="bathy-loading">
            <div className="loading-spinner" />
            <div className="loading-label">{t.loadingBathymetry}</div>
          </div>
        )}

        {!bathymetryLoading && hillshadeKey && selectedLake?.max_depth && (
          <div className="bathy-legend">
            <div className="bathy-legend-bar" />
            <div className="bathy-legend-labels">
              <span>0 m</span>
              <span>{Math.round(selectedLake.max_depth)} m</span>
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

      <div className="top-right-controls" style={{ opacity: phase !== "loading" ? 1 : 0, transition: "opacity 1.5s ease", pointerEvents: phase !== "loading" ? "all" : "none" }}>
        <div className="lang-switcher lang-switcher-buttons">
          {languages.map(lang => (
            <button
              key={lang}
              className={`lang-btn${language === lang ? " active" : ""}`}
              onClick={() => setLanguage({ target: { value: lang } })}
            >{lang}</button>
          ))}
        </div>
        <select
          className="lang-switcher-select"
          value={language}
          onChange={setLanguage}
        >
          {languages.map(lang => (
            <option key={lang} value={lang}>{lang}</option>
          ))}
        </select>
        <button className="about-btn" onClick={() => setShowAbout(true)}>
          <span className="about-btn-label">{t.about}</span>
          <span className="about-btn-icon">?</span>
        </button>
      </div>

      {showAbout && <AboutModal t={t} onMouseEnter={clearHover} onClose={() => setShowAbout(false)} />}

      {hoverInfo && hoverInfo.name && !window.matchMedia("(hover: none)").matches && (
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
