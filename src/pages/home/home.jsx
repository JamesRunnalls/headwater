import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { PathLayer, SolidPolygonLayer, ScatterplotLayer, IconLayer, BitmapLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import { MaskExtension } from "@deck.gl/extensions";
import { WebMercatorViewport, FlyToInterpolator } from "@deck.gl/core";
import CONFIG from "../../config.json";
import "./home.css";
import RiverModal from "../../components/RiverModal/RiverModal";
import NatureModal from "../../components/NatureModal/NatureModal";
import { processGeoJson, stripRiverSuffix } from "./functions";
import translations from "../../translations";
import AboutModal from "../../components/AboutModal/AboutModal";
import InfraModal from "../../components/InfraModal/InfraModal";
import MapCanvas from "./MapCanvas";
import FeatureInfoStack from "./FeatureInfoStack";
import {
  featureBbox, chaikin, ANIMATE, WAVE_WIDTH, INITIAL_VIEW_STATE,
  GLACIER_YEAR_COLORS,
  DAM_ATLAS, DAM_ICON_MAPPING, POWER_ATLAS, POWER_ICON_MAPPING,
  DAM_WITH_POWER_ATLAS, DAM_WITH_POWER_ICON_MAPPING,
  HYDRO_ATLAS, HYDRO_ICON_MAPPING, DATALAKES_ATLAS, DATALAKES_ICON_MAPPING,
  STATION_ICON_SIZE, STATION_ICON_MAPPING, CIRCLE_ATLAS_FALLBACK,
  RUNOFF_ATLAS, RUNOFF_ICON_MAPPING,
} from "./constants";


const ringArea = (ring) => {
  const latMid = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  const latFactor = 111.32;
  const lonFactor = 111.32 * Math.cos(latMid * Math.PI / 180);
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * lonFactor * ring[i][1] * latFactor - ring[i][0] * lonFactor * ring[j][1] * latFactor;
  }
  return Math.abs(area / 2);
};

const featureArea = (f) =>
  f.geometry.type === "MultiPolygon"
    ? f.geometry.coordinates.reduce((s, poly) => s + ringArea(poly[0]), 0)
    : ringArea(f.geometry.coordinates[0]);

