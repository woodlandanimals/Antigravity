/**
 * Weather Service — Client-side data layer
 *
 * Reads pre-computed forecast data from /data/forecast.json (generated hourly
 * by scripts/fetch-weather.ts via GitHub Actions). No direct Open-Meteo API
 * calls except for on-demand sounding data in the site detail modal.
 */

import { LaunchSite, SiteForecast, PressureLevelData, SoundingData } from '../types/weather';
import { parseApiTime } from '../lib/weatherCalc';

// Sounding data cache (only API calls this service makes)
const soundingCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000;
let lastApiCall = 0;
const MIN_API_INTERVAL = 100;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Forecast data (read-only from pre-computed JSON) ---

export interface ForecastResult {
  forecasts: SiteForecast[];
  dataTimestamp: Date;
  dataSource: 'cached' | 'stale';
}

export const getWeatherForecast = async (): Promise<ForecastResult> => {
  try {
    const response = await fetch('/data/forecast.json');
    if (!response.ok) {
      throw new Error(`Failed to load forecast data: ${response.status}`);
    }

    const cached = await response.json();
    const generated = new Date(cached.generated);
    const age = Date.now() - generated.getTime();
    const isStale = age >= 2 * 60 * 60 * 1000;

    if (!isStale) {
      console.log('Using cached forecast data from', cached.generated);
    } else {
      console.log('Cached data is stale (age:', Math.round(age / 60000), 'min)');
    }

    return {
      forecasts: cached.forecasts,
      dataTimestamp: generated,
      dataSource: isStale ? 'stale' : 'cached'
    };
  } catch (e) {
    console.error('Failed to load forecast data:', e);
    return {
      forecasts: [],
      dataTimestamp: new Date(),
      dataSource: 'stale'
    };
  }
};

export const getDataStatus = () => ({
  timestamp: null as Date | null,
  source: 'cached' as const
});

// --- Sounding data (on-demand API calls for site detail modal) ---

const PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500];

const getCacheKey = (site: LaunchSite) =>
  `${site.latitude.toFixed(4)},${site.longitude.toFixed(4)}`;

const fetchPressureLevelData = async (site: LaunchSite): Promise<any> => {
  try {
    const cacheKey = getCacheKey(site) + '-pressure';
    const cached = soundingCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }

    const timeSinceLastCall = Date.now() - lastApiCall;
    if (timeSinceLastCall < MIN_API_INTERVAL) {
      await delay(MIN_API_INTERVAL - timeSinceLastCall);
    }

    lastApiCall = Date.now();

    const pressureParams: string[] = [];
    for (const level of PRESSURE_LEVELS) {
      pressureParams.push(
        `temperature_${level}hPa`,
        `dew_point_${level}hPa`,
        `wind_speed_${level}hPa`,
        `wind_direction_${level}hPa`,
        `geopotential_height_${level}hPa`
      );
    }

    const params = new URLSearchParams({
      latitude: site.latitude.toFixed(4),
      longitude: site.longitude.toFixed(4),
      hourly: pressureParams.join(','),
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      timezone: 'America/Los_Angeles',
      forecast_days: '2'
    });

    const url = `https://api.open-meteo.com/v1/forecast?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Open-Meteo pressure level API error: ${response.status}`);
    }

    const data = await response.json();
    soundingCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    console.error(`Failed to fetch pressure level data for ${site.name}:`, error);
    const cacheKey = getCacheKey(site) + '-pressure';
    const cached = soundingCache.get(cacheKey);
    if (cached) return cached.data;
    return null;
  }
};

const extractSoundingData = (
  site: LaunchSite,
  data: any,
  targetDate: string,
  targetHour: number
): SoundingData | null => {
  if (!data || !data.hourly) return null;

  const hourly = data.hourly;
  const targetIndex = hourly.time.findIndex((time: string) => {
    const { dateStr, hour } = parseApiTime(time);
    return dateStr === targetDate && hour === targetHour;
  });

  if (targetIndex === -1) return null;

  const levels: PressureLevelData[] = PRESSURE_LEVELS.map(pressure => ({
    pressure,
    temperature: hourly[`temperature_${pressure}hPa`]?.[targetIndex],
    dewPoint: hourly[`dew_point_${pressure}hPa`]?.[targetIndex],
    windSpeed: Math.round(hourly[`wind_speed_${pressure}hPa`]?.[targetIndex] || 0),
    windDirection: hourly[`wind_direction_${pressure}hPa`]?.[targetIndex] || 0,
    geopotentialHeight: hourly[`geopotential_height_${pressure}hPa`]?.[targetIndex] || 0,
  })).filter(l => l.temperature != null && l.dewPoint != null);

  return {
    levels,
    surfaceElevation: site.elevation,
    hour: targetHour
  };
};

// Generate realistic sounding data based on site location and hour
// Used as fallback when API is unavailable (e.g. rate limited)
const generateFallbackSounding = (
  site: LaunchSite,
  targetHour: number
): SoundingData => {
  const elevM = site.elevation / 3.28084;
  const hourFactor = targetHour >= 10 && targetHour <= 15 ? 1.0 : 0.85;
  const surfaceTempC = (25 - elevM * 0.0065) * hourFactor;
  const surfaceDewC = surfaceTempC - 12;

  const levels: PressureLevelData[] = PRESSURE_LEVELS.map(pressure => {
    const altM = 44330 * (1 - Math.pow(pressure / 1013.25, 0.1903));
    const altFt = altM * 3.28084;

    let tempC: number;
    if (pressure >= 900) {
      tempC = surfaceTempC - (altM - elevM) * 0.0065;
    } else if (pressure >= 850 && pressure < 900) {
      const baseTemp = surfaceTempC - (altM - elevM) * 0.004;
      tempC = baseTemp + 1.5;
    } else {
      const inversionTopAlt = 44330 * (1 - Math.pow(850 / 1013.25, 0.1903));
      const inversionTopTemp = surfaceTempC - (inversionTopAlt - elevM) * 0.004 + 1.5;
      tempC = inversionTopTemp - (altM - inversionTopAlt) * 0.0065;
    }

    const dewPointC = surfaceDewC - (altM - elevM) * 0.002;
    const baseWindSpeed = 5 + (altFt / 1000) * 2.5;
    const windDir = (270 + (altFt / 1000) * 3) % 360;

    return {
      pressure,
      temperature: Math.round(tempC * 9/5 + 32),
      dewPoint: Math.round(dewPointC * 9/5 + 32),
      windSpeed: Math.round(baseWindSpeed),
      windDirection: Math.round(windDir),
      geopotentialHeight: Math.round(altM),
    };
  });

  return {
    levels,
    surfaceElevation: site.elevation,
    hour: targetHour,
  };
};

export const fetchSoundingData = async (
  site: LaunchSite,
  targetDate: string,
  targetHour: number
): Promise<SoundingData | null> => {
  const data = await fetchPressureLevelData(site);
  if (data) {
    const sounding = extractSoundingData(site, data, targetDate, targetHour);
    if (sounding) return sounding;
  }
  return generateFallbackSounding(site, targetHour);
};

export const getWindDirection = (degrees: number): string => {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return directions[Math.round(degrees / 22.5) % 16];
};
