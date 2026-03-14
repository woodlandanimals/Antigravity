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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface LaunchSite {
  id: string;
  name: string;
  elevation: number;
  latitude: number;
  longitude: number;
  orientation: string;
  maxWind: number;
  siteType: 'thermal' | 'soaring' | 'mixed';
}

interface HourlyDataPoint {
  hour: number;
  temperature: number;
  tcon: number;
  windSpeed: number;
  windDirection: number;
  windGust: number;
  cloudCover: number;
}

interface WeatherCondition {
  date: string;
  windSpeed: number;
  windDirection: number;
  windGust: number;
  temperature: number;
  dewPoint: number;
  tcon: number;
  thermalStrength: number;
  topOfLift: number;
  flyability: 'good' | 'marginal' | 'poor';
  conditions: string;
  soaringFlyability: 'good' | 'marginal' | 'poor';
  thermalFlyability: 'good' | 'marginal' | 'poor';
  launchTime: string;
  xcPotential: 'high' | 'moderate' | 'low';
  xcReason?: string;
  hourlyData?: HourlyDataPoint[];
  wind850mb?: number;
  windDir850mb?: number;
  wind700mb?: number;
  windDir700mb?: number;
  blDepth?: number;
  cape?: number;
  liftedIndex?: number;
  convergence?: number;
  relativeHumidity?: number;
  cloudCover?: number;
  windDirectionMatch?: boolean;
  rainInfo?: string;
}

interface SiteForecast {
  site: LaunchSite;
  forecast: WeatherCondition[];
}

