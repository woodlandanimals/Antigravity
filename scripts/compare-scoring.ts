/**
 * Compare new scoring against the baseline CSV without hitting XContest.
 * Rescores every (date, site) row in backtest-results.csv by fetching
 * fresh Open-Meteo historical and running current determineFlyability.
 * Reports:
 *   - how many target-underrated days improved
 *   - how many poor+0-flight days flipped to good/marginal (false positives)
 *   - how many good+real-flight days flipped to poor (false negatives)
 *
 * Usage: npx tsx scripts/compare-scoring.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { launchSites } from '../src/data/launchSites.js';
import { LaunchSite } from '../src/types/weather.js';
import {
  calculateLCL, calculateConvectiveTemp, legacyTcEspy,
  calculateThermalStrength, calculateTopOfUsableLift,
  checkWindDirectionMatch, determineFlyability, calculateXCPotential, estimateLiftedIndex,
  SoundingLevel,
} from '../src/lib/weatherCalc.js';

const PRESSURE_LEVELS = [1000, 925, 850, 700, 600, 500] as const;
const PRESSURE_VARS = PRESSURE_LEVELS.flatMap(p => [`temperature_${p}hPa`, `dew_point_${p}hPa`]);

function buildSounding(hourly: any, idx: number): SoundingLevel[] {
  const levels: SoundingLevel[] = [];
  for (const p of PRESSURE_LEVELS) {
    const t_F = hourly[`temperature_${p}hPa`]?.[idx];
    if (t_F == null || !Number.isFinite(t_F)) continue;
    levels.push({ p, T_C: (t_F - 32) * 5 / 9 });
  }
  return levels;
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const rank = { poor: 0, marginal: 1, good: 2 } as const;

async function fetchWeather(site: LaunchSite, date: string) {
  const params = new URLSearchParams({
    latitude: site.latitude.toFixed(4),
    longitude: site.longitude.toFixed(4),
    start_date: date, end_date: date,
    hourly: ['temperature_2m','dew_point_2m','surface_pressure','cloud_cover','wind_speed_10m','wind_direction_10m','wind_gusts_10m','cape', ...PRESSURE_VARS].join(','),
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', timezone: 'America/Los_Angeles',
  });
  const r = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
  if (!r.ok) return null;
  return r.json();
}

function score(site: LaunchSite, w: any) {
  const h = w?.hourly;
  if (!h?.time?.length) return null;
  let i = h.time.findIndex((t: string) => t.endsWith('T12:00'));
  if (i < 0) i = Math.floor(h.time.length / 2);
  const temp = h.temperature_2m[i], dew = h.dew_point_2m[i];
  const ws = Math.round(h.wind_speed_10m[i]);
  const wd = h.wind_direction_10m[i];
  const wg = Math.round(h.wind_gusts_10m[i]);
  const cc = h.cloud_cover[i];
  const cape = h.cape?.[i] ?? 0;
  const li = estimateLiftedIndex(cape, temp, dew);
  const { lclMSL } = calculateLCL(temp, dew, site.elevation);
  const sfcPressure = h.surface_pressure?.[i] ?? null;
  const sounding = buildSounding(h, i);
  const tcon = sounding.length > 0
    ? calculateConvectiveTemp(dew, sfcPressure, site.elevation, sounding, temp)
    : legacyTcEspy(temp, dew);
  const ts = calculateThermalStrength(temp, dew, ws, site.elevation, cape, li);
  const tol = calculateTopOfUsableLift(lclMSL, ts, ws, site.elevation, cape, li, undefined, temp, dew);
  const wm = checkWindDirectionMatch(wd, site.orientation);
  const { flyability } = determineFlyability(site, temp, tcon, ws, wg, ts, tol, wm, cc, cape, li);
  const { xcPotential } = calculateXCPotential(tol, ts, ws, site);
  return { flyability, xcPotential };
}

interface CsvRow {
  date: string; site: string; flyability: string; xcPotential: string;
  numFlights: number; maxKm: number; verdict: string;
}

async function main() {
  const csvPath = path.join(process.cwd(), 'backtest-results.csv');
  const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(Boolean);
  const header = lines[0].split(',');
  const col = (n: string) => header.indexOf(n);
  const parseRow = (line: string): CsvRow => {
    // naive CSV: handles quoted "conditions" with commas via regex split
    const parts: string[] = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { parts.push(cur); cur = ''; }
      else cur += ch;
    }
    parts.push(cur);
    return {
      date: parts[col('date')],
      site: parts[col('site')],
      flyability: parts[col('flyability')],
      xcPotential: parts[col('xcPotential')],
      numFlights: parseInt(parts[col('numFlights')] || '0'),
      maxKm: parseFloat(parts[col('maxKm')] || '0'),
      verdict: parts[col('verdict')],
    };
  };
  const rows = lines.slice(1).map(parseRow);

  // Site lookup by name
  const byName = new Map(launchSites.map(s => [s.name, s]));

  // Deduplicate by date+site
  const seen = new Set<string>();
  const uniq: CsvRow[] = [];
  for (const r of rows) {
    const k = `${r.date}|${r.site}`;
    if (!seen.has(k)) { seen.add(k); uniq.push(r); }
  }

  console.log(`Rescoring ${uniq.length} rows against current weatherCalc.ts...`);

  let improvedTrueFlights = 0;   // was poor/marginal, had real flights, now better
  let falsePositive = 0;         // was poor with 0 flights, now marginal/good
  let falseNegative = 0;         // was good with real flights, now worse
  let stable = 0;
  const examples = { improved: [] as string[], fp: [] as string[], fn: [] as string[] };

  let i = 0;
  for (const r of uniq) {
    const site = byName.get(r.site);
    if (!site) continue;
    if (++i % 50 === 0) console.log(`  ${i}/${uniq.length}`);
    const w = await fetchWeather(site, r.date);
    await delay(120);
    if (!w) continue;
    const s = score(site, w);
    if (!s) continue;

    const oldR = rank[r.flyability as keyof typeof rank];
    const newR = rank[s.flyability];
    const flights = r.numFlights > 0 && r.maxKm >= 10;

    if (newR > oldR && flights) {
      improvedTrueFlights++;
      if (examples.improved.length < 5) examples.improved.push(`${r.date} ${r.site}: ${r.flyability}→${s.flyability} (${r.maxKm}km, ${r.numFlights}fl)`);
    } else if (newR > oldR && r.numFlights === 0) {
      falsePositive++;
      if (examples.fp.length < 5) examples.fp.push(`${r.date} ${r.site}: ${r.flyability}→${s.flyability} (0 flights)`);
    } else if (newR < oldR && flights) {
      falseNegative++;
      if (examples.fn.length < 5) examples.fn.push(`${r.date} ${r.site}: ${r.flyability}→${s.flyability} (${r.maxKm}km)`);
    } else {
      stable++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Improved true-positive (had flights, rating up):  ${improvedTrueFlights}`);
  console.log(`  False-positive upgrade (no flights, rating up):   ${falsePositive}`);
  console.log(`  False-negative downgrade (had flights, down):     ${falseNegative}`);
  console.log(`  Unchanged:                                        ${stable}`);
  console.log(`\n  Net TP:FP = ${improvedTrueFlights}:${falsePositive}`);
  console.log(`\nImproved examples:`); examples.improved.forEach(e => console.log(`  ${e}`));
  console.log(`False-positive examples:`); examples.fp.forEach(e => console.log(`  ${e}`));
  console.log(`False-negative examples:`); examples.fn.forEach(e => console.log(`  ${e}`));
}

main().catch(e => { console.error(e); process.exit(1); });
