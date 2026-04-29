import { fetchBafuData } from './bafu.js';
import { fetchDatalakesData } from './datalakes.js';
import { fetchMassBalanceData } from './massbalance.js';
import { fetchRunoffData } from './runoff.js';

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === '/trigger/hydro') {
      ctx.waitUntil(this.scheduled({ cron: '*/30 * * * *' }, env, ctx));
      return new Response("Hydro cron triggered", { status: 202 });
    }
    if (path === '/trigger/glaciers') {
      ctx.waitUntil(this.scheduled({ cron: '0 7 * * *' }, env, ctx));
      return new Response("Glacier cron triggered", { status: 202 });
    }
    if (path === '/datalakes') {
      const obj = await env.BUCKET.get("hydro/datalakes.json");
      if (!obj) return new Response("Not found — trigger the cron first", { status: 404 });
      return new Response(obj.body, { headers: { "Content-Type": "application/json" } });
    }
    if (path === '/massbalance') {
      const obj = await env.BUCKET.get("glaciers/massbalance.json");
      if (!obj) return new Response("Not found — trigger the cron first", { status: 404 });
      return new Response(obj.body, { headers: { "Content-Type": "application/json" } });
    }
    if (path === '/runoff') {
      const obj = await env.BUCKET.get("glaciers/runoff.json");
      if (!obj) return new Response("Not found — trigger the cron first", { status: 404 });
      return new Response(obj.body, { headers: { "Content-Type": "application/json" } });
    }
    const obj = await env.BUCKET.get("hydro/stations.geojson");
    if (!obj) return new Response("Not found — trigger the cron first", { status: 404 });
    return new Response(obj.body, { headers: { "Content-Type": "application/json" } });
  },

  async scheduled(event, env, _ctx) {
    if (event.cron === '0 7 * * *') {
      const [mbData, runoffData] = await Promise.all([fetchMassBalanceData(), fetchRunoffData()]);
      await Promise.all([
        env.BUCKET.put("glaciers/massbalance.json", JSON.stringify(mbData), {
          httpMetadata: { contentType: "application/json" },
        }),
        env.BUCKET.put("glaciers/runoff.json", JSON.stringify(runoffData), {
          httpMetadata: { contentType: "application/json" },
        }),
      ]);
      console.log(`Updated glaciers/massbalance.json with ${mbData.glaciers.length} glaciers`);
      console.log(`Updated glaciers/runoff.json with ${runoffData.glaciers.length} glaciers`);
      return;
    }

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