// Launch sites - must match src/data/launchSites.ts
const launchSites: LaunchSite[] = [
  { id: 'tollhouse', name: 'Tollhouse', elevation: 4200, latitude: 37.0331, longitude: -119.3372, orientation: 'SSE-WNW', maxWind: 17, siteType: 'thermal' },
  { id: 'ed-levin', name: 'Ed Levin', elevation: 1750, latitude: 37.4656, longitude: -121.8531, orientation: 'S-NW', maxWind: 20, siteType: 'mixed' },
  { id: 'mt-vaca', name: 'Mt Vaca', elevation: 2800, latitude: 38.3700, longitude: -122.0200, orientation: 'SW-W', maxWind: 22, siteType: 'mixed' },
  { id: 'slide', name: 'Slide Mountain', elevation: 9600, latitude: 39.2900, longitude: -119.9400, orientation: 'W-NW', maxWind: 25, siteType: 'thermal' },
  { id: 'whaleback', name: 'Whaleback', elevation: 2400, latitude: 36.7500, longitude: -121.8000, orientation: 'W-NW', maxWind: 20, siteType: 'mixed' },
  { id: 'blue-rock', name: 'Blue Rock', elevation: 3200, latitude: 37.2500, longitude: -122.1800, orientation: 'W-NW', maxWind: 18, siteType: 'mixed' },
  { id: 'mt-diablo', name: 'Mt Diablo', elevation: 3849, latitude: 37.8814, longitude: -121.9142, orientation: 'W-SW', maxWind: 20, siteType: 'thermal' },
  { id: 'mission-peak', name: 'Mission Peak', elevation: 2517, latitude: 37.5133, longitude: -121.8808, orientation: 'W-NW', maxWind: 22, siteType: 'mixed' },
  { id: 'potato-hill', name: 'Potato Hill', elevation: 2200, latitude: 37.3500, longitude: -121.7500, orientation: 'W-NW', maxWind: 18, siteType: 'mixed' },
  { id: 'mt-tamalpais', name: 'Mt Tamalpais', elevation: 2574, latitude: 37.9236, longitude: -122.5969, orientation: 'W-SW', maxWind: 25, siteType: 'soaring' },
  { id: 'dunlap', name: 'Dunlap', elevation: 3200, latitude: 36.7400, longitude: -119.1000, orientation: 'SW-W', maxWind: 20, siteType: 'thermal' },
  { id: 'mcgee', name: 'McGee', elevation: 8500, latitude: 37.5800, longitude: -118.8300, orientation: 'E-SE', maxWind: 22, siteType: 'thermal' },
  { id: 'mussel-rock', name: 'Mussel Rock', elevation: 160, latitude: 37.6600, longitude: -122.4900, orientation: 'W-NW', maxWind: 25, siteType: 'soaring' },
  { id: 'ej-bowl', name: 'EJ Bowl', elevation: 250, latitude: 34.4042, longitude: -119.7465, orientation: 'W-NW', maxWind: 22, siteType: 'soaring' },
  { id: 'big-sur', name: 'Big Sur', elevation: 3240, latitude: 35.9703, longitude: -121.4511, orientation: 'W-NW', maxWind: 15, siteType: 'soaring' },
  { id: 'sand-city', name: 'Sand City', elevation: 50, latitude: 36.6252, longitude: -121.8439, orientation: 'W-NW', maxWind: 18, siteType: 'soaring' },
  { id: 'goat-rock', name: 'Goat Rock', elevation: 160, latitude: 38.4467, longitude: -123.1264, orientation: 'W-NW', maxWind: 18, siteType: 'soaring' },
  { id: 'channing-east', name: 'Channing East', elevation: 200, latitude: 38.0686, longitude: -122.1472, orientation: 'NE-SE', maxWind: 12, siteType: 'mixed' },
  { id: 'paiute', name: 'Paiute', elevation: 8000, latitude: 37.4100, longitude: -118.2700, orientation: 'SW-NW', maxWind: 15, siteType: 'thermal' },
  { id: 'flynns', name: 'Flynns', elevation: 5600, latitude: 37.3884, longitude: -118.2950, orientation: 'W-NW', maxWind: 15, siteType: 'thermal' },
  { id: 'vollmer-peak', name: 'Vollmer Peak', elevation: 1905, latitude: 37.8838, longitude: -122.2204, orientation: 'NE-SE', maxWind: 18, siteType: 'mixed' },
  { id: 'mt-st-helena', name: 'Mt St Helena', elevation: 3800, latitude: 38.6744, longitude: -122.6294, orientation: 'SW-NW', maxWind: 14, siteType: 'mixed' },
  { id: 'windy-hill', name: 'Windy Hill', elevation: 1910, latitude: 37.3933, longitude: -122.2228, orientation: 'NE', maxWind: 20, siteType: 'mixed' },
];

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Weather calculation functions
const calculateLCL = (tempF: number, dewPointF: number, elevationFt: number): { lclMSL: number, tcon: number } => {
  const tempC = (tempF - 32) * 5/9;
  const dewPointC = (dewPointF - 32) * 5/9;
  const lclAGL_m = 125 * (tempC - dewPointC);
  const lclAGL_ft = lclAGL_m * 3.28084;
  let lclMSL_ft = elevationFt + lclAGL_ft;
  lclMSL_ft = Math.max(elevationFt + 500, lclMSL_ft);
  const tcon = dewPointF + (lclAGL_ft / 1000) * 5.4;
  return { lclMSL: lclMSL_ft, tcon: Math.round(tcon) };
};

const estimateEnvLapseRate = (cape: number, liftedIndex: number): number => {
  if (liftedIndex < -4 && cape > 1000) return 5.0;
  if (liftedIndex < -2 && cape > 500) return 4.5;
  if (liftedIndex < 0 && cape > 200) return 4.0;
  if (liftedIndex < 2) return 3.5;
  if (liftedIndex < 4) return 3.0;
  return 2.5;
};

const applyWindReduction = (topOfLift: number, windSpeed: number, elevationFt: number): number => {
  let reduced = topOfLift;
  if (windSpeed > 20) reduced -= 1000;
  else if (windSpeed > 15) reduced -= 600;
  else if (windSpeed > 10) reduced -= 300;
  return Math.max(elevationFt + 500, Math.round(reduced));
};