const SwissRiversDeckGL = ({ language = "EN", languages = ["EN", "DE", "FR", "IT"], setLanguage }) => {
  const t = translations[language] ?? translations.EN;
  const [showAbout, setShowAbout] = useState(false);
  const [flyTarget, setFlyTarget] = useState(null);
  const [mapZoom, setMapZoom] = useState(INITIAL_VIEW_STATE.zoom);
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
  const [infrastructure, setInfrastructure] = useState(null);
  const [selectedInfra, setSelectedInfra] = useState(null);
  const [hoveredInfraName, setHoveredInfraName] = useState(null);
  const [hydroStations, setHydroStations] = useState(null);
  const [selectedHydroStation, setSelectedHydroStation] = useState(null);
  const [hoveredHydroKey, setHoveredHydroKey] = useState(null);
  const [massBalance, setMassBalance] = useState(null);
  const [runoffData, setRunoffData] = useState(null);
  const [glacierOutflows, setGlacierOutflows] = useState(null);
  const [hoveredRunoffSgiId, setHoveredRunoffSgiId] = useState(null);
  const [selectedRunoffStation, setSelectedRunoffStation] = useState(null);
  const [datalakesData, setDatalakesData] = useState(null);
  const [selectedDatalakesStation, setSelectedDatalakesStation] = useState(null);
  const [hoveredDatalakesName, setHoveredDatalakesName] = useState(null);
  const [iconAtlases, setIconAtlases] = useState({});
  const [glacierHistory, setGlacierHistory] = useState(null);
  const [glacierSmoothedPaths, setGlacierSmoothedPaths] = useState(null);
  const [renderTick, setRenderTick] = useState(0);
  const HILLSHADE_FADE_MS = 800;
  const [hillshadeKey, setHillshadeKey] = useState(null);
  const [hillshadeOpacity, setHillshadeOpacity] = useState(0);
  const hillshadeTimerRef = useRef(null);
  const hillshadePendingRef = useRef(false);
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
  const skipAnimRef = useRef(false);

  const [glacierThicknessKey, setGlacierThicknessKey] = useState(null);
  const [glacierThicknessOpacity, setGlacierThicknessOpacity] = useState(0);
  const [glacierDepthLoading, setGlacierDepthLoading] = useState(false);
  const [glacierThicknessValue, setGlacierThicknessValue] = useState(null);
  const [glacierThicknessMousePos, setGlacierThicknessMousePos] = useState(null);
  const glacierDepthRequestIdRef = useRef(0);
  const glacierTerrainCache = useRef({});
  const glacierThicknessTimerRef = useRef(null);
  const glacierFadeRafRef = useRef(null);
  const mapDraggingRef = useRef(false);
  const glacierDepthPendingRef = useRef(false);


  const clearHover = () => {
    setHoveredName(null);
    setHoveredRiverId(null);
    setHoveredTributaryName(null);
    setHoveredTributaryId(null);
    setHoveredLake(null);
    setHoveredGlacier(null);
    setHoverInfo(null);
    setMapHoverCoord(null);
    setHoveredRunoffSgiId(null);
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
        const smoothed = new Map();
        features.forEach((f) => {
          const key = f.properties?.["sgi-id"] ?? f.properties?.name;
          if (!key) return;
          const rings = f.geometry.coordinates.map((ring) => chaikin(ring));
          smoothed.set(key, [...(smoothed.get(key) ?? []), ...rings]);
        });
        setGlacierSmoothedPaths(smoothed);
      });
    fetch("/geodata/outputs/infrastructure.geojson")
      .then((res) => res.json())
      .then(setInfrastructure)
      .catch(() => {});
    fetch(`${CONFIG.bucket}/glaciers/massbalance.json?t=${Date.now()}`)
      .then((res) => res.json())
      .then(setMassBalance)
      .catch(() => {});
    fetch(`${CONFIG.bucket}/glaciers/runoff.json?t=${Date.now()}`)
      .then((res) => res.json())
      .then(setRunoffData)
      .catch(() => {});
    fetch("/geodata/outputs/glacier_outflows.json")
      .then((res) => res.json())
      .then(setGlacierOutflows)
      .catch(() => {});
    const fetchLiveData = () => {
      fetch(`${CONFIG.bucket}/hydro/stations.geojson?t=${Date.now()}`)
        .then((res) => res.json())
        .then(setHydroStations)
        .catch(() => {});
      fetch(`${CONFIG.bucket}/hydro/datalakes.json?t=${Date.now()}`)
        .then((res) => res.json())
        .then(setDatalakesData)
        .catch(() => {});
    };
    fetchLiveData();
    const liveDataInterval = setInterval(fetchLiveData, 30 * 60 * 1000);
    return () => clearInterval(liveDataInterval);
  }, []);

  useEffect(() => {
    if (!datalakesData) return;
    const uniqueImages = [...new Set(datalakesData.stations.filter((s) => s.image).map((s) => s.image))];
    for (const imgName of uniqueImages) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = STATION_ICON_SIZE;
        canvas.height = STATION_ICON_SIZE;
        const ctx = canvas.getContext("2d");
        const scale = Math.min(STATION_ICON_SIZE / img.width, STATION_ICON_SIZE / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (STATION_ICON_SIZE - w) / 2;
        const y = (STATION_ICON_SIZE - h) / 2;
        ctx.drawImage(img, x, y, w, h);
        setIconAtlases((prev) => ({ ...prev, [imgName]: canvas.toDataURL("image/png") }));
      };
      img.onerror = () => {
        setIconAtlases((prev) => ({ ...prev, [imgName]: CIRCLE_ATLAS_FALLBACK }));
      };
      img.src = `${CONFIG.bucket}/hydro/icons/${imgName}`;
    }
  }, [datalakesData]);

  useEffect(() => {
    if (glacierThicknessTimerRef.current) {
      clearTimeout(glacierThicknessTimerRef.current);
      glacierThicknessTimerRef.current = null;
    }
    if (glacierFadeRafRef.current) {
      cancelAnimationFrame(glacierFadeRafRef.current);
      glacierFadeRafRef.current = null;
    }
    if (!selectedGlacier) {
      setGlacierHistory(null);
      setSelectedRunoffStation(null);
      glacierDepthPendingRef.current = false;
      setGlacierDepthLoading(false);
      setGlacierThicknessValue(null);
      setGlacierThicknessMousePos(null);
      setGlacierThicknessOpacity(0);
      glacierThicknessTimerRef.current = setTimeout(() => setGlacierThicknessKey(null), HILLSHADE_FADE_MS);
      return;
    }
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
    setGlacierThicknessKey(sgiId);
    setGlacierThicknessOpacity(0);
    setGlacierDepthLoading(true);
    glacierDepthPendingRef.current = true;
    setGlacierThicknessValue(null);
    setGlacierThicknessMousePos(null);
    return () => {
      if (glacierThicknessTimerRef.current) clearTimeout(glacierThicknessTimerRef.current);
    };
  }, [selectedGlacier]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const riverInfra = useMemo(() => {
    if (!infrastructure || !selectedRiverName || !geojson) return { dams: [], power: [], damWithPower: [] };
    const selectedRiverIds = new Set(
      geojson.features
        .filter((f) => {
          const n = f.properties?.name;
          return n && n.split(" |").some((p) => p.trim() === selectedRiverName);
        })
        .map((f) => f.properties.id)
    );
    const features = infrastructure.features.filter(
      (f) => f.properties.river_id != null && selectedRiverIds.has(f.properties.river_id)
    );
    return {
      dams: features.filter((f) => f.properties.category === "dam"),
      power: features.filter((f) => f.properties.category === "power"),
      damWithPower: features.filter((f) => f.properties.category === "dam_with_power"),
    };
  }, [infrastructure, selectedRiverName, geojson]);

  const riverHydro = useMemo(() => {
    if (!hydroStations || !selectedRiverName || !geojson) return [];
    const selectedRiverIds = new Set(
      geojson.features
        .filter((f) => {
          const n = f.properties?.name;
          return n && n.split(" |").some((p) => p.trim() === selectedRiverName);
        })
        .map((f) => f.properties.id)
    );
    return hydroStations.features.filter(
      (f) => f.properties.river_id != null && selectedRiverIds.has(f.properties.river_id)
    );
  }, [hydroStations, selectedRiverName, geojson]);

  const lakeHydro = useMemo(() => {
    if (!hydroStations || !selectedLake) return [];
    return hydroStations.features.filter(
      (f) => f.properties.lake_key === selectedLake.key
    );
  }, [hydroStations, selectedLake]);

  const lakeDatalakes = useMemo(() => {
    if (!datalakesData || !selectedLake) return [];
    return datalakesData.stations.filter((s) => s.lake === selectedLake.key);
  }, [datalakesData, selectedLake]);

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
      const sgiId = selectedGlacier["sgi-id"];
      const features = glaciers.features.filter((f) =>
        sgiId ? f.properties?.["sgi-id"] === sgiId : f.properties?.name === selectedGlacier.name
      );
      coords = features.flatMap((f) => f.geometry.coordinates.flat(1));
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
      const maxZoom = selectedGlacier && window.innerWidth > 768 ? 15 : 12;
      setFlyTarget({
        longitude,
        latitude,
        zoom: Math.min(zoom, maxZoom),
        transitionDuration: 1000,
        transitionInterpolator: new FlyToInterpolator(),
      });
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
      if (skipAnimRef.current) return;
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
    const features = glacierHistory.features.filter((f) => f.properties.year !== 2010);
    const lastYear = features[features.length - 1]?.properties?.year;
    return features.flatMap((f) => {
      const year = f.properties.year;
      const isLast = year === lastYear;
      const color = GLACIER_YEAR_COLORS[year] ?? [255, 255, 255];
      const opacity = isLast ? 230 : 190;
      const rings = f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat();
      return rings.map((ring) => ({ path: chaikin(ring), color: [...color, opacity] }));
    });
  }, [glacierHistory]);

  const glacierHistoryFills = useMemo(() => {
    if (!glacierHistory) return null;
    const features = glacierHistory.features.filter((f) => f.properties.year !== 2010);
    const lastYear = features[features.length - 1]?.properties?.year;
    const areas = features.map(featureArea);
    const firstArea = areas[0] || 1;
    return features.flatMap((f, i) => {
      const color = GLACIER_YEAR_COLORS[f.properties.year] ?? [255, 255, 255];
      const isLast = f.properties.year === lastYear;
      const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
      const area = areas[i];
      const areaChange = ((area - firstArea) / firstArea) * 100;
      return polys.map((coords) => ({ coords, color: [...color, isLast ? 60 : 40], year: f.properties.year, area, areaChange }));
    });
  }, [glacierHistory]);

  const hoveredGlacierPaths = useMemo(() => {
    if (!hoveredGlacier || !glacierSmoothedPaths) return null;
    const key = hoveredGlacier.properties?.["sgi-id"] ?? hoveredGlacier.properties?.name;
    const rings = glacierSmoothedPaths.get(key);
    if (!rings) return null;
    return rings.map((path) => ({ path }));
  }, [hoveredGlacier, glacierSmoothedPaths]);

  const selectedGlacierHighlightPaths = useMemo(() => {
    if (!selectedGlacier || !glaciers || !glacierSmoothedPaths || hoveredGlacier) return null;
    const hlFeatures = glaciers.features.filter((f) => f.properties?.name === selectedGlacier.name);
    if (!hlFeatures.length) return null;
    return hlFeatures.flatMap((f) => {
      const key = f.properties?.["sgi-id"] ?? f.properties?.name;
      const rings = glacierSmoothedPaths.get(key);
      return rings ? rings.map((path) => ({ path })) : f.geometry.coordinates.map((ring) => ({ path: chaikin(ring) }));
    });
  }, [selectedGlacier, glaciers, glacierSmoothedPaths, hoveredGlacier]);

  const massBalanceLookup = useMemo(() => {
    if (!massBalance?.glaciers) return null;
    const map = new Map();
    for (const g of massBalance.glaciers) {
      if (g.classification != null) map.set(g.sgi_id, g);
    }
    return map;
  }, [massBalance]);

  const runoffStations = useMemo(() => {
    if (!runoffData?.glaciers || !glacierOutflows || !selectedGlacier) return [];
    const sgiId = selectedGlacier["sgi-id"];
    const coords = glacierOutflows[sgiId];
    if (!coords) return [];
    const record = runoffData.glaciers.find((g) => g.sgi_id === sgiId) ?? null;
    return [{
      type: "Feature",
      geometry: { type: "Point", coordinates: coords },
      properties: { sgiId, _lon: coords[0], _lat: coords[1], ...(record ?? {}), name: selectedGlacier.name },
    }];
  }, [runoffData, glacierOutflows, selectedGlacier]);

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

  const riverWidthScale = useMemo(
    () => 1 / Math.pow(2, mapZoom - INITIAL_VIEW_STATE.zoom),
    [mapZoom]
  );

  const completeAnimation = useCallback(() => {
    if (mapInteractiveRef.current || !riverData) return;
    skipAnimRef.current = true;
    const { colors, totalVertices } = riverData;
    for (let i = 0; i < totalVertices; i++) {
      colors[i * 4]     = 70;
      colors[i * 4 + 1] = 117;
      colors[i * 4 + 2] = 134;
      colors[i * 4 + 3] = 255;
    }
    mapInteractiveRef.current = true;
    setMapInteractive(true);
    setRenderTick((v) => v + 1);
  }, [riverData]);

  const pointInPolygon = ([x, y], ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  const layers = useMemo(() => {
    const result = [];

    if (riverData) {
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
          widthScale: riverWidthScale,
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
            } else if (!mapDraggingRef.current) {
              setHoverInfo(null);
              setHoveredName(null);
              setHoveredRiverId(null);
              setMapHoverCoord(null);
            }
          },
          onClick: (info) => {
            completeAnimation();
            if (info.index >= 0) {
              const name = riverData.names[info.index];
              if (name === selectedRiverName) return;
              setSelectedRiverName(name);
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
            } else if (!mapDraggingRef.current) {
              setHoverInfo(null);
              setHoveredLake(null);
            }
          },
          onClick: (info) => {
            completeAnimation();
            if (info.object) {
              if (info.object.properties?.key === selectedLake?.key) return;
              setSelectedLake({ ...info.object.properties, _bbox: featureBbox(info.object.geometry) });
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
            } else if (!mapDraggingRef.current) {
              setHoverInfo(null);
              setHoveredGlacier(null);
            }
          },
          onClick: (info) => {
            completeAnimation();
            if (info.object) {
              if (info.object.properties?.name === selectedGlacier?.name) return;
              setSelectedGlacier({ ...info.object.properties, _bbox: featureBbox(info.object.geometry) });
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
        new SolidPolygonLayer({
          id: "glacier-history-fill",
          data: glacierHistoryFills,
          getPolygon: (d) => d.coords,
          getFillColor: (d) => d.color,
          extruded: false,
          pickable: true,
          onHover: (info) => {
            if (info.object) {
              const { year, area, areaChange } = info.object;
              const name = selectedGlacier?.name ?? String(year);
              setHoverInfo({ x: info.x, y: info.y, name, year, area, areaChange, clickable: false });
            } else if (!mapDraggingRef.current) {
              setHoverInfo(null);
            }
          },
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
    const makeInfraHandlers = () => ({
      onHover: (info) => {
        if (info.object) {
          setHoveredInfraName(info.object.properties.name);
          setHoverInfo({ x: info.x, y: info.y, name: info.object.properties.name, clickable: true });
        } else {
          setHoveredInfraName(null);
          setHoverInfo(null);
        }
      },
      onClick: (info) => {
        if (info.object) {
          setSelectedInfra({ category: info.object.properties.category, properties: { ...info.object.properties, _lon: info.object.geometry.coordinates[0], _lat: info.object.geometry.coordinates[1] } });
          setHoverInfo(null);
        }
      },
    });
    if (riverInfra.dams.length) {
      result.push(
        new IconLayer({
          id: "dams",
          data: riverInfra.dams,
          getPosition: (d) => d.geometry.coordinates,
          getIcon: () => "dam",
          getSize: (d) => d.properties.name === hoveredInfraName ? 36 : 24,
          sizeUnits: "pixels",
          getColor: [122, 154, 184, 255],
          iconAtlas: DAM_ATLAS,
          iconMapping: DAM_ICON_MAPPING,
          pickable: true,
          updateTriggers: { getSize: [hoveredInfraName] },
          ...makeInfraHandlers("dams"),
        }),
      );
    }
    if (riverInfra.power.length) {
      result.push(
        new IconLayer({
          id: "power-stations",
          data: riverInfra.power,
          getPosition: (d) => d.geometry.coordinates,
          getIcon: () => "power",
          getSize: (d) => d.properties.name === hoveredInfraName ? 36 : 24,
          sizeUnits: "pixels",
          getColor: (d) => d.properties.name === hoveredInfraName ? [232, 164, 58, 255] : [232, 164, 58, 220],
          iconAtlas: POWER_ATLAS,
          iconMapping: POWER_ICON_MAPPING,
          pickable: true,
          updateTriggers: { getSize: [hoveredInfraName], getColor: [hoveredInfraName] },
          ...makeInfraHandlers("power-stations"),
        }),
      );
    }
    if (riverInfra.damWithPower.length) {
      result.push(
        new IconLayer({
          id: "dam-with-power",
          data: riverInfra.damWithPower,
          getPosition: (d) => d.geometry.coordinates,
          getIcon: () => "dam_with_power",
          getSize: (d) => d.properties.name === hoveredInfraName ? 36 : 24,
          sizeUnits: "pixels",
          iconAtlas: DAM_WITH_POWER_ATLAS,
          iconMapping: DAM_WITH_POWER_ICON_MAPPING,
          pickable: true,
          updateTriggers: { getSize: [hoveredInfraName] },
          ...makeInfraHandlers("dam-with-power"),
        }),
      );
    }

    const activeHydroStations = selectedRiverName ? riverHydro : lakeHydro;
    if (activeHydroStations.length) {
      if (!selectedRiverName) {
        result.push(
          new ScatterplotLayer({
            id: "lake-hydro-glow",
            data: activeHydroStations,
            getPosition: (d) => d.geometry.coordinates,
            getRadius: 20,
            radiusUnits: "pixels",
            getFillColor: [34, 211, 238, 35],
            getLineColor: [255, 255, 255, 150],
            stroked: true,
            lineWidthMinPixels: 2,
            pickable: true,
            onHover: (info) => {
              if (info.object) {
                setHoveredHydroKey(info.object.properties.key);
                setHoverInfo({ x: info.x, y: info.y, name: info.object.properties.label, clickable: true });
              } else {
                setHoveredHydroKey(null);
                setHoverInfo(null);
              }
            },
            onClick: (info) => {
              if (info.object) {
                setSelectedHydroStation({
                  ...info.object.properties,
                  _lon: info.object.geometry.coordinates[0],
                  _lat: info.object.geometry.coordinates[1],
                });
                setHoverInfo(null);
              }
            },
          })
        );
      }
      result.push(
        new IconLayer({
          id: "hydro-stations",
          data: activeHydroStations,
          getPosition: (d) => d.geometry.coordinates,
          getIcon: () => "hydro",
          getSize: (d) => d.properties.key === hoveredHydroKey ? 43 : 29,
          sizeUnits: "pixels",
          getColor: () => [255, 255, 255, 255],
          iconAtlas: HYDRO_ATLAS,
          iconMapping: HYDRO_ICON_MAPPING,
          pickable: true,
          updateTriggers: { getSize: [hoveredHydroKey], getColor: [hoveredHydroKey] },
          onHover: (info) => {
            if (info.object) {
              setHoveredHydroKey(info.object.properties.key);
              setHoverInfo({ x: info.x, y: info.y, name: info.object.properties.label, clickable: true });
            } else {
              setHoveredHydroKey(null);
              setHoverInfo(null);
            }
          },
          onClick: (info) => {
            if (info.object) {
              setSelectedHydroStation({
                ...info.object.properties,
                _lon: info.object.geometry.coordinates[0],
                _lat: info.object.geometry.coordinates[1],
              });
              setHoverInfo(null);
            }
          },
        })
      );
    }

    const makeDatalakesHandlers = () => ({
      onHover: (info) => {
        if (info.object) {
          setHoveredDatalakesName(info.object.name);
          setHoverInfo({ x: info.x, y: info.y, name: info.object.name, clickable: true });
        } else {
          setHoveredDatalakesName(null);
          setHoverInfo(null);
        }
      },
      onClick: (info) => {
        if (info.object) {
          setSelectedDatalakesStation({
            ...info.object,
            _lon: info.object.coordinates[0],
            _lat: info.object.coordinates[1],
          });
          setHoverInfo(null);
        }
      },
    });

    const iconStations = lakeDatalakes.filter((s) => s.image);
    const buoyStations = lakeDatalakes.filter((s) => !s.image);

    if (buoyStations.length) {
      result.push(
        new ScatterplotLayer({
          id: "datalakes-buoy-glow",
          data: buoyStations,
          getPosition: (d) => d.coordinates,
          getRadius: 60,
          radiusUnits: "meters",
          radiusMinPixels: 16,
          radiusMaxPixels: 40,
          getFillColor: [34, 211, 238, 35],
          getLineColor: [255, 255, 255, 150],
          stroked: true,
          lineWidthMinPixels: 2,
          pickable: true,
          ...makeDatalakesHandlers(),
        })
      );
      result.push(
        new IconLayer({
          id: "datalakes-stations",
          data: buoyStations,
          getPosition: (d) => d.coordinates,
          getIcon: () => "buoy",
          getSize: 100,
          sizeUnits: "meters",
          sizeMinPixels: 30,
          getPixelOffset: (d) => d.name === hoveredDatalakesName ? [0, -6] : [0, 0],
          iconAtlas: DATALAKES_ATLAS,
          iconMapping: DATALAKES_ICON_MAPPING,
          pickable: true,
          updateTriggers: { getPixelOffset: [hoveredDatalakesName] },
          ...makeDatalakesHandlers(),
        })
      );
    }

    const byImage = {};
    for (const s of iconStations) {
      if (!byImage[s.image]) byImage[s.image] = [];
      byImage[s.image].push(s);
    }

    for (const [imgName, stations] of Object.entries(byImage)) {
      const atlas = iconAtlases[imgName] ?? CIRCLE_ATLAS_FALLBACK;
      const layerId = imgName.replace(/[^a-z0-9]/gi, "_");
      result.push(
        new ScatterplotLayer({
          id: `datalakes-glow-${layerId}`,
          data: stations,
          getPosition: (d) => d.coordinates,
          getRadius: 1200,
          radiusUnits: "meters",
          radiusMinPixels: 18,
          radiusMaxPixels: 80,
          getFillColor: [34, 211, 238, 35],
          getLineColor: [255, 255, 255, 150],
          stroked: true,
          lineWidthMinPixels: 2,
          pickable: true,
          ...makeDatalakesHandlers(),
        })
      );
      result.push(
        new IconLayer({
          id: `datalakes-icon-${layerId}`,
          data: stations,
          getPosition: (d) => d.coordinates,
          getIcon: () => "icon",
          getSize: 2050,
          sizeUnits: "meters",
          sizeMinPixels: 30,
          sizeMaxPixels: 150,
          getPixelOffset: (d) => d.name === hoveredDatalakesName ? [0, -2] : [0, 0],
          iconAtlas: atlas,
          iconMapping: STATION_ICON_MAPPING,
          pickable: true,
          updateTriggers: { getPixelOffset: [hoveredDatalakesName], iconAtlas: [atlas] },
          ...makeDatalakesHandlers(),
        })
      );
    }

    if (glacierThicknessKey && selectedGlacier && glacierHistory) {
      const lastOutline = glacierHistory.features[glacierHistory.features.length - 1];
      const maskPolygons = lastOutline
        ? lastOutline.geometry.type === "MultiPolygon"
          ? lastOutline.geometry.coordinates
          : [lastOutline.geometry.coordinates]
        : [];
      if (maskPolygons.length > 0) {
        result.push(
          new SolidPolygonLayer({
            id: "glacier-thickness-mask",
            data: maskPolygons,
            getPolygon: (d) => d,
            operation: "mask",
            filled: true,
            getFillColor: [255, 255, 255, 255],
            pickable: false,
          }),
          new TileLayer({
            id: "glacier-thickness-tiles",
            data: `${CONFIG.bucket}/tiles_glacier_depth/{z}/{x}/{y}.png`,
            minZoom: 7,
            maxZoom: 14,
            renderSubLayers: (props) => {
              if (!props.data) return null;
              const [[west, south], [east, north]] = props.tile.boundingBox;
              return new BitmapLayer(props, {
                data: null,
                image: props.data,
                bounds: [west, south, east, north],
              });
            },
            opacity: glacierThicknessOpacity,
            extensions: [new MaskExtension()],
            maskId: "glacier-thickness-mask",
            pickable: false,
            onViewportLoad: () => {
              if (glacierDepthPendingRef.current) {
                glacierDepthPendingRef.current = false;
                setGlacierDepthLoading(false);
                const start = performance.now();
                const tick = (now) => {
                  const t = Math.min((now - start) / HILLSHADE_FADE_MS, 1);
                  setGlacierThicknessOpacity(t);
                  if (t < 1) glacierFadeRafRef.current = requestAnimationFrame(tick);
                };
                glacierFadeRafRef.current = requestAnimationFrame(tick);
              }
            },
          })
        );
      }
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
          capRounded: true,
          jointRounded: true,
          pickable: false,
        }),
      );
    }

    if (runoffStations.length) {
      const makeRunoffHandlers = () => ({
        onHover: (info) => {
          if (info.object) {
            setHoveredRunoffSgiId(info.object.properties.sgi_id);
            const name = info.object.properties.name
              ? info.object.properties.name.charAt(0).toUpperCase() + info.object.properties.name.slice(1)
              : info.object.properties.sgiId;
            setHoverInfo({ x: info.x, y: info.y, name, clickable: true });
          } else {
            setHoveredRunoffSgiId(null);
            setHoverInfo(null);
          }
        },
        onClick: (info) => {
          if (info.object) {
            setSelectedRunoffStation(info.object.properties);
            setHoverInfo(null);
          }
        },
      });
      result.push(
        new ScatterplotLayer({
          id: "glacier-runoff-glow",
          data: runoffStations,
          getPosition: (d) => d.geometry.coordinates,
          getRadius: 20,
          radiusUnits: "pixels",
          getFillColor: [34, 211, 238, 35],
          getLineColor: [255, 255, 255, 150],
          stroked: true,
          lineWidthMinPixels: 2,
          pickable: true,
          ...makeRunoffHandlers(),
        })
      );
      result.push(
        new IconLayer({
          id: "glacier-runoff-stations",
          data: runoffStations,
          getPosition: (d) => d.geometry.coordinates,
          getIcon: () => "hydro",
          getSize: (d) => d.properties.sgi_id === hoveredRunoffSgiId ? 43 : 29,
          sizeUnits: "pixels",
          iconAtlas: HYDRO_ATLAS,
          iconMapping: HYDRO_ICON_MAPPING,
          pickable: true,
          updateTriggers: { getSize: [hoveredRunoffSgiId] },
          ...makeRunoffHandlers(),
        })
      );
    }

    return result;
  }, [riverData, lakes, glaciers, riverWidthScale, geojson, hoveredLake, hoveredGlacierPaths, renderTick, riverHoverCoord, selectedRiverName, selectedLake, selectedGlacier, visibleSection, glacierHistoryPaths, glacierHistoryFills, selectedGlacierHighlightPaths, riverHighlightPaths, riverInfra, hoveredInfraName, riverHydro, lakeHydro, hoveredHydroKey, lakeDatalakes, hoveredDatalakesName, iconAtlases, glacierThicknessKey, glacierThicknessOpacity, glacierHistory, completeAnimation, runoffStations, hoveredRunoffSgiId]);

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
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
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

  const getGlacierDepth = (lng, lat, zoom) => {
    const z = Math.max(7, Math.min(12, Math.round(zoom)));
    const n = Math.pow(2, z);
    const x = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    const tileSize = 256;
    const px = Math.floor(((lng + 180) / 360 * n * tileSize) % tileSize);
    const py = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n * tileSize) % tileSize);
    const url = `${CONFIG.bucket}/tiles_glacier_depth_terrain/${z}/${x}/${y}.png`;
    if (!glacierTerrainCache.current[url]) {
      glacierTerrainCache.current[url] = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          resolve(ctx);
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
    }
    return glacierTerrainCache.current[url].then((ctx) => {
      if (!ctx) return null;
      const d = ctx.getImageData(px, py, 1, 1).data;
      return -10000 + (d[0] * 65536 + d[1] * 256 + d[2]) * 0.1;
    });
  };

  const handleMapHover = useCallback((info, zoom) => {
    const key = selectedLake?.key;
    if (!key || !CONFIG.bathymetry.includes(key) || !info.coordinate) {
      setLakeDepth(null);
      setMousePos(null);
    } else {
      const [lng, lat] = info.coordinate;
      setMousePos({ x: info.x, y: info.y });
      const reqId = ++depthRequestIdRef.current;
      getTerrainDepth(lng, lat, zoom, key).then((depth) => {
        if (depthRequestIdRef.current === reqId) setLakeDepth(depth);
      });
    }

    if (glacierThicknessKey) {
      if (info.coordinate) {
        const [lng, lat] = info.coordinate;
        const last = glacierHistory?.features?.[glacierHistory.features.length - 1];
        const rings = last
          ? last.geometry.type === "MultiPolygon"
            ? last.geometry.coordinates.map((p) => p[0])
            : [last.geometry.coordinates[0]]
          : [];
        const inside = rings.some((ring) => pointInPolygon([lng, lat], ring));
        if (inside) {
          setGlacierThicknessMousePos({ x: info.x, y: info.y });
          const reqId = ++glacierDepthRequestIdRef.current;
          getGlacierDepth(lng, lat, zoom).then((depth) => {
            if (glacierDepthRequestIdRef.current !== reqId) return;
            setGlacierThicknessValue(depth);
          });
        } else {
          setGlacierThicknessValue(null);
          setGlacierThicknessMousePos(null);
        }
      }
    } else {
      setGlacierThicknessValue(null);
      setGlacierThicknessMousePos(null);
    }
  }, [selectedLake, glacierThicknessKey, glacierHistory]);

  const handleMapClick = useCallback((info, zoom) => {
    setTitleVisible(false);
    if (!window.matchMedia("(hover: none)").matches) return;
    const key = selectedLake?.key;
    if (!key || !CONFIG.bathymetry.includes(key) || bathymetryLoading || !info.coordinate) {
      setTouchDepth(null);
    } else {
      const [lng, lat] = info.coordinate;
      const reqId = ++depthRequestIdRef.current;
      getTerrainDepth(lng, lat, zoom, key).then((depth) => {
        if (depthRequestIdRef.current === reqId && depth > 0) {
          setTouchDepth({ x: info.x, y: info.y, depth });
        } else {
          setTouchDepth(null);
        }
      });
    }
    if (glacierThicknessKey && info.coordinate) {
      const [lng, lat] = info.coordinate;
      const last = glacierHistory?.features?.[glacierHistory.features.length - 1];
      const rings = last
        ? last.geometry.type === "MultiPolygon"
          ? last.geometry.coordinates.map((p) => p[0])
          : [last.geometry.coordinates[0]]
        : [];
      const inside = rings.some((ring) => pointInPolygon([lng, lat], ring));
      if (inside) {
        setGlacierThicknessMousePos({ x: info.x, y: info.y });
        const reqId = ++glacierDepthRequestIdRef.current;
        getGlacierDepth(lng, lat, zoom).then((depth) => {
          if (glacierDepthRequestIdRef.current !== reqId) return;
          setGlacierThicknessValue(depth);
        });
      } else {
        setGlacierThicknessValue(null);
        setGlacierThicknessMousePos(null);
      }
    }
  }, [selectedLake, bathymetryLoading, glacierThicknessKey, glacierHistory]);

  const handleFlyApplied = useCallback(() => setFlyTarget(null), []);

  const handleInteractionStart = useCallback(() => {
    setTitleVisible(false);
    setHoverInfo(null);
    setHoveredGlacier(null);
    setGlacierThicknessValue(null);
    setGlacierThicknessMousePos(null);
    setLakeDepth(null);
    setMousePos(null);
  }, []);

  const handleMapIdle = useCallback((e) => {
    setMapIdle(true);
    if (hillshadePendingRef.current && e.target.isSourceLoaded("hillshade")) {
      hillshadePendingRef.current = false;
      setBathymetryLoading(false);
      setHillshadeOpacity(1);
    }
  }, []);

  const handleZoomChange = useCallback((zoom) => {
    setMapZoom(zoom);
    setGlacierThicknessValue(null);
    setGlacierThicknessMousePos(null);
    setLakeDepth(null);
    setMousePos(null);
  }, []);

  return (
    <div className="map-root">
      <MapCanvas
        layers={layers}
        flyTarget={flyTarget}
        onFlyApplied={handleFlyApplied}
        hillshadeKey={hillshadeKey}
        hillshadeOpacity={hillshadeOpacity}
        hillshadeBounds={hillshadeBounds}
        glacierThicknessKey={glacierThicknessKey}
        mapDraggingRef={mapDraggingRef}
        onMapHover={handleMapHover}
        onMapClick={handleMapClick}
        onMapIdle={handleMapIdle}
        onInteractionStart={handleInteractionStart}
        onZoomChange={handleZoomChange}
      />
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
      {glacierThicknessKey && glacierThicknessValue > 0 && glacierThicknessMousePos && (
        <div
          className="depth-tooltip"
          style={{ left: glacierThicknessMousePos.x + 12, top: glacierThicknessMousePos.y - 8 }}
        >
          {t.thickness}: {Math.round(glacierThicknessValue)} m
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
          dams={riverInfra.dams}
          powerStations={riverInfra.power}
          damWithPower={riverInfra.damWithPower}
          t={t}
          onHoverCoord={setRiverHoverCoord}
          onSelectRiver={setSelectedRiverName}
          onSelectLake={(props) => {
            const feat = lakes?.features.find((f) => f.properties?.key === props.key);
            setSelectedLake(feat ? { ...props, _bbox: featureBbox(feat.geometry) } : props);
            setSelectedRiverName(null); setRiverHoverCoord(null); setVisibleSection(null);
          }}
          onHoverLake={(key) => setHoveredLake(key ? (lakes?.features.find((f) => f.properties?.key === key) ?? null) : null)}
          onSelectInfra={(props, category) => setSelectedInfra({ category, properties: props })}
          onHoverInfra={setHoveredInfraName}
          mapHoveredInfraName={hoveredInfraName}
          hydroStations={riverHydro}
          onSelectHydroStation={(props) => setSelectedHydroStation(props)}
          onHoverHydroStation={(key) => setHoveredHydroKey(key)}
          mapHoveredHydroKey={hoveredHydroKey}
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
          language={language.toLowerCase()}
          t={t}
          onMouseEnter={clearHover}
          onClose={() => setSelectedLake(null)}
        />
      )}
      {selectedGlacier && (
        <NatureModal
          variant="glacier"
          properties={selectedGlacier}
          massBalanceRecord={
            massBalance?.updated_at && Date.now() - new Date(massBalance.updated_at).getTime() < 2 * 24 * 60 * 60 * 1000
              ? (massBalanceLookup?.get(selectedGlacier["sgi-id"]) ?? null)
              : null
          }
          massBalanceReferencePeriod={massBalance?.reference_period ?? null}
          language={language.toLowerCase()}
          t={t}
          onMouseEnter={clearHover}
          onClose={() => setSelectedGlacier(null)}
        />
      )}
      {selectedRunoffStation && (
        <InfraModal
          variant="glacier_runoff"
          properties={selectedRunoffStation}
          language={language.toLowerCase()}
          t={t}
          onMouseEnter={clearHover}
          onClose={() => setSelectedRunoffStation(null)}
        />
      )}
      {selectedInfra && (
        <InfraModal
          variant={selectedInfra.category}
          properties={selectedInfra.properties}
          language={language.toLowerCase()}
          t={t}
          onMouseEnter={clearHover}
          onClose={() => setSelectedInfra(null)}
        />
      )}
      {selectedHydroStation && (
        <InfraModal
          variant="hydro_station"
          properties={selectedHydroStation}
          language={language.toLowerCase()}
          t={t}
          onMouseEnter={clearHover}
          onClose={() => setSelectedHydroStation(null)}
        />
      )}
      {selectedDatalakesStation && (
        <InfraModal
          variant="datalakes_station"
          properties={selectedDatalakesStation}
          t={t}
          onMouseEnter={clearHover}
          onClose={() => setSelectedDatalakesStation(null)}
        />
      )}

      <FeatureInfoStack
        selectedRiverName={selectedRiverName}
        selectedLake={selectedLake}
        selectedGlacier={selectedGlacier}
        t={t}
        bathymetryLoading={bathymetryLoading}
        hillshadeKey={hillshadeKey}
        glacierThicknessKey={glacierThicknessKey}
        glacierDepthLoading={glacierDepthLoading}
        glacierHistory={glacierHistory}
        infrastructure={infrastructure}
        riverInfra={riverInfra}
        riverHydro={riverHydro}
      />

      <div className="ui-overlay">
        <div className="top-rule" style={{ opacity: titleVisible ? 1 : 0 }} />
        <div className="title-block" style={{ opacity: titleVisible ? 1 : 0 }}>
          <div className="title-main">{t.title}</div>
          <div className="title-sub">{t.subtitle}</div>
          <div className="title-tagline">{t.tagline}</div>
          <div className="under-construction">{t.underConstruction}</div>
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
          {stripRiverSuffix(hoverInfo.name)}
          {hoverInfo.area != null && (
            <div className="hover-tooltip-sub">
              {[hoverInfo.year, `${hoverInfo.area.toFixed(1)} km²`, `${Math.round(hoverInfo.areaChange)}%`].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SwissRiversDeckGL;
