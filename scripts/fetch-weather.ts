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
import { LaunchSite, WeatherCondition, SiteForecast, HourlyDataPoint } from '../src/types/weather';
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

async function fetchHRRRData(site: LaunchSite): Promise<any> {
  const params = new URLSearchParams({
    latitude: site.latitude.toFixed(4),
    longitude: site.longitude.toFixed(4),
    hourly: [
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
    ].join(','),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'America/Los_Angeles',
    forecast_days: '2'
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HRRR API error: ${response.status}`);
  }

  return response.json();
}

async function fetchECMWFData(site: LaunchSite): Promise<any> {
  const params = new URLSearchParams({
    latitude: site.latitude.toFixed(4),
    longitude: site.longitude.toFixed(4),
    hourly: [
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
    ].join(','),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'America/Los_Angeles',
    forecast_days: '7'
  });

  const url = `https://api.open-meteo.com/v1/ecmwf?${params}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`ECMWF API error: ${response.status}`);
  }

  return response.json();
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

async function fetchWeatherForSite(site: LaunchSite): Promise<SiteForecast> {
  const now = new Date();

  const getPacificDateString = (daysOffset: number = 0): string => {
    const date = new Date(now);
    date.setDate(date.getDate() + daysOffset);
    const pacificDateStr = date.toLocaleDateString('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const [month, day, year] = pacificDateStr.split('/');
    return `${year}-${month}-${day}`;
  };

  const targetDates = Array.from({ length: 7 }, (_, i) => getPacificDateString(i));

  let hrrrData = null;
  let ecmwfData = null;

  try {
    hrrrData = await fetchHRRRData(site);
    await delay(150);
  } catch (error) {
    console.error(`Failed to fetch HRRR data for ${site.name}:`, error);
  }

  try {
    ecmwfData = await fetchECMWFData(site);
    await delay(150);
  } catch (error) {
    console.error(`Failed to fetch ECMWF data for ${site.name}:`, error);
  }

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

  return {
    site,
    forecast: forecastData
  };
}

async function main() {
  console.log('Starting weather data fetch...');
  console.log(`Fetching data for ${launchSites.length} sites`);

  const forecasts: SiteForecast[] = [];

  for (const site of launchSites) {
    console.log(`Fetching ${site.name}...`);
    try {
      const forecast = await fetchWeatherForSite(site);
      forecasts.push(forecast);
    } catch (error) {
      console.error(`Failed to fetch ${site.name}:`, error);
      forecasts.push({
        site,
        forecast: []
      });
    }
  }

  const outputPath = path.join(__dirname, '../public/data/forecast.json');
  const outputDir = path.dirname(outputPath);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const output = {
    generated: new Date().toISOString(),
    forecasts
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\nSuccess! Written ${forecasts.length} forecasts to ${outputPath}`);
  console.log(`Generated at: ${output.generated}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