const calculateTopOfUsableLift = (
  lclMSL: number,
  thermalStrength: number,
  windSpeed: number,
  elevationFt: number,
  cape: number,
  liftedIndex: number,
  boundaryLayerHeight?: number,
  temperature?: number,
  dewPoint?: number
): number => {
  const DALR = 5.4;
  const GLIDER_SINK_ADJ = 500;

  if (boundaryLayerHeight && boundaryLayerHeight > 100) {
    const blHeightFt = boundaryLayerHeight * 3.28084;
    let topOfLift = elevationFt + (blHeightFt * 0.85);
    topOfLift = Math.min(topOfLift, lclMSL);
    topOfLift -= GLIDER_SINK_ADJ;
    return applyWindReduction(topOfLift, windSpeed, elevationFt);
  }

  const envLapseRate = estimateEnvLapseRate(cape, liftedIndex);
  const lapseRateDiff = DALR - envLapseRate;

  let thermalAGL: number;
  if (lapseRateDiff <= 0.3) {
    const spread = (temperature && dewPoint) ? temperature - dewPoint : 20;
    thermalAGL = Math.min(spread * 180, 6000);
  } else {
    const inversionStrength = Math.max(5, liftedIndex * 2.5 + 10);
    thermalAGL = Math.min((inversionStrength / lapseRateDiff) * 1000, 7000);
  }

  let topOfLift = elevationFt + thermalAGL;
  topOfLift = Math.min(topOfLift, lclMSL);
  topOfLift -= GLIDER_SINK_ADJ;

  if (thermalStrength < 5) {
    const factor = 0.6 + (thermalStrength / 12.5);
    topOfLift = elevationFt + (topOfLift - elevationFt) * factor;
  }

  return applyWindReduction(topOfLift, windSpeed, elevationFt);
};

const calculateThermalStrength = (
  tempF: number,
  dewPointF: number,
  windSpeed: number,
  elevationFt: number,
  cape: number,
  liftedIndex: number,
  blDepth?: number
): number => {
  const tempDewSpread = tempF - dewPointF;
  let strength = 0;

  if (tempDewSpread > 45) strength += 5;
  else if (tempDewSpread > 35) strength += 4.5;
  else if (tempDewSpread > 25) strength += 4;
  else if (tempDewSpread > 18) strength += 3;
  else if (tempDewSpread > 15) strength += 2.5;
  else if (tempDewSpread > 12) strength += 2;
  else if (tempDewSpread > 8) strength += 1.5;
  else if (tempDewSpread > 6) strength += 1;

  if (tempF > 90) strength += 2;
  else if (tempF > 80) strength += 1.5;
  else if (tempF > 70) strength += 1;
  else if (tempF > 65) strength += 0.5;
  else if (tempF > 60) strength += 0.3;
  else if (tempF < 60) strength -= 1;

  if (cape > 1500) strength += 1.5;
  else if (cape > 800) strength += 1;
  else if (cape > 400) strength += 0.5;
  else if (cape < 50) strength -= 0.5;

  if (liftedIndex < -4) strength += 1;
  else if (liftedIndex < -2) strength += 0.5;
  else if (liftedIndex > 2) strength -= 1;
  else if (liftedIndex > 4) strength -= 1.5;

  if (blDepth && blDepth > 8000) strength += 0.5;
  else if (blDepth && blDepth < 3000) strength -= 0.5;

  if (elevationFt > 5000) strength += 1;
  else if (elevationFt > 3000) strength += 0.5;
  else if (elevationFt < 2000) strength += 0.3;

  if (windSpeed > 25) strength -= 2;
  else if (windSpeed > 18) strength -= 1;
  else if (windSpeed >= 8 && windSpeed <= 15) strength += 0.5;
  else if (windSpeed >= 5 && windSpeed <= 10) strength += 0.3;
  else if (windSpeed < 3) strength -= 0.5;

  return Math.max(0, Math.min(10, Math.round(strength * 10) / 10));
};

