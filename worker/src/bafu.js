import stationMap from './station_map.json';

const APIS = {
  pq:          "https://www.hydrodaten.admin.ch/web-hydro-maps/hydro_sensor_pq.geojson",
  temperature: "https://www.hydrodaten.admin.ch/web-hydro-maps/hydro_sensor_temperature.geojson",
  oxygen:      "https://www.hydrodaten.admin.ch/web-hydro-maps/hydro_sensor_o2.geojson",
  turbidity:   "https://www.hydrodaten.admin.ch/web-hydro-maps/hydro_sensor_murk.geojson",
};

// swisstopo approximation formula: LV95 (EPSG:2056) → WGS84
function lv95ToWgs84(e, n) {
  const y = (e - 2600000) / 1000000;
  const x = (n - 1200000) / 1000000;
  const lon = (2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y) * 100 / 36;
  const lat = (16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.0140 * x * x * x) * 100 / 36;
  return [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
}

// Parse a numeric value from strings like "4.0 m³/s" or "462.93 m ü.M." or "1.1"
function parseNum(val) {
  if (val === null || val === undefined) return null;
  const n = parseFloat(String(val));
  return isNaN(n) ? null : n;
}

function extractDischarge(props) {
  return {
    last_value:       parseNum(props.last_value),
    unit:             props.unit_short || props.unit || null,
    last_measured_at: props.sensor_discharge_measured_at || props.last_measured_at || null,
    min_24h:          parseNum(props.min_24h),
    max_24h:          parseNum(props.max_24h),
    mean_24h:         parseNum(props.mean_24h),
    wl_1:             parseNum(props.wl_1),
    wl_2:             parseNum(props.wl_2),
    wl_3:             parseNum(props.wl_3),
    wl_4:             parseNum(props.wl_4),
  };
}

function extractWaterLevel(props) {
  const last_value = parseNum(props.sensor_waterlevel_last_value);
  if (last_value === null) return null;
  return {
    last_value,
    unit:             "m ü.M.",
    last_measured_at: props.sensor_waterlevel_measured_at || null,
    min_24h:          parseNum(props.sensor_waterlevel_min_24h),
    max_24h:          parseNum(props.sensor_waterlevel_max_24h),
    mean_24h:         parseNum(props.sensor_waterlevel_mean_24h),
    wl_1:             parseNum(props.wl_1),
    wl_2:             parseNum(props.wl_2),
    wl_3:             parseNum(props.wl_3),
    wl_4:             parseNum(props.wl_4),
  };
}

function extractParam(props) {
  return {
    last_value:       parseNum(props.last_value),
    unit:             props.unit_short || props.unit || null,
    last_measured_at: props.last_measured_at || null,
    min_24h:          parseNum(props.min_24h),
    max_24h:          parseNum(props.max_24h),
    mean_24h:         parseNum(props.mean_24h),
  };
}

function makeStation(key, props, coords, snap, params) {
  return {
    key,
    label:           props.label,
    hydro_body_name: props.hydro_body_name,
    river_id:        snap.river_id,
    river_name:      snap.river_name,
    lake_key:        snap.lake_key,
    coordinates:     coords,
    discharge:       null,
    water_level:     null,
    temperature:     null,
    oxygen:          null,
    turbidity:       null,
    ...params,
  };
}

export async function fetchBafuData() {
  const [pqData, tempData, o2Data, murkData] = await Promise.all(
    Object.values(APIS).map(url => fetch(url).then(r => {
      if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
      return r.json();
    }))
  );

  // Map<key, station> — geometry + merged params
  const stations = new Map();

  // Seed from discharge dataset (largest, most stations)
  for (const feature of pqData.features) {
    const key = String(feature.properties.key);
    const [e, n] = feature.geometry.coordinates;
    const snap = stationMap[key] ?? { river_id: null, river_name: null, lake_key: null };
    stations.set(key, makeStation(key, feature.properties, lv95ToWgs84(e, n), snap, {
      discharge:   feature.properties.kind === "lake" ? null : extractDischarge(feature.properties),
      water_level: extractWaterLevel(feature.properties),
    }));
  }

  // Merge temperature, oxygen, turbidity
  for (const [data, paramKey, extract] of [
    [tempData,  'temperature', extractParam],
    [o2Data,    'oxygen',      extractParam],
    [murkData,  'turbidity',   extractParam],
  ]) {
    for (const feature of data.features) {
      const key = String(feature.properties.key);
      const param = extract(feature.properties);
      if (stations.has(key)) {
        stations.get(key)[paramKey] = param;
      } else {
        const [e, n] = feature.geometry.coordinates;
        const snap = stationMap[key] ?? { river_id: null, river_name: null, lake_key: null };
        stations.set(key, makeStation(key, feature.properties, lv95ToWgs84(e, n), snap, {
          [paramKey]: param,
        }));
      }
    }
  }

  return {
    type: "FeatureCollection",
    updated_at: new Date().toISOString(),
    features: Array.from(stations.values()).map(s => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: s.coordinates },
      properties: {
        key:             s.key,
        label:           s.label,
        hydro_body_name: s.hydro_body_name,
        river_id:        s.river_id,
        river_name:      s.river_name,
        lake_key:        s.lake_key,
        discharge:       s.discharge,
        water_level:     s.water_level,
        temperature:     s.temperature,
        oxygen:          s.oxygen,
        turbidity:       s.turbidity,
      },
    })),
  };
}
