/**
 * Verify scoring improvements against the acceptance targets in the plan.
 * Rescores specific (date, site) pairs using current weatherCalc.ts logic
 * and compares to historical CSV baseline.
 *
 * Usage: npx tsx scripts/verify-scoring.ts
 */

import { launchSites } from '../src/data/launchSites.js';
import { LaunchSite } from '../src/types/weather.js';
import {
  calculateLCL,
  calculateConvectiveTemp,
  legacyTcEspy,
  calculateThermalStrength,
  calculateTopOfUsableLift,
  checkWindDirectionMatch,
  determineSoaringFlyability,
  determineThermalFlyability,
  determineFlyability,
  calculateXCPotential,
  estimateLiftedIndex,
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

interface Target {
  date: string;
  siteName: string;
  actualKm: number;
  baselineVerdict: string; // "poor" | "marginal" | "good"
  requiredMin: 'marginal' | 'good';
}

// Must-improve targets from plan acceptance bar
const TARGETS: Target[] = [
  { date: '2026-04-19', siteName: 'Dunlap',       actualKm: 104.6, baselineVerdict: 'marginal', requiredMin: 'marginal' },
  { date: '2026-04-05', siteName: 'Flynns',       actualKm: 101.3, baselineVerdict: 'poor',     requiredMin: 'marginal' },
  { date: '2026-04-18', siteName: 'Mt Diablo',    actualKm: 70.2,  baselineVerdict: 'poor',     requiredMin: 'marginal' },
  { date: '2026-04-18', siteName: 'Ed Levin',     actualKm: 72.0,  baselineVerdict: 'marginal', requiredMin: 'marginal' },
  { date: '2026-04-05', siteName: 'Tollhouse',    actualKm: 41.7,  baselineVerdict: 'marginal', requiredMin: 'marginal' },
  { date: '2026-04-04', siteName: 'Mission Peak', actualKm: 34.8,  baselineVerdict: 'poor',     requiredMin: 'marginal' },
  { date: '2026-04-05', siteName: 'Mt Diablo',    actualKm: 27.2,  baselineVerdict: 'poor',     requiredMin: 'marginal' },
];

// Anti-regression: CSV-verified true-negative days (poor + 0 flights). Must stay poor.
const ANTI_REGRESSION: Target[] = [
  { date: '2026-03-01', siteName: 'Mussel Rock',   actualKm: 0, baselineVerdict: 'poor', requiredMin: 'marginal' },
  { date: '2026-03-01', siteName: 'Mt Tamalpais',  actualKm: 0, baselineVerdict: 'poor', requiredMin: 'marginal' },
  { date: '2026-03-01', siteName: 'Sand City',     actualKm: 0, baselineVerdict: 'poor', requiredMin: 'marginal' },
  { date: '2026-03-01', siteName: 'Channing East', actualKm: 0, baselineVerdict: 'poor', requiredMin: 'marginal' },
  { date: '2026-03-01', siteName: 'Vollmer Peak',  actualKm: 0, baselineVerdict: 'poor', requiredMin: 'marginal' },
];

async function fetchHistoricalWeather(site: LaunchSite, date: string): Promise<any | null> {
  const params = new URLSearchParams({
    latitude: site.latitude.toFixed(4),
    longitude: site.longitude.toFixed(4),
    start_date: date,
    end_date: date,
    hourly: [
      'temperature_2m', 'dew_point_2m', 'relative_humidity_2m',
      'surface_pressure',
      'cloud_cover', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
      'cape', 'precipitation', 'precipitation_probability',
      ...PRESSURE_VARS,
    ].join(','),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'America/Los_Angeles',
  });
  const url = `https://archive-api.open-meteo.com/v1/archive?${params}`;
  const r = await fetch(url);
  if (!r.ok) { console.error(`  ! archive ${r.status} for ${site.id} ${date}`); return null; }
  return r.json();
}

function scoreNoon(site: LaunchSite, weather: any) {
  const h = weather?.hourly;
  if (!h?.time?.length) return null;
  let noonIdx = -1;
  for (let i = 0; i < h.time.length; i++) {
    if (h.time[i].endsWith('T12:00')) { noonIdx = i; break; }
  }
  if (noonIdx < 0) noonIdx = Math.floor(h.time.length / 2);

  const temperature = h.temperature_2m[noonIdx];
  const dewPoint = h.dew_point_2m[noonIdx];
  const windSpeed = Math.round(h.wind_speed_10m[noonIdx]);
  const windDirection = h.wind_direction_10m[noonIdx];
  const windGust = Math.round(h.wind_gusts_10m[noonIdx]);
  const cloudCover = h.cloud_cover[noonIdx];
  const cape = h.cape?.[noonIdx] ?? 0;
  const liftedIndex = estimateLiftedIndex(cape, temperature, dewPoint);

  const { lclMSL } = calculateLCL(temperature, dewPoint, site.elevation);
  const sfcPressure = h.surface_pressure?.[noonIdx] ?? null;
  const sounding = buildSounding(h, noonIdx);
  // Open-Meteo historical archive is surface-only — fall back to legacy Espy Tc
  // so historical scoring continues to work (with the same imperfect signal as before).
  // Forward forecast (fetch-weather.ts) uses real soundings.
  const tcon = sounding.length > 0
    ? calculateConvectiveTemp(dewPoint, sfcPressure, site.elevation, sounding, temperature)
    : legacyTcEspy(temperature, dewPoint);
  const thermalStrength = calculateThermalStrength(
    temperature, dewPoint, windSpeed, site.elevation, cape, liftedIndex
  );
  const topOfLift = calculateTopOfUsableLift(
    lclMSL, thermalStrength, windSpeed, site.elevation, cape, liftedIndex,
    undefined, temperature, dewPoint
  );
  const windDirectionMatch = checkWindDirectionMatch(windDirection, site.orientation);
  const soaringFlyability = determineSoaringFlyability(site, windSpeed, windGust, windDirectionMatch);
  const thermalFlyability = determineThermalFlyability(
    site, temperature, tcon, thermalStrength, windSpeed, windDirectionMatch, cloudCover
  );
  const { flyability, conditions } = determineFlyability(
    site, temperature, tcon, windSpeed, windGust, thermalStrength,
    topOfLift, windDirectionMatch, cloudCover, cape, liftedIndex
  );
  const { xcPotential } = calculateXCPotential(topOfLift, thermalStrength, windSpeed, site);

  return {
    windSpeed, windDirection, windGust,
    temperature: Math.round(temperature), tcon,
    thermalStrength, ceilingAGL: Math.round(topOfLift - site.elevation),
    cape: Math.round(cape), liftedIndex: Math.round(liftedIndex * 10) / 10,
    flyability, soaringFlyability, thermalFlyability, xcPotential, conditions,
  };
}

const rank = { poor: 0, marginal: 1, good: 2 } as const;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runSet(label: string, targets: Target[], expectImproveToMin: boolean) {
  console.log(`\n=== ${label} ===`);
  let pass = 0, fail = 0;
  for (const t of targets) {
    const site = launchSites.find(s => s.name === t.siteName);
    if (!site) { console.log(`  ! site not found: ${t.siteName}`); fail++; continue; }
    const w = await fetchHistoricalWeather(site, t.date);
    await delay(200);
    if (!w) { fail++; continue; }
    const p = scoreNoon(site, w);
    if (!p) { fail++; continue; }

    const meetsBar = expectImproveToMin
      ? rank[p.flyability] >= rank[t.requiredMin]
      : rank[p.flyability] < rank[t.requiredMin]; // anti-regression: should stay poor
    const mark = meetsBar ? 'PASS' : 'FAIL';
    if (meetsBar) pass++; else fail++;

    console.log(
      `  [${mark}] ${t.date}  ${t.siteName.padEnd(14)}  baseline=${t.baselineVerdict.padEnd(8)} now=${p.flyability.padEnd(8)} xc=${p.xcPotential.padEnd(8)}  ` +
      `actual=${t.actualKm}km  wind=${p.windSpeed}mph@${p.windDirection}  tStr=${p.thermalStrength} ceilAGL=${p.ceilingAGL}  LI=${p.liftedIndex} CAPE=${p.cape}  | ${p.conditions}`
    );
  }
  console.log(`  ${pass}/${pass + fail} passed`);
  return { pass, fail };
}

async function main() {
  const a = await runSet('ACCEPTANCE: must reach at least marginal', TARGETS, true);
  const b = await runSet('ANTI-REGRESSION: soaring sites on stable days must stay poor', ANTI_REGRESSION, false);
  console.log(`\nTotal acceptance: ${a.pass}/${a.pass + a.fail}, anti-regression: ${b.pass}/${b.pass + b.fail}`);
  if (a.fail > 0 || b.fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