const checkWindDirectionMatch = (windDir: number, siteOrientation: string): boolean => {
  const orientationRanges: { [key: string]: [number, number][] } = {
    'N': [[345, 360], [0, 15]],
    'NE': [[15, 75]],
    'E': [[75, 105]],
    'SE': [[105, 165]],
    'S': [[165, 195]],
    'SSW': [[180, 225]],
    'SW': [[195, 255]],
    'W': [[255, 285]],
    'NW': [[285, 345]],
    'SW-W': [[195, 285]],
    'W-NW': [[245, 345]],
    'SW-NW': [[195, 345]],
    'S-NW': [[165, 345]],
    'SSE-WNW': [[150, 300]],
    'W-SW': [[225, 285]],
    'E-SE': [[75, 165]],
    'NE-SE': [[30, 165]],
    'NW-N': [[315, 360], [0, 15]]
  };

  const ranges = orientationRanges[siteOrientation];
  if (!ranges) return false;
  return ranges.some(([min, max]) => windDir >= min && windDir <= max);
};

const determineSoaringFlyability = (
  site: LaunchSite,
  windSpeed: number,
  windGust: number,
  windDirectionMatch: boolean
): 'good' | 'marginal' | 'poor' => {
  if (!windDirectionMatch) return 'poor';
  if (windSpeed < 8) return 'poor';
  if (windSpeed > site.maxWind) return 'poor';
  if (windGust > site.maxWind * 1.25) return 'poor';
  if (windSpeed >= 10 && windSpeed <= 16 && windGust <= site.maxWind) return 'good';
  if (windSpeed >= 8 && windSpeed <= site.maxWind && windGust <= site.maxWind) return 'good';
  return 'poor';
};

const determineThermalFlyability = (
  site: LaunchSite,
  temperature: number,
  tcon: number,
  thermalStrength: number,
  windSpeed: number,
  windDirectionMatch: boolean,
  cloudCover: number
): 'good' | 'marginal' | 'poor' => {
  if (!windDirectionMatch) return 'poor';
  const tempDeficit = tcon - temperature;
  if (tempDeficit > 15) return 'poor';
  if (windSpeed > site.maxWind) return 'poor';
  if (windSpeed < 3) return thermalStrength > 6 ? 'marginal' : 'poor';
  if (thermalStrength >= 7 && tempDeficit <= 3 && windSpeed <= site.maxWind * 0.7) return 'good';
  if (thermalStrength >= 5 && tempDeficit <= 5) return 'good';
  if (thermalStrength >= 3 && tempDeficit <= 8) return 'marginal';
  if (cloudCover > 75 && thermalStrength < 5) return 'poor';
  return 'poor';
};

const determineFlyability = (
  site: LaunchSite,
  temperature: number,
  tcon: number,
  windSpeed: number,
  windGust: number,
  thermalStrength: number,
  topOfLift: number,
  windDirectionMatch: boolean,
  cloudCover: number,
  cape: number,
  liftedIndex: number
): { flyability: 'good' | 'marginal' | 'poor', conditions: string } => {
  const tempDeficit = tcon - temperature;
  let flyability: 'good' | 'marginal' | 'poor' = 'poor';
  let conditions = '';

  if (!windDirectionMatch) {
    flyability = 'poor';
    conditions = `Wind direction unfavorable for ${site.orientation} site`;
  } else if (tempDeficit > 15) {
    flyability = 'poor';
    conditions = `Too cool: needs ${tcon}°F for thermals, only ${Math.round(temperature)}°F forecast`;
  } else if (tempDeficit > 8) {
    flyability = tempDeficit > 12 ? 'poor' : 'marginal';
    conditions = `Cool: needs ${tcon}°F for good thermals, ${Math.round(temperature)}°F forecast`;
  } else if (windSpeed > site.maxWind) {
    flyability = 'poor';
    conditions = `Too strong: ${windSpeed}mph exceeds ${site.maxWind}mph limit`;
  } else if (windGust > site.maxWind * 1.5) {
    flyability = 'marginal';
    conditions = `Strong gusts: G${windGust}mph, be cautious`;
  } else if (windSpeed < 2) {
    flyability = thermalStrength > 6 ? 'marginal' : 'poor';
    conditions = thermalStrength > 6 ? 'Light winds, strong thermals' : 'Too light, weak thermals';
  } else if (cloudCover > 75 && liftedIndex > 2) {
    flyability = 'marginal';
    conditions = `Overcast may limit thermals: ${Math.round(cloudCover)}% cloud cover`;
  } else if (thermalStrength >= 8 && windSpeed <= site.maxWind * 0.6 && tempDeficit <= 2 && cape > 400) {
    flyability = 'good';
    conditions = `Excellent post-frontal: ${thermalStrength}/10 thermals, CAPE ${Math.round(cape)}`;
  } else if (thermalStrength >= 7 && windSpeed <= site.maxWind * 0.7 && tempDeficit <= 3) {
    flyability = 'good';
    conditions = `Excellent: ${thermalStrength}/10 thermals, top ${Math.round(topOfLift/1000*10)/10}k`;
  } else if (thermalStrength >= 5 && windSpeed <= site.maxWind * 0.8 && tempDeficit <= 5) {
    flyability = 'good';
    conditions = `Good: ${thermalStrength}/10 thermals, top ${Math.round(topOfLift/1000*10)/10}k`;
  } else if (thermalStrength >= 3 && windSpeed <= site.maxWind * 0.9 && tempDeficit <= 8) {
    flyability = 'marginal';
    conditions = `Moderate: ${thermalStrength}/10 thermals, top ${Math.round(topOfLift/1000*10)/10}k`;
  } else {
    flyability = 'poor';
    conditions = `Stable conditions: ${thermalStrength}/10 thermals`;
  }

  return { flyability, conditions };
};

