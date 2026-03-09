import axios from "axios";

// Build binary attribute buffers for PathLayer.
// Width is proportional to discharge_m3s from the feature's properties.
export const processGeoJson = (geojson) => {
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

  // Pre-allocate color buffer once; starts fully transparent so rivers are
  // invisible before animation begins. The animation loop fills it in-place.
  const colors = new Uint8Array(totalVertices * 4);

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
    colors,
  };
};

export const fetchDataParallel = async (urls) => {
  const requests = Object.entries(urls).map(([key, url]) =>
    axios
      .get(url)
      .then((response) => ({ [key]: response.data }))
      .catch(() => ({ [key]: {} }))
  );
  const responses = await Promise.all(requests);
  const result = Object.assign({}, ...responses);
  return result;
};

const isSimilarSubstring = (item, term) => {
  for (let i = 0; i <= item.length - term.length; i++) {
    let differences = 0;
    for (let j = 0; j < term.length; j++) {
      if (item[i + j] !== term[j]) differences++;
      if (differences > 1) break;
    }
    if (differences <= 1) return true;
  }
  return false;
};

export const searchList = (search, list) => {
  list.map((l) => {
    l.display = Object.values(l.name).some((item) =>
      isSimilarSubstring(
        item.toLowerCase().replaceAll(" ", ""),
        search.toLowerCase().replaceAll(" ", "")
      )
    );
    return l;
  });
  return list;
};

export const inBounds = (latitude, longitude, bounds) => {
  if (
    latitude >= bounds._southWest.lat &&
    longitude >= bounds._southWest.lng &&
    latitude <= bounds._northEast.lat &&
    longitude <= bounds._northEast.lng
  ) {
    return true;
  }
  return false;
};

export const onMouseOver = (event) => {
  try {
    document.getElementById(
      "pin-" + event.target.id.split("-")[1]
    ).style.border = "2px solid orange";
  } catch (e) {}
};

export const onMouseOut = (event) => {
  try {
    document.getElementById(
      "pin-" + event.target.id.split("-")[1]
    ).style.border = "2px solid transparent";
  } catch (e) {}
};

export const sortList = (list, property, ascending) => {
  var x = 1;
  var y = -1;
  if (ascending) {
    x = -1;
    y = 1;
  }
  return list.sort((a, b) => (a[property] > b[property] ? y : x));
};
