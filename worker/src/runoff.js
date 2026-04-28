const URL = 'https://people.ee.ethz.ch/~mhuss/download/realtime/runoff_current.dat';

function parseNum(val) {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseInt10(val) {
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

export async function fetchRunoffData() {
  const r = await fetch(URL);
  if (!r.ok) throw new Error(`Failed to fetch runoff data: ${r.status}`);
  const text = await r.text();

  const lines = text.split('\n');
  const glaciers = [];
  let state_date = null;
  let evaluated_at = null;
  let reference_period = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('Runoff from Swiss glacier on:')) {
      state_date = line.replace('Runoff from Swiss glacier on:', '').trim();
      continue;
    }
    if (line.startsWith('Mass balance / runoff evaluation done at')) {
      evaluated_at = line.replace('Mass balance / runoff evaluation done at', '').trim();
      continue;
    }
    if (line.startsWith('with reference to period')) {
      reference_period = line.replace('with reference to period', '').trim();
      continue;
    }
    if (line.startsWith('#') || line.startsWith('1:') || line.startsWith('SGI')) continue;

    const parts = line.split(',');
    if (parts.length < 8) continue;

    const sgi_id = parts[0].trim();
    if (!sgi_id) continue;

    glaciers.push({
      sgi_id,
      runoff_today:    parseNum(parts[1]),
      pct_last_month:  parseNum(parts[2]),
      pct_last_2wk:    parseNum(parts[3]),
      pct_last_5d:     parseNum(parts[4]),
      pct_next_5d:     parseNum(parts[5]),
      has_data:        parseInt10(parts[6]) === 1,
      monitored:       parseInt10(parts[7]) === 1,
      name:            parts.slice(8).join(',').trim() || null,
    });
  }

  return {
    updated_at:       new Date().toISOString(),
    state_date,
    evaluated_at,
    reference_period,
    glaciers,
  };
}