const calculateXCPotential = (
  topOfLift: number,
  thermalStrength: number,
  windSpeed: number,
  site: LaunchSite
): { xcPotential: 'high' | 'moderate' | 'low', xcReason: string } => {
  const ceilingAGL = topOfLift - site.elevation;
  if (site.siteType === 'soaring') {
    return { xcPotential: 'low', xcReason: 'Ridge site - local soaring' };
  }
  if (thermalStrength >= 7 && ceilingAGL >= 4000 && windSpeed <= 15) {
    return { xcPotential: 'high', xcReason: `${Math.round(ceilingAGL/1000)}k+ AGL, ${thermalStrength}/10` };
  }
  if ((thermalStrength >= 5 && ceilingAGL >= 3000) || (thermalStrength >= 6 && windSpeed <= 12)) {
    return { xcPotential: 'moderate', xcReason: 'Good for local XC' };
  }
  return { xcPotential: 'low', xcReason: ceilingAGL < 2000 ? 'Low ceiling' : 'Weak thermals' };
};

const analyzeRain = (hourly: any, targetDate: string): string | undefined => {
  const rainHours: Array<{ hour: number, precip: number, prob: number }> = [];

  hourly.time.forEach((time: string, index: number) => {
    const dt = new Date(time);
    const dateStr = dt.toISOString().split('T')[0];
    const hour = dt.getHours();

    if (dateStr === targetDate) {
      const precip = hourly.precipitation?.[index] || 0;
      const prob = hourly.precipitation_probability?.[index] || 0;
      if (precip > 0.01 || prob > 40) {
        rainHours.push({ hour, precip, prob });
      }
    }
  });

  if (rainHours.length === 0) return undefined;

  const morningRain = rainHours.filter(h => h.hour >= 6 && h.hour < 12);
  const afternoonRain = rainHours.filter(h => h.hour >= 12 && h.hour < 18);
  const eveningRain = rainHours.filter(h => h.hour >= 18);

  if (rainHours.length >= 10) {
    return 'Rain expected all day';
  }

  const periods: string[] = [];
  if (morningRain.length >= 3) periods.push('morning');
  if (afternoonRain.length >= 3) periods.push('afternoon');
  if (eveningRain.length >= 2) periods.push('evening');

  if (periods.length === 0 && rainHours.length > 0) {
    const hours = rainHours.map(h => h.hour);
    const minHour = Math.min(...hours);
    const maxHour = Math.max(...hours);
    const formatHour = (h: number) => h === 12 ? '12pm' : h > 12 ? `${h-12}pm` : `${h}am`;
    if (minHour === maxHour) {
      return `Rain expected around ${formatHour(minHour)}`;
    }
    return `Rain expected ${formatHour(minHour)}-${formatHour(maxHour)}`;
  }

  return `Rain expected in ${periods.join(' and ')}`;
};

