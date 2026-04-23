import CONFIG from "../../config.json";

export const featureBbox = (geometry) => {
  const pairs = geometry.type === "MultiPolygon"
    ? geometry.coordinates.flat(2)
    : geometry.coordinates.flat(1);
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of pairs) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
};

export const makeIconAtlas = (drawFn) => {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  drawFn(ctx);
  return canvas.toDataURL("image/png");
};

export const DAM_ATLAS = makeIconAtlas((ctx) => {
  ctx.beginPath();
  ctx.moveTo(12, 4); ctx.lineTo(20, 4); ctx.lineTo(24, 28); ctx.lineTo(8, 28);
  ctx.closePath();
  ctx.fill();
});
export const DAM_ICON_MAPPING = { dam: { x: 0, y: 0, width: 32, height: 32, mask: true } };

export const POWER_ATLAS = makeIconAtlas((ctx) => {
  ctx.beginPath();
  ctx.moveTo(19, 2); ctx.lineTo(8, 18); ctx.lineTo(16, 18); ctx.lineTo(12, 30); ctx.lineTo(24, 14); ctx.lineTo(16, 14);
  ctx.closePath();
  ctx.fill();
});
export const POWER_ICON_MAPPING = { power: { x: 0, y: 0, width: 32, height: 32, mask: true } };

export const DAM_WITH_POWER_ATLAS = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(122, 154, 184, 1)";
  ctx.beginPath();
  ctx.moveTo(12, 4); ctx.lineTo(20, 4); ctx.lineTo(24, 28); ctx.lineTo(8, 28);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(232, 164, 58, 1)";
  ctx.beginPath();
  ctx.moveTo(19, 2); ctx.lineTo(8, 18); ctx.lineTo(16, 18); ctx.lineTo(12, 30); ctx.lineTo(24, 14); ctx.lineTo(16, 14);
  ctx.closePath();
  ctx.fill();
  return canvas.toDataURL("image/png");
})();
export const DAM_WITH_POWER_ICON_MAPPING = { dam_with_power: { x: 0, y: 0, width: 32, height: 32, mask: false } };

export const HYDRO_ATLAS = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#C084FC";
  ctx.beginPath();
  ctx.roundRect(18, 8, 18, 48, 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#C084FC";
  ctx.beginPath();
  ctx.roundRect(18, 30, 18, 26, 2);
  ctx.fill();
  return canvas.toDataURL("image/png");
})();
export const HYDRO_ICON_MAPPING = { hydro: { x: 0, y: 0, width: 64, height: 64, mask: false } };

export const DATALAKES_ATLAS = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#93C5FD";
  ctx.beginPath();
  ctx.ellipse(32, 56, 18, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  const grad = ctx.createRadialGradient(27, 34, 2, 32, 39, 16);
  grad.addColorStop(0, "#FCD34D");
  grad.addColorStop(0.45, "#F97316");
  grad.addColorStop(1, "#C2410C");
  ctx.beginPath();
  ctx.arc(32, 39, 16, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "#94A3B8";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(32, 23);
  ctx.lineTo(32, 7);
  ctx.stroke();
  ctx.fillStyle = "#60A5FA";
  ctx.beginPath();
  ctx.moveTo(32, 7);
  ctx.lineTo(45, 13);
  ctx.lineTo(32, 19);
  ctx.closePath();
  ctx.fill();
  return canvas.toDataURL("image/png");
})();
export const DATALAKES_ICON_MAPPING = { buoy: { x: 0, y: 0, width: 64, height: 64, mask: false } };

