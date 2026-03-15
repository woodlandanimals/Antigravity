/**
 * Weather Data Fetcher Script
 *
 * This script fetches weather data for all launch sites and saves it as a JSON file.
 * It's designed to be run by a GitHub Action on an hourly schedule to avoid
 * hitting Open-Meteo API rate limits from client-side requests.
 *
 * Usage: npx tsx scripts/fetch-weather.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Import shared modules — single source of truth for sites, types, and calculations
import { launchSites } from '../src/data/launchSites';
import { LaunchSite, WeatherCondition, SiteForecast, HourlyDataPoint, GridForecast, GridMeta, GridDay, GridHour } from '../src/types/weather';
import {
  parseApiTime,
  estimateLiftedIndex,
  calculateLCL,
  calculateThermalStrength,
  calculateTopOfUsableLift,
  checkWindDirectionMatch,
  determineSoaringFlyability,
  determineThermalFlyability,
  determineFlyability,
  calculateXCPotential,
  analyzeRain,
  extractHourlyData
} from '../src/lib/weatherCalc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Batched site data fetching (all sites in 1 API call) ---

const HRRR_HOURLY_VARS = [
  'temperature_2m',
  'dew_point_2m',
  'relative_humidity_2m',
  'cloud_cover',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'cape',
  'lifted_index',
  'boundary_layer_height',
  'precipitation',
  'precipitation_probability'
];

const ECMWF_HOURLY_VARS = [
  'temperature_2m',
  'dew_point_2m',
  'relative_humidity_2m',
  'cloud_cover',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'cape',
  'precipitation',
  'precipitation_probability'
];

async function fetchBatchHRRR(sites: LaunchSite[]): Promise<any[]> {
  const params = new URLSearchParams({
    latitude: sites.map(s => s.latitude.toFixed(4)).join(','),
    longitude: sites.map(s => s.longitude.toFixed(4)).join(','),
    hourly: HRRR_HOURLY_VARS.join(','),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'America/Los_Angeles',
    forecast_days: '2'
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HRRR batch API error: ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [data];
}

async function fetchBatchECMWF(sites: LaunchSite[]): Promise<any[]> {
  const params = new URLSearchParams({
    latitude: sites.map(s => s.latitude.toFixed(4)).join(','),
    longitude: sites.map(s => s.longitude.toFixed(4)).join(','),
    hourly: ECMWF_HOURLY_VARS.join(','),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'America/Los_Angeles',
    forecast_days: '7'
  });

  const url = `https://api.open-meteo.com/v1/ecmwf?${params}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ECMWF batch API error: ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [data];
}

function processDataForDay(
  site: LaunchSite,
  data: any,
  targetDate: string,
  isHRRR: boolean
): WeatherCondition | null {
  try {
    if (!data || !data.hourly) {
      return null;
    }

    const hourly = data.hourly;

    const targetIndices: number[] = [];
    hourly.time.forEach((time: string, index: number) => {
      const { dateStr, hour } = parseApiTime(time);
      if (dateStr === targetDate && hour >= 10 && hour <= 14) {
        targetIndices.push(index);
      }
    });

    if (targetIndices.length === 0) {
      return null;
    }

    const noonIndex = targetIndices.reduce((closest, current) => {
      const { hour: closestHour } = parseApiTime(hourly.time[closest]);
      const { hour: currentHour } = parseApiTime(hourly.time[current]);
      return Math.abs(currentHour - 12) < Math.abs(closestHour - 12) ? current : closest;
    });

    const hourlyData = extractHourlyData(site, hourly, targetDate);

    const temperature = hourly.temperature_2m[noonIndex];
    const dewPoint = hourly.dew_point_2m[noonIndex];
    const windSpeed = Math.round(hourly.wind_speed_10m[noonIndex]);
    const windDirection = hourly.wind_direction_10m[noonIndex];
    const windGust = Math.round(hourly.wind_gusts_10m[noonIndex]);
    const relativeHumidity = hourly.relative_humidity_2m[noonIndex];
    const cloudCover = hourly.cloud_cover[noonIndex];

    const cape = hourly.cape?.[noonIndex] || 0;
    const liftedIndex = isHRRR
      ? (hourly.lifted_index?.[noonIndex] || 0)
      : estimateLiftedIndex(cape, temperature, dewPoint);
    const boundaryLayerHeight = isHRRR ? (hourly.boundary_layer_height?.[noonIndex] || undefined) : undefined;

    const { lclMSL, tcon } = calculateLCL(temperature, dewPoint, site.elevation);

    const thermalStrength = calculateThermalStrength(
      temperature, dewPoint, windSpeed, site.elevation,
      cape, liftedIndex, boundaryLayerHeight
    );

    const topOfLift = calculateTopOfUsableLift(
      lclMSL, thermalStrength, windSpeed, site.elevation,
      cape, liftedIndex, boundaryLayerHeight, temperature, dewPoint
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

    const rainInfo = analyzeRain(hourly, targetDate);
    const launchTime = '12:00 PM';
    const { xcPotential, xcReason } = calculateXCPotential(topOfLift, thermalStrength, windSpeed, site);

    return {
      date: targetDate,
      windSpeed,
      windDirection,
      windGust,
      temperature: Math.round(temperature),
      dewPoint: Math.round(dewPoint),
      tcon,
      thermalStrength,
      topOfLift: Math.round(topOfLift),
      flyability,
      conditions,
      soaringFlyability,
      thermalFlyability,
      launchTime,
      xcPotential,
      xcReason,
      hourlyData,
      blDepth: boundaryLayerHeight,
      cape: Math.round(cape),
      liftedIndex: Math.round(liftedIndex * 10) / 10,
      convergence: 0,
      relativeHumidity: Math.round(relativeHumidity),
      cloudCover: Math.round(cloudCover),
      windDirectionMatch,
      rainInfo
    };
  } catch (error) {
    console.error(`Failed to process data for ${site.name} on ${targetDate}:`, error);
    return null;
  }
}

function processSiteForecasts(
  sites: LaunchSite[],
  hrrrResults: any[],
  ecmwfResults: any[],
  targetDates: string[]
): SiteForecast[] {
  return sites.map((site, siteIdx) => {
    const hrrrData = hrrrResults[siteIdx] || null;
    const ecmwfData = ecmwfResults[siteIdx] || null;
    const forecastData: WeatherCondition[] = [];

    for (let i = 0; i < targetDates.length; i++) {
      const targetDate = targetDates[i];
      let dayForecast: WeatherCondition | null = null;

      if (i <= 1 && hrrrData) {
        dayForecast = processDataForDay(site, hrrrData, targetDate, true);
      } else if (ecmwfData) {
        dayForecast = processDataForDay(site, ecmwfData, targetDate, false);
      }

      if (dayForecast) {
        forecastData.push(dayForecast);
      } else {
        forecastData.push({
          date: targetDate,
          windSpeed: 0,
          windDirection: 0,
          windGust: 0,
          temperature: 0,
          dewPoint: 0,
          tcon: 0,
          thermalStrength: 0,
          topOfLift: site.elevation,
          flyability: 'poor',
          conditions: 'Forecast not available',
          soaringFlyability: 'poor',
          thermalFlyability: 'poor',
          launchTime: '12:00 PM',
          xcPotential: 'low',
          xcReason: 'No data',
          cape: 0,
          liftedIndex: 0,
          convergence: 0,
          relativeHumidity: 0,
          cloudCover: 0,
          windDirectionMatch: false
        });
      }
    }

    return { site, forecast: forecastData };
  });
}

// --- Grid data fetching for continuous map overlays ---

const GRID: GridMeta = {
  latMin: 33.5, latMax: 40.0, latStep: 0.4,
  lonMin: -124.0, lonMax: -117.0, lonStep: 0.4,
  rows: 17, cols: 18
};

function generateGridPoints(): { lats: number[]; lons: number[] } {
  const lats: number[] = [];
  const lons: number[] = [];
  for (let r = 0; r < GRID.rows; r++) {
    for (let c = 0; c < GRID.cols; c++) {
      lats.push(GRID.latMin + r * GRID.latStep);
      lons.push(GRID.lonMin + c * GRID.lonStep);
    }
  }
  return { lats, lons };
}

async function fetchGridBatch(lats: number[], lons: number[]): Promise<any> {
  const params = new URLSearchParams({
    latitude: lats.map(l => l.toFixed(2)).join(','),
    longitude: lons.map(l => l.toFixed(2)).join(','),
    hourly: [
      'temperature_2m',
      'dew_point_2m',
      'cloud_cover',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
      'cape',
      'lifted_index',
      'boundary_layer_height'
    ].join(','),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'America/Los_Angeles',
    forecast_days: '2'
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Grid HRRR API error: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function processGridData(allResponses: any[], targetDates: string[]): GridDay[] {
  const days: GridDay[] = [];

  for (const targetDate of targetDates) {
    const hours: Record<string, GridHour> = {};

    for (let h = 6; h <= 18; h++) {
      const cape: number[] = [];
      const liftedIndex: number[] = [];
      const cloudCover: number[] = [];
      const windSpeed: number[] = [];
      const windDir: number[] = [];
      const thermalStr: number[] = [];
      const topOfLiftArr: number[] = [];
      const blHeight: number[] = [];

      for (let ptIdx = 0; ptIdx < GRID.rows * GRID.cols; ptIdx++) {
        const data = allResponses[ptIdx];
        if (!data || !data.hourly) {
          // Push zeros for missing data
          cape.push(0); liftedIndex.push(0); cloudCover.push(0);
          windSpeed.push(0); windDir.push(0); thermalStr.push(0);
          topOfLiftArr.push(0); blHeight.push(0);
          continue;
        }

        const hourly = data.hourly;
        const elevation = (data.elevation || 0) * 3.28084; // meters to feet

        // Find the index for this date+hour
        let idx = -1;
        for (let i = 0; i < hourly.time.length; i++) {
          const { dateStr, hour: apiHour } = parseApiTime(hourly.time[i]);
          if (dateStr === targetDate && apiHour === h) {
            idx = i;
            break;
          }
        }

        if (idx === -1) {
          cape.push(0); liftedIndex.push(0); cloudCover.push(0);
          windSpeed.push(0); windDir.push(0); thermalStr.push(0);
          topOfLiftArr.push(0); blHeight.push(0);
          continue;
        }

        const temp = hourly.temperature_2m[idx] ?? 0;
        const dew = hourly.dew_point_2m[idx] ?? 0;
        const ws = Math.round(hourly.wind_speed_10m[idx] ?? 0);
        const wd = Math.round(hourly.wind_direction_10m[idx] ?? 0);
        const cc = Math.round(hourly.cloud_cover[idx] ?? 0);
        const cp = Math.round(hourly.cape?.[idx] ?? 0);
        const li = Math.round((hourly.lifted_index?.[idx] ?? 0) * 10) / 10;
        const bl = Math.round(hourly.boundary_layer_height?.[idx] ?? 0);

        const { lclMSL } = calculateLCL(temp, dew, elevation);
        const ts = calculateThermalStrength(temp, dew, ws, elevation, cp, li, bl || undefined);
        const tol = Math.round(calculateTopOfUsableLift(
          lclMSL, ts, ws, elevation, cp, li, bl || undefined, temp, dew
        ));

        cape.push(cp);
        liftedIndex.push(li);
        cloudCover.push(cc);
        windSpeed.push(ws);
        windDir.push(wd);
        thermalStr.push(ts);
        topOfLiftArr.push(tol);
        blHeight.push(bl);
      }

      hours[String(h)] = {
        cape, liftedIndex, cloudCover, windSpeed,
        windDir: windDir, thermalStrength: thermalStr,
        topOfLift: topOfLiftArr, blHeight
      };
    }

    days.push({ date: targetDate, hours });
  }

  return days;
}

async function fetchGridForecast(targetDates: string[]): Promise<GridForecast> {
  console.log('\nFetching grid data for map overlays...');
  const { lats, lons } = generateGridPoints();
  const totalPoints = lats.length;
  console.log(`Grid: ${GRID.rows}x${GRID.cols} = ${totalPoints} points`);

  // Batch into groups of 50 for the API
  const BATCH_SIZE = 50;
  const allResponses: any[] = new Array(totalPoints).fill(null);

  for (let start = 0; start < totalPoints; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, totalPoints);
    const batchLats = lats.slice(start, end);
    const batchLons = lons.slice(start, end);
    const batchNum = Math.floor(start / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(totalPoints / BATCH_SIZE);

    console.log(`  Grid batch ${batchNum}/${totalBatches} (${end - start} points)...`);

    try {
      const result = await fetchGridBatch(batchLats, batchLons);

      // Single point returns object, multi returns array
      if (Array.isArray(result)) {
        for (let i = 0; i < result.length; i++) {
          allResponses[start + i] = result[i];
        }
      } else {
        allResponses[start] = result;
      }
    } catch (error) {
      console.error(`  Grid batch ${batchNum} failed:`, error);
    }

    // 306 grid + 46 site locations = 352 total per run, well under 600/min limit
    await delay(300);
  }

  // Only process today + tomorrow for grid (HRRR data)
  const gridDates = targetDates.slice(0, 2);
  const days = processGridData(allResponses, gridDates);

  return {
    generated: new Date().toISOString(),
    grid: GRID,
    days
  };
}

async function main() {
  console.log('Starting weather data fetch...');
  console.log(`Fetching data for ${launchSites.length} sites (batched)`);

  const now = new Date();
  const getPacificDateString = (daysOffset: number = 0): string => {
    const date = new Date(now);
    date.setDate(date.getDate() + daysOffset);
    const pacificDateStr = date.toLocaleDateString('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const [month, day, year] = pacificDateStr.split('/');
    return `${year}-${month}-${day}`;
  };
  const targetDates = Array.from({ length: 7 }, (_, i) => getPacificDateString(i));

  // Fetch all sites in 2 batch calls (HRRR + ECMWF) instead of 46 individual calls
  let hrrrResults: any[] = [];
  let ecmwfResults: any[] = [];

  try {
    console.log('Fetching HRRR batch (all sites)...');
    hrrrResults = await fetchBatchHRRR(launchSites);
    console.log(`  Got ${hrrrResults.length} HRRR results`);
  } catch (error) {
    console.error('HRRR batch failed:', error);
    hrrrResults = new Array(launchSites.length).fill(null);
  }

  await delay(500);

  try {
    console.log('Fetching ECMWF batch (all sites)...');
    ecmwfResults = await fetchBatchECMWF(launchSites);
    console.log(`  Got ${ecmwfResults.length} ECMWF results`);
  } catch (error) {
    console.error('ECMWF batch failed:', error);
    ecmwfResults = new Array(launchSites.length).fill(null);
  }

  await delay(500);

  const forecasts = processSiteForecasts(launchSites, hrrrResults, ecmwfResults, targetDates);

  const outputDir = path.join(__dirname, '../public/data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write site forecasts
  const outputPath = path.join(outputDir, 'forecast.json');
  const output = {
    generated: new Date().toISOString(),
    forecasts
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nSuccess! Written ${forecasts.length} site forecasts to ${outputPath}`);

  // Fetch and write grid data for map overlays
  try {
    const gridForecast = await fetchGridForecast(targetDates);
    const gridPath = path.join(outputDir, 'gridForecast.json');
    fs.writeFileSync(gridPath, JSON.stringify(gridForecast));
    const gridSizeKB = Math.round(fs.statSync(gridPath).size / 1024);
    console.log(`Written grid data to ${gridPath} (${gridSizeKB} KB)`);
  } catch (error) {
    console.error('Failed to fetch grid data:', error);
    // Non-fatal — site forecasts still written
  }

  console.log(`Generated at: ${output.generated}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
