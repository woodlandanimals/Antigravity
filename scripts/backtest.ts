/**
 * Backtest our flyability scoring against actual XContest flights.
 *
 * Pulls US flights for a date range, matches each flight's takeoff coords
 * to the nearest of our launch sites (within radius), pulls Open-Meteo
 * historical weather for those (date, site) pairs, replays our scoring fn,
 * and writes a CSV comparing predicted rating vs actual flight outcomes.
 *
 * Usage: XC_USER=... XC_PASS=... npx tsx scripts/backtest.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATE_FROM = '2026-03-01';
const DATE_TO = '2026-04-30';
const MATCH_RADIUS_KM = 8;
const XC_KEY = '03ECF5952EB046AC-A53195E89B7996E4-D1B128E82C3E2A66';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// --- Login & XContest API ---

async function xcLogin(user: string, pass: string): Promise<string> {
  // First fetch login page to set baseline cookies
  const r0 = await fetch('https://www.xcontest.org/world/en/users/login/', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const cookies0 = parseCookies(r0.headers.getSetCookie?.() ?? []);

  const body = new URLSearchParams({
    'login[username]': user,
    'login[password]': pass,
    'login[persist_login]': 'Y',
  });
  const r = await fetch('https://www.xcontest.org/world/en/users/login/', {
    method: 'POST',
    body,
    redirect: 'manual',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader(cookies0),
    },
  });
  const cookies = parseCookies(r.headers.getSetCookie?.() ?? []);
  return cookieHeader({ ...cookies0, ...cookies });
}

function parseCookies(setCookies: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sc of setCookies) {
    const [pair] = sc.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}
function cookieHeader(c: Record<string, string>): string {
  return Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ');
}

interface XCFlight {
  pilot: string;
  date: string;       // YYYY-MM-DD
  takeoffName: string;
  lat: number;
  lon: number;
  distanceKm: number;
  points: number;
  type: string;
  link: string;
}

async function fetchUsFlightsForDate(cookieStr: string, date: string): Promise<XCFlight[]> {
  const out: XCFlight[] = [];
  let start = 0;
  const num = 100;
  while (true) {
    const u = `https://www.xcontest.org/api/data/?flights/world/2026&lng=en&key=${XC_KEY}` +
      `&list%5Bstart%5D=${start}&list%5Bnum%5D=${num}` +
      `&filter%5Bcountry%5D=US&filter%5Bdate%5D=${date}`;
    const r = await fetch(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Cookie': cookieStr,
        'Referer': 'https://www.xcontest.org/world/en/flights/',
      },
    });
    if (!r.ok) {
      console.error(`  ! API ${r.status} for ${date}`);
      break;
    }
    const j: any = await r.json();
    if (j.error) { console.error(`  ! API error: ${j.error.message}`); break; }
    for (const it of j.items ?? []) {
      const t = it.takeoff ?? {};
      const link: string = t.link ?? '';
      const m = link.match(/filter\[point\]=(-?[\d.]+)\s+(-?[\d.]+)/);
      if (!m) continue;
      const lon = parseFloat(m[1]);
      const lat = parseFloat(m[2]);
      out.push({
        pilot: it.pilot?.name ?? '?',
        date,
        takeoffName: t.name ?? '?',
        lat, lon,
        distanceKm: it.league?.route?.distance ?? 0,
        points: it.league?.route?.points ?? 0,
        type: it.league?.route?.type ?? '?',
        link: it.league?.flight?.link ?? '',
      });
    }
    const total = j.list?.numberItems ?? out.length;
    start += num;
    if (start >= total) break;
    await delay(200);
  }
  return out;
}

// --- Geo ---

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestSite(lat: number, lon: number): { site: LaunchSite | null; km: number } {
  let best: LaunchSite | null = null;
  let bestKm = Infinity;
  for (const s of launchSites) {
    const km = haversineKm(lat, lon, s.latitude, s.longitude);
    if (km < bestKm) { bestKm = km; best = s; }
  }
  return { site: best, km: bestKm };
}

// --- Open-Meteo historical weather ---

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
  if (!r.ok) {
    console.error(`  ! archive ${r.status} for ${site.id} ${date}`);
    return null;
  }
  return r.json();
}

// --- Score a (site, date) ---

interface PredictedRating {
  windSpeed: number;
  windDirection: number;
  windGust: number;
  temperature: number;
  tcon: number | null;
  thermalStrength: number;
  topOfLift: number;
  ceilingAGL: number;
  flyability: 'good' | 'marginal' | 'poor';
  soaringFlyability: 'good' | 'marginal' | 'poor';
  thermalFlyability: 'good' | 'marginal' | 'poor';
  xcPotential: 'high' | 'moderate' | 'low';
  conditions: string;
}

function scoreNoonForDate(site: LaunchSite, weather: any): PredictedRating | null {
  const h = weather?.hourly;
  if (!h?.time?.length) return null;

  // Find noon-ish (12:00 local)
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
  // Open-Meteo historical archive is surface-only; backtest falls back to legacy Tc.
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
    thermalStrength, topOfLift: Math.round(topOfLift),
    ceilingAGL: Math.round(topOfLift - site.elevation),
    flyability, soaringFlyability, thermalFlyability, xcPotential, conditions,
  };
}

// --- Main ---

async function main() {
  const user = process.env.XC_USER, pass = process.env.XC_PASS;
  if (!user || !pass) { console.error('Need XC_USER and XC_PASS'); process.exit(1); }

  console.log('Logging in to XContest...');
  const cookieStr = await xcLogin(user, pass);

  // Date range
  const dates: string[] = [];
  for (let d = new Date(DATE_FROM + 'T00:00'); d <= new Date(DATE_TO + 'T00:00'); d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  console.log(`Fetching XContest US flights for ${dates.length} dates...`);

  const allFlights: XCFlight[] = [];
  for (const date of dates) {
    process.stdout.write(`  ${date}: `);
    const flights = await fetchUsFlightsForDate(cookieStr, date);
    process.stdout.write(`${flights.length} flights\n`);
    allFlights.push(...flights);
    await delay(300);
  }
  console.log(`Total US flights: ${allFlights.length}`);

  // Match flights to nearest of OUR sites within radius
  type FlightMatch = XCFlight & { site: LaunchSite; matchKm: number };
  const matched: FlightMatch[] = [];
  const unmatched: XCFlight[] = [];
  for (const f of allFlights) {
    const { site, km } = nearestSite(f.lat, f.lon);
    if (site && km <= MATCH_RADIUS_KM) matched.push({ ...f, site, matchKm: km });
    else unmatched.push(f);
  }
  console.log(`Matched ${matched.length} flights to our sites (${unmatched.length} unmatched).`);

  // Aggregate by (date, site)
  type Key = string;
  const groups = new Map<Key, FlightMatch[]>();
  for (const f of matched) {
    const k = `${f.date}|${f.site.id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }

  // Determine which sites had flights at all in this period (to also score "predicted good but no flight" days)
  const sitesWithFlights = new Set([...groups.keys()].map(k => k.split('|')[1]));

  // Build (date, site) pairs to score: any (date, site) with flights, plus all dates for sites that had at least 1 flight in the period
  const pairsToScore = new Set<Key>();
  for (const k of groups.keys()) pairsToScore.add(k);
  for (const date of dates) {
    for (const sid of sitesWithFlights) pairsToScore.add(`${date}|${sid}`);
  }
  console.log(`Scoring ${pairsToScore.size} (date, site) pairs against historical weather...`);

  // Fetch weather + score
  const rows: any[] = [];
  let i = 0;
  for (const k of pairsToScore) {
    const [date, siteId] = k.split('|');
    const site = launchSites.find(s => s.id === siteId)!;
    const flights = groups.get(k) ?? [];
    if (++i % 20 === 0) console.log(`  ${i}/${pairsToScore.size}`);

    const weather = await fetchHistoricalWeather(site, date);
    await delay(120);
    if (!weather) continue;
    const pred = scoreNoonForDate(site, weather);
    if (!pred) continue;

    const maxKm = flights.reduce((m, f) => Math.max(m, f.distanceKm), 0);
    const numFlights = flights.length;
    const numXcFlights = flights.filter(f => f.distanceKm >= 10).length;

    // Classify hit/miss
    const ratingScore = pred.flyability === 'good' ? 2 : pred.flyability === 'marginal' ? 1 : 0;
    const actualScore = maxKm >= 30 ? 2 : maxKm >= 5 ? 1 : 0;
    const verdict =
      ratingScore === actualScore ? 'match' :
      ratingScore < actualScore ? 'underrated' : 'overrated';

    rows.push({
      date, site: site.name, siteId,
      flyability: pred.flyability,
      soaring: pred.soaringFlyability,
      thermal: pred.thermalFlyability,
      xcPotential: pred.xcPotential,
      windSpeed: pred.windSpeed,
      windDir: pred.windDirection,
      gust: pred.windGust,
      temp: pred.temperature,
      tcon: pred.tcon,
      thermalStrength: pred.thermalStrength,
      ceilingAGL: pred.ceilingAGL,
      conditions: pred.conditions,
      numFlights,
      numXcFlights,
      maxKm: Math.round(maxKm * 10) / 10,
      verdict,
    });
  }

  // Write CSV
  const outPath = path.join(__dirname, '../backtest-results.csv');
  const cols = [
    'date', 'site', 'flyability', 'soaring', 'thermal', 'xcPotential',
    'windSpeed', 'windDir', 'gust', 'temp', 'tcon', 'thermalStrength', 'ceilingAGL',
    'numFlights', 'numXcFlights', 'maxKm', 'verdict', 'conditions',
  ];
  const csv = [
    cols.join(','),
    ...rows
      .sort((a, b) => (a.date + a.site).localeCompare(b.date + b.site))
      .map(r => cols.map(c => {
        const v = (r as any)[c] ?? '';
        const s = String(v).replace(/"/g, '""');
        return /[,"\n]/.test(s) ? `"${s}"` : s;
      }).join(',')),
  ].join('\n');
  fs.writeFileSync(outPath, csv);
  console.log(`\nWrote ${rows.length} rows to ${outPath}`);

  // Summary: misses
  const underrated = rows.filter(r => r.verdict === 'underrated' && r.maxKm >= 10);
  const overrated  = rows.filter(r => r.verdict === 'overrated' && r.flyability === 'good');
  console.log(`\n=== Top 15 UNDERRATED (we said poor/marginal but real flights happened) ===`);
  for (const r of underrated.sort((a, b) => b.maxKm - a.maxKm).slice(0, 15)) {
    console.log(`  ${r.date}  ${r.site.padEnd(15)}  pred=${r.flyability.padEnd(8)} XC=${r.xcPotential.padEnd(8)}  actual: ${r.numFlights} flights, max ${r.maxKm}km  | ${r.conditions}`);
  }
  console.log(`\n=== Top 10 OVERRATED (we said good, no real flights) ===`);
  for (const r of overrated.filter(r => r.numFlights === 0).slice(0, 10)) {
    console.log(`  ${r.date}  ${r.site.padEnd(15)}  pred=good  XC=${r.xcPotential}  | ${r.conditions}`);
  }

  // Also dump unmatched flight takeoffs to help us discover missing sites
  const takeoffCounts = new Map<string, { count: number; lat: number; lon: number; maxKm: number }>();
  for (const f of unmatched) {
    const key = f.takeoffName;
    const e = takeoffCounts.get(key) ?? { count: 0, lat: f.lat, lon: f.lon, maxKm: 0 };
    e.count++;
    e.maxKm = Math.max(e.maxKm, f.distanceKm);
    takeoffCounts.set(key, e);
  }
  console.log(`\n=== Top 15 unmatched takeoff names (consider adding as sites) ===`);
  const sorted = [...takeoffCounts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 15);
  for (const [name, e] of sorted) {
    console.log(`  ${name.padEnd(28)}  ${e.count} flights, max ${Math.round(e.maxKm)}km  (${e.lat.toFixed(3)}, ${e.lon.toFixed(3)})`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
