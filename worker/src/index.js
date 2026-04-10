import { fetchBafuData } from './bafu.js';
import { fetchDatalakesData } from './datalakes.js';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/datalakes') {
      const obj = await env.BUCKET.get("hydro/datalakes.json");
      if (!obj) return new Response("Not found — trigger the cron first", { status: 404 });
      return new Response(obj.body, { headers: { "Content-Type": "application/json" } });
    }
    const obj = await env.BUCKET.get("hydro/stations.geojson");
    if (!obj) return new Response("Not found — trigger the cron first", { status: 404 });
    return new Response(obj.body, { headers: { "Content-Type": "application/json" } });
  },

  async scheduled(_event, env, _ctx) {
    const [bafuData, datalakesData] = await Promise.all([
      fetchBafuData(),
      fetchDatalakesData(),
    ]);

    await env.BUCKET.put("hydro/stations.geojson", JSON.stringify(bafuData), {
      httpMetadata: { contentType: "application/json" },
    });
    await env.BUCKET.put("hydro/datalakes.json", JSON.stringify(datalakesData), {
      httpMetadata: { contentType: "application/json" },
    });

    console.log(`Updated hydro/stations.geojson with ${bafuData.features.length} stations`);
    console.log(`Updated hydro/datalakes.json with ${datalakesData.stations.length} stations`);
  },
};
