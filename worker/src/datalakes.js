import datalakesConfig from './datalakes.json';

const BASE = 'https://api.datalakes-eawag.ch';

function closestIdx(arr, target) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i] - target);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

async function fetchYParam(datasetId, axis, unit) {
  const r = await fetch(`${BASE}/data/${datasetId}/${axis}`);
  if (!r.ok) throw new Error(`Datalakes /data/${datasetId}/${axis}: ${r.status}`);
  const { time, value } = await r.json();
  return { last_value: value, unit, last_measured_at: time };
}

async function getRawFile(datasetId, cache) {
  if (cache.has(datasetId)) return cache.get(datasetId);
  const promise = (async () => {
    const r1 = await fetch(`${BASE}/files/recent/${datasetId}`);
    if (!r1.ok) throw new Error(`Datalakes /files/recent/${datasetId}: ${r1.status}`);
    const { id } = await r1.json();
    const r2 = await fetch(`${BASE}/files/${id}?get=raw`);
    if (!r2.ok) throw new Error(`Datalakes /files/${id}?get=raw: ${r2.status}`);
    return r2.json();
  })();
  cache.set(datasetId, promise);
  return promise;
}

async function fetchZParam(datasetId, param, cache) {
  const file = await getRawFile(datasetId, cache);
  const { unit, axis, depth: depths, max_depth } = param;

  // All z-axis files use the same join format: x (timestamps), y (depths), {axis} (2D [depth][time])
  const data = file[axis];
  const lastT = file.x.length - 1;
  const timestamp = new Date(file.x[lastT] * 1000).toISOString();

  if (max_depth) {
    let maxVal = -Infinity, maxDepth = null;
    for (let di = 0; di < file.y.length; di++) {
      const v = data[di][lastT];
      if (v != null && v > maxVal) { maxVal = v; maxDepth = file.y[di]; }
    }
    return { last_value: maxVal, unit, depth: maxDepth, last_measured_at: timestamp };
  }

  if (depths.length === 1) {
    const di = closestIdx(file.y, depths[0]);
    return { last_value: data[di][lastT], unit, depth: file.y[di], last_measured_at: timestamp };
  }

  return depths.map(target => {
    const di = closestIdx(file.y, target);
    return { last_value: data[di][lastT], unit, depth: file.y[di], last_measured_at: timestamp };
  });
}

export async function fetchDatalakesData() {
  const stations = [];
  for (const station of datalakesConfig) {
    const fileCache = new Map();
    const parameters = {};
    for (const dataset of station.dataset) {
      for (const param of dataset.parameters) {
        const result = param.axis.startsWith('z')
          ? await fetchZParam(dataset.id, param, fileCache)
          : await fetchYParam(dataset.id, param.axis, param.unit);
        if (Array.isArray(result)) {
          parameters[param.type] = result.map(r => ({ ...r, dataset_id: dataset.id }));
        } else {
          parameters[param.type] = { ...result, dataset_id: dataset.id };
        }
      }
    }
    stations.push({
      name: station.name,
      image: station.image,
      coordinates: [station.longitude, station.latitude],
      parameters,
    });
  }
  return { updated_at: new Date().toISOString(), stations };
}