const extractHourlyData = (
  site: LaunchSite,
  hourly: any,
  targetDate: string
): HourlyDataPoint[] => {
  const result: HourlyDataPoint[] = [];

  hourly.time.forEach((time: string, index: number) => {
    const dt = new Date(time);
    const dateStr = dt.toISOString().split('T')[0];
    const hour = dt.getHours();

    if (dateStr === targetDate && hour >= 6 && hour <= 18) {
      const temp = hourly.temperature_2m[index];
      const dewPoint = hourly.dew_point_2m[index];
      const { tcon } = calculateLCL(temp, dewPoint, site.elevation);

      result.push({
        hour,
        temperature: Math.round(temp),
        tcon,
        windSpeed: Math.round(hourly.wind_speed_10m[index]),
        windDirection: hourly.wind_direction_10m[index],
        windGust: Math.round(hourly.wind_gusts_10m[index]),
        cloudCover: Math.round(hourly.cloud_cover[index])
      });
    }
  });

  return result;
};

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
      const dt = new Date(time);
      const dateStr = dt.toISOString().split('T')[0];
      const hour = dt.getHours();
      if (dateStr === targetDate && hour >= 10 && hour <= 14) {
        targetIndices.push(index);
      }
    });

    if (targetIndices.length === 0) {
      return null;
    }

    const noonIndex = targetIndices.reduce((closest, current) => {
      const closestHour = new Date(hourly.time[closest]).getHours();
      const currentHour = new Date(hourly.time[current]).getHours();
      return Math.abs(currentHour - 12) < Math.abs(closestHour - 12) ? current : closest;
    });

    const hourlyData = extractHourlyData(site, hourly, targetDate);

    let temperature = hourly.temperature_2m[noonIndex];
    const dewPoint = hourly.dew_point_2m[noonIndex];
    let windSpeed = Math.round(hourly.wind_speed_10m[noonIndex]);
    let windDirection = hourly.wind_direction_10m[noonIndex];
    let windGust = Math.round(hourly.wind_gusts_10m[noonIndex]);
    const relativeHumidity = hourly.relative_humidity_2m[noonIndex];
    let cloudCover = hourly.cloud_cover[noonIndex];

    const cape = isHRRR ? (hourly.cape?.[noonIndex] || 0) : 0;
    const liftedIndex = isHRRR ? (hourly.lifted_index?.[noonIndex] || 0) : 0;
    const boundaryLayerHeight = isHRRR ? (hourly.boundary_layer_height?.[noonIndex] || undefined) : undefined;

    const { lclMSL, tcon } = calculateLCL(temperature, dewPoint, site.elevation);

    const thermalStrength = calculateThermalStrength(
      temperature,
      dewPoint,
      windSpeed,
      site.elevation,
      cape,
      liftedIndex,
      boundaryLayerHeight
    );

    const topOfLift = calculateTopOfUsableLift(
      lclMSL,
      thermalStrength,
      windSpeed,
      site.elevation,
      cape,
      liftedIndex,
      boundaryLayerHeight,
      temperature,
      dewPoint
    );

    const windDirectionMatch = checkWindDirectionMatch(windDirection, site.orientation);
    const soaringFlyability = determineSoaringFlyability(site, windSpeed, windGust, windDirectionMatch);
    const thermalFlyability = determineThermalFlyability(
      site,
      temperature,
      tcon,
      thermalStrength,
      windSpeed,
      windDirectionMatch,
      cloudCover
    );

    const { flyability, conditions } = determineFlyability(
      site,
      temperature,
      tcon,
      windSpeed,
      windGust,
      thermalStrength,
      topOfLift,
      windDirectionMatch,
      cloudCover,
      cape,
      liftedIndex
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
