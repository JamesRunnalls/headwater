const URL = 'https://people.ee.ethz.ch/~mhuss/download/realtime/massbalance_current.dat';

function parseNum(val) {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseInt10(val) {
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

export async function fetchMassBalanceData() {
  const r = await fetch(URL);
  if (!r.ok) throw new Error(`Failed to fetch mass balance data: ${r.status}`);
  const text = await r.text();

  const lines = text.split('\n');
  const glaciers = [];
  let state_date = null;
  let evaluated_at = null;
  let reference_period = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('State of Swiss glacier on:')) {
      state_date = line.replace('State of Swiss glacier on:', '').trim();
      continue;
    }
    if (line.startsWith('Mass balance current evaluation done at')) {
      evaluated_at = line.replace('Mass balance current evaluation done at', '').trim();
      continue;
    }
    if (line.startsWith('with reference to period')) {
      reference_period = line.replace('with reference to period', '').trim();
      continue;
    }
    // Skip comment/header lines
    if (line.startsWith('#') || line.startsWith('1:') || line.startsWith('SGI')) continue;

    const parts = line.split(',');
    if (parts.length < 6) continue;

    const sgi_id = parts[0].trim();
    if (!sgi_id) continue;

    glaciers.push({
      sgi_id,
      mass_balance_sigma: parseNum(parts[1]),
      classification:     parseInt10(parts[2]),
      mass_balance_mwe:   parseNum(parts[3]),
      has_data:           parseInt10(parts[4]) === 1,
      monitored:          parseInt10(parts[5]) === 1,
      name:               parts.slice(6).join(',').trim() || null,
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