export const STATION_ICON_SIZE = 256;
export const STATION_ICON_MAPPING = { icon: { x: 0, y: 0, width: STATION_ICON_SIZE, height: STATION_ICON_SIZE, mask: false } };
export const makeCircleAtlas = () => {
  const canvas = document.createElement("canvas");
  canvas.width = STATION_ICON_SIZE;
  canvas.height = STATION_ICON_SIZE;
  const ctx = canvas.getContext("2d");
  const c = STATION_ICON_SIZE / 2;
  ctx.fillStyle = "#22D3EE";
  ctx.beginPath();
  ctx.arc(c, c, c * 0.82, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = STATION_ICON_SIZE * 0.04;
  ctx.stroke();
  return canvas.toDataURL("image/png");
};
export const CIRCLE_ATLAS_FALLBACK = makeCircleAtlas();

export const SUPPORTS_DASH = (() => {
  try {
    const canvas = document.createElement("canvas");
    return !!canvas.getContext("webgl2");
  } catch (_) {
    return false;
  }
})();

export const GLACIER_YEAR_COLORS = {
  1850: [220, 80, 80],
  1931: [220, 150, 60],
  1973: [200, 200, 80],
  2016: [255, 255, 255],
};

export const chaikin = (pts, iterations = 3) => {
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

export const ANIMATE = true;
export const WAVE_WIDTH = 120;
export const HILLSHADE_FADE_MS = 800;

export const INITIAL_VIEW_STATE = {
  longitude: 8.2,
  latitude: 46.8,
  zoom: window.innerWidth <= 768 ? 6.5 : 7.5,
  pitch: 0,
  bearing: 0,
};

export const MAP_STYLE = {
  version: 8,
  glyphs: "https://vectortiles.geo.admin.ch/fonts/{fontstack}/{range}.pbf",
  sources: {
    "local-tiles": {
      type: "raster",
      tiles: [`${CONFIG.bucket}/${CONFIG.basemap}/{z}/{x}/{y}.png`],
      tileSize: 256,
      minzoom: 7,
      maxzoom: 12,
      bounds: [2.8125, 43.0689, 14.0625, 48.9225],
    },
    "base_v1.0.0": {
      type: "vector",
      url: "https://vectortiles.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/tiles.json",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#343434" } },
    { id: "local-tiles", type: "raster", source: "local-tiles" },
    {
      id: "contour_minor", type: "line", source: "base_v1.0.0", "source-layer": "contour_line",
      minzoom: 9, filter: ["!in", "class", "rock", "ice", "water"],
      paint: { "line-color": "rgba(255, 255, 255, 0.1)", "line-width": 0.5 },
    },
    {
      id: "contour_major", type: "line", source: "base_v1.0.0", "source-layer": "contour_line",
      minzoom: 5,
      filter: ["all", ["!", ["in", ["get", "class"], ["literal", ["rock", "ice", "water"]]]], ["==", ["%", ["get", "ele"], 100], 0]],
      paint: { "line-color": "rgba(255, 255, 255, 0.1)", "line-width": 0.5 },
    },
    {
      id: "roads_minor", type: "line", source: "base_v1.0.0", "source-layer": "transportation",
      minzoom: 10, filter: ["in", "class", "minor", "service", "tertiary"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "rgba(41, 41, 41, 0.6)", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 16, 2] },
    },
    {
      id: "roads_secondary", type: "line", source: "base_v1.0.0", "source-layer": "transportation",
      minzoom: 10, filter: ["in", "class", "secondary"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "rgba(60, 60, 60, 0.7)", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 16, 3] },
    },
    {
      id: "roads_primary", type: "line", source: "base_v1.0.0", "source-layer": "transportation",
      minzoom: 9, filter: ["in", "class", "primary", "trunk"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "rgba(60, 60, 60, 0.8)", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 16, 5] },
    },
    {
      id: "roads_motorway", type: "line", source: "base_v1.0.0", "source-layer": "transportation",
      minzoom: 7, filter: ["==", "class", "motorway"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "rgba(60, 60, 60, 0.85)", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.5, 16, 7] },
    },
    {
      id: "mountain_peak_label", type: "symbol", source: "base_v1.0.0", "source-layer": "mountain_peak",
      minzoom: 11,
      layout: {
        "text-field": ["get", "name:latin"], "text-font": ["Frutiger Neue Condensed Medium"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 11, 9, 16, 16],
        "text-anchor": "top", "text-offset": [0, 0.3],
        "symbol-sort-key": ["to-number", ["get", "rank"]],
      },
      paint: { "text-color": "rgba(220, 220, 220, 0.6)", "text-halo-color": "rgba(40, 40, 40, 0.6)", "text-halo-width": 1 },
    },
    {
      id: "place_city", type: "symbol", source: "base_v1.0.0", "source-layer": "place",
      minzoom: 8, maxzoom: 14, filter: ["==", "class", "city"],
      layout: {
        "text-field": ["get", "name:latin"], "text-font": ["Frutiger Neue Condensed Bold"],
        "text-size": ["interpolate", ["cubic-bezier", 0.5, 0.1, 0.7, 1], ["zoom"], 1, 6.6, 4, 7.2, 16, 28.8],
        "text-transform": "uppercase", "text-letter-spacing": 0.025,
        "text-anchor": "bottom-left", "text-offset": [0.35, 0.1],
        "symbol-sort-key": ["to-number", ["get", "rank"]],
      },
      paint: { "text-color": "rgba(255, 255, 255, 0.5)", "text-halo-color": "rgba(60, 60, 60, 0.75)", "text-halo-width": 1 },
    },
    {
      id: "place_town_village", type: "symbol", source: "base_v1.0.0", "source-layer": "place",
      minzoom: 9, maxzoom: 16, filter: ["in", "class", "town"],
      layout: {
        "text-field": ["get", "name:latin"],
        "text-font": ["match", ["get", "class"], "town", ["literal", ["Frutiger Neue Condensed Bold"]], ["literal", ["Frutiger Neue Condensed Medium"]]],
        "text-size": ["interpolate", ["cubic-bezier", 0.5, 0.1, 0.7, 1], ["zoom"], 4, 6.6, 10, ["match", ["get", "class"], "town", 10.8, 8.4], 16, ["match", ["get", "class"], "town", 16.8, 14.4]],
        "text-transform": ["match", ["get", "class"], "town", "uppercase", "none"],
        "text-letter-spacing": 0.025, "symbol-sort-key": ["to-number", ["get", "rank"]],
      },
      paint: { "text-color": "rgba(255, 255, 255, 0.5)", "text-halo-color": "rgba(60, 60, 60, 0.75)", "text-halo-width": 1 },
    },
  ],
};
