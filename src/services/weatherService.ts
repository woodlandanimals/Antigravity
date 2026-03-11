import { LaunchSite, WeatherCondition, SiteForecast, HourlyDataPoint, PressureLevelData, SoundingData } from '../types/weather';
import { launchSites } from '../data/launchSites';

const weatherCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000;

let lastApiCall = 0;
const MIN_API_INTERVAL = 100;

// Track whether we're using stale/fallback data
let dataTimestamp: Date | null = null;
let dataSource: 'live' | 'cached' | 'stale' = 'live';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Parse API time string (e.g. "2026-03-10T14:00") without Date object to avoid UTC shift
const parseApiTime = (time: string): { dateStr: string; hour: number } => {
  const [dateStr, timePart] = time.split('T');
  return { dateStr, hour: parseInt(timePart.split(':')[0], 10) };
};

const getCacheKey = (site: LaunchSite) => {
  return `${site.latitude.toFixed(4)},${site.longitude.toFixed(4)}`;
};

const fetchHRRRData = async (site: LaunchSite) => {
  try {
    const cacheKey = getCacheKey(site) + '-hrrr';
    const cached = weatherCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }

    const timeSinceLastCall = Date.now() - lastApiCall;
    if (timeSinceLastCall < MIN_API_INTERVAL) {
      await delay(MIN_API_INTERVAL - timeSinceLastCall);
    }

    lastApiCall = Date.now();

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
      forecast_days: 2
    });

    const url = `https://api.open-meteo.com/v1/forecast?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API Error for ${site.name}:`, errorText);
      throw new Error(`Open-Meteo API error: ${response.status}`);
    }

    const data = await response.json();

    weatherCache.set(cacheKey, { data, timestamp: Date.now() });

    return data;

  } catch (error) {
    console.error(`Failed to fetch HRRR data for ${site.name}:`, error);

    const cacheKey = getCacheKey(site) + '-hrrr';
    const cached = weatherCache.get(cacheKey);
    if (cached) {
      return cached.data;
    }

    return null;
  }
};

const fetchECMWFData = async (site: LaunchSite) => {
  try {
    const cacheKey = getCacheKey(site) + '-ecmwf';
    const cached = weatherCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }

    const timeSinceLastCall = Date.now() - lastApiCall;
    if (timeSinceLastCall < MIN_API_INTERVAL) {
      await delay(MIN_API_INTERVAL - timeSinceLastCall);
    }

    lastApiCall = Date.now();

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
      forecast_days: 7
    });

    const url = `https://api.open-meteo.com/v1/ecmwf?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ECMWF API Error for ${site.name}:`, errorText);
      throw new Error(`Open-Meteo ECMWF API error: ${response.status}`);
    }

    const data = await response.json();

    weatherCache.set(cacheKey, { data, timestamp: Date.now() });

    return data;

  } catch (error) {
    console.error(`Failed to fetch ECMWF data for ${site.name}:`, error);

    const cacheKey = getCacheKey(site) + '-ecmwf';
    const cached = weatherCache.get(cacheKey);
    if (cached) {
      return cached.data;
    }

    return null;
  }
};

const processECMWFDataForDay = (site: LaunchSite, data: any, targetDate: string): WeatherCondition | null => {
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
      const closestHour = parseApiTime(hourly.time[closest]).hour;
      const currentHour = parseApiTime(hourly.time[current]).hour;
      return Math.abs(currentHour - 12) < Math.abs(closestHour - 12) ? current : closest;
    });

    // Extract hourly data early so we can find best flyable hour
    const hourlyData = extractHourlyData(site, hourly, targetDate);

    // Start with noon values as defaults
    let temperature = hourly.temperature_2m[noonIndex];
    const dewPoint = hourly.dew_point_2m[noonIndex];
    let windSpeed = Math.round(hourly.wind_speed_10m[noonIndex]);
    let windDirection = hourly.wind_direction_10m[noonIndex];
    let windGust = Math.round(hourly.wind_gusts_10m[noonIndex]);
    const relativeHumidity = hourly.relative_humidity_2m[noonIndex];
    let cloudCover = hourly.cloud_cover[noonIndex];

    // Find best flyable hour and use its values if conditions are good
    const bestHour = findBestFlyableHour(hourlyData, site, site.orientation);
    if (bestHour && bestHour.score > 0) {
      windSpeed = bestHour.data.windSpeed;
      windGust = bestHour.data.windGust;
      windDirection = bestHour.data.windDirection;
      temperature = bestHour.data.temperature;
      cloudCover = bestHour.data.cloudCover;
    }

    // ECMWF provides CAPE but not lifted index or boundary layer height
    // We estimate LI from CAPE and temp-dew spread
    const cape = hourly.cape?.[noonIndex] || 0;
    const liftedIndex = estimateLiftedIndex(cape, temperature, dewPoint);
    const boundaryLayerHeight = undefined;

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

    let topOfLift = calculateTopOfUsableLift(
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

    // Calculate launch time using hourly data for better accuracy
    const launchTime = hourlyData.length > 0
      ? calculateLaunchTimeFromHourly(hourlyData, site, site.orientation)
      : calculateLaunchTime(thermalFlyability, soaringFlyability, thermalStrength, windSpeed, temperature, tcon);

    // Calculate XC potential
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
      wind850mb: undefined,
      windDir850mb: undefined,
      wind700mb: undefined,
      windDir700mb: undefined,
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
    console.error(`Failed to process ECMWF data for ${site.name} on ${targetDate}:`, error);
    return null;
  }
};

const processHRRRDataForDay = (site: LaunchSite, data: any, targetDate: string): WeatherCondition | null => {
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
      const closestHour = parseApiTime(hourly.time[closest]).hour;
      const currentHour = parseApiTime(hourly.time[current]).hour;
      return Math.abs(currentHour - 12) < Math.abs(closestHour - 12) ? current : closest;
    });

    // Extract hourly data early so we can find best flyable hour
    const hourlyData = extractHourlyData(site, hourly, targetDate);

    // Start with noon values as defaults
    let temperature = hourly.temperature_2m[noonIndex];
    const dewPoint = hourly.dew_point_2m[noonIndex];
    let windSpeed = Math.round(hourly.wind_speed_10m[noonIndex]);
    let windDirection = hourly.wind_direction_10m[noonIndex];
    let windGust = Math.round(hourly.wind_gusts_10m[noonIndex]);
    const relativeHumidity = hourly.relative_humidity_2m[noonIndex];
    let cloudCover = hourly.cloud_cover[noonIndex];

    // Find best flyable hour and use its values if conditions are good
    const bestHour = findBestFlyableHour(hourlyData, site, site.orientation);
    if (bestHour && bestHour.score > 0) {
      windSpeed = bestHour.data.windSpeed;
      windGust = bestHour.data.windGust;
      windDirection = bestHour.data.windDirection;
      temperature = bestHour.data.temperature;
      cloudCover = bestHour.data.cloudCover;
    }

    const wind850mb = undefined;
    const windDir850mb = undefined;
    const wind700mb = undefined;
    const windDir700mb = undefined;

    const cape = hourly.cape?.[noonIndex] || 0;
    const liftedIndex = hourly.lifted_index?.[noonIndex] || 0;
    const boundaryLayerHeight = hourly.boundary_layer_height?.[noonIndex] || undefined;

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

    let topOfLift = calculateTopOfUsableLift(
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

    // Calculate launch time using hourly data for better accuracy
    const launchTime = hourlyData.length > 0
      ? calculateLaunchTimeFromHourly(hourlyData, site, site.orientation)
      : calculateLaunchTime(thermalFlyability, soaringFlyability, thermalStrength, windSpeed, temperature, tcon);

    // Calculate XC potential
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
      wind850mb: wind850mb ? Math.round(wind850mb) : undefined,
      windDir850mb,
      wind700mb: wind700mb ? Math.round(wind700mb) : undefined,
      windDir700mb,
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
    console.error(`Failed to process HRRR data for ${site.name} on ${targetDate}:`, error);
    return null;
  }
};

// Estimate Lifted Index from CAPE and surface conditions when not available from API
// LI approximates atmospheric stability: negative = unstable, positive = stable
// Scale matches HRRR range: roughly -8 to +8 (°C)
const estimateLiftedIndex = (cape: number, tempF: number, dewPointF: number): number => {
  const spread = tempF - dewPointF;

  // High CAPE strongly indicates instability (negative LI)
  if (cape > 2500) return -7;
  if (cape > 1500) return -5;
  if (cape > 1000) return -4;
  if (cape > 600) return -3;
  if (cape > 300) return -2;
  if (cape > 100) return -1;
  if (cape > 0) return 0;

  // Zero CAPE: estimate from surface conditions
  // Cold temps + narrow spread = very stable (marine layer, inversions)
  if (tempF < 50 && spread < 15) return 7;
  if (tempF < 55 && spread < 10) return 6;
  if (tempF < 60 && spread < 15) return 5;

  // Cool temps + moderate spread = stable
  if (tempF < 65 && spread < 20) return 4;
  if (spread < 10) return 5;   // Very moist = likely stable/overcast
  if (spread < 15) return 3;

  // Warm temps + wide spread hint at possible instability even without CAPE
  if (tempF > 80 && spread > 30) return -1;
  if (tempF > 75 && spread > 25) return 0;

  return 2;  // Default moderately stable (typical zero-CAPE day)
};

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

const calculateXCPotential = (
  topOfLift: number,
  thermalStrength: number,
  windSpeed: number,
  site: LaunchSite
): { xcPotential: 'high' | 'moderate' | 'low', xcReason: string } => {
  const ceilingAGL = topOfLift - site.elevation;

  // Soaring sites don't really do XC in the traditional sense
  if (site.siteType === 'soaring') {
    return { xcPotential: 'low', xcReason: 'Ridge site - local soaring' };
  }

  // High XC potential: strong thermals, high ceiling, manageable wind
  if (thermalStrength >= 7 && ceilingAGL >= 4000 && windSpeed <= 15) {
    return { xcPotential: 'high', xcReason: `${Math.round(ceilingAGL/1000)}k+ AGL, ${thermalStrength}/10` };
  }

  // Moderate: decent thermals or good ceiling
  if ((thermalStrength >= 5 && ceilingAGL >= 3000) ||
      (thermalStrength >= 6 && windSpeed <= 12)) {
    return { xcPotential: 'moderate', xcReason: 'Good for local XC' };
  }

  // Low: limited ceiling or weak thermals
  return { xcPotential: 'low', xcReason: ceilingAGL < 2000 ? 'Low ceiling' : 'Weak thermals' };
};

const extractHourlyData = (
  site: LaunchSite,
  hourly: any,
  targetDate: string
): HourlyDataPoint[] => {
  const result: HourlyDataPoint[] = [];

  hourly.time.forEach((time: string, index: number) => {
    const { dateStr, hour } = parseApiTime(time);

    // Include all 24 hours for full daily breakdown
    if (dateStr === targetDate) {
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
  else if (liftedIndex > 4) strength -= 1.5;
  else if (liftedIndex > 2) strength -= 1;

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

// Estimate environmental lapse rate from atmospheric stability indicators
const estimateEnvLapseRate = (cape: number, liftedIndex: number): number => {
  // Returns environmental lapse rate in °F per 1000 ft
  // DALR is 5.4°F/1000ft - stable atmosphere has lower lapse rate
  if (liftedIndex < -4 && cape > 1000) return 5.0;  // Very unstable
  if (liftedIndex < -2 && cape > 500) return 4.5;   // Unstable
  if (liftedIndex < 0 && cape > 200) return 4.0;    // Slightly unstable
  if (liftedIndex < 2) return 3.5;                  // Neutral (typical Bay Area)
  if (liftedIndex < 4) return 3.0;                  // Stable
  return 2.5;                                        // Very stable (inversion)
};

// Apply wind reduction to top of lift - wind shear disrupts thermals
const applyWindReduction = (topOfLift: number, windSpeed: number, elevationFt: number): number => {
  let reduced = topOfLift;
  if (windSpeed > 20) reduced -= 1000;
  else if (windSpeed > 15) reduced -= 600;
  else if (windSpeed > 10) reduced -= 300;
  return Math.max(elevationFt + 500, Math.round(reduced));
};

// Calculate top of usable lift using thermal equilibrium approach
// This finds where thermals dissipate, not just where clouds form (LCL)
const calculateTopOfUsableLift = (
  lclMSL: number,
  thermalStrength: number,
  windSpeed: number,
  elevationFt: number,
  cape: number,
  liftedIndex: number,
  boundaryLayerHeight?: number,  // meters from API
  temperature?: number,
  dewPoint?: number
): number => {
  const DALR = 5.4;  // degrees F per 1000 ft
  const GLIDER_SINK_ADJ = 500;  // practical reduction for glider sink rate

  // Method 1: Use boundary layer height directly (most accurate)
  // BL height tells us how deep the convective mixing layer is
  if (boundaryLayerHeight && boundaryLayerHeight > 100) {
    const blHeightFt = boundaryLayerHeight * 3.28084;
    let topOfLift = elevationFt + (blHeightFt * 0.85);
    topOfLift = Math.min(topOfLift, lclMSL);  // Cap at cloud base
    topOfLift -= GLIDER_SINK_ADJ;
    return applyWindReduction(topOfLift, windSpeed, elevationFt);
  }

  // Method 2: Estimate from atmospheric stability
  // Calculate where rising parcel reaches thermal equilibrium
  const envLapseRate = estimateEnvLapseRate(cape, liftedIndex);
  const lapseRateDiff = DALR - envLapseRate;

  let thermalAGL: number;
  if (lapseRateDiff <= 0.3) {
    // Near-adiabatic or unstable - thermals can go high
    // Use temp-dewpoint spread as proxy for depth
    const spread = (temperature && dewPoint) ? temperature - dewPoint : 20;
    thermalAGL = Math.min(spread * 180, 6000);
  } else {
    // Stable atmosphere - calculate equilibrium height
    // Estimate inversion strength based on lifted index
    const inversionStrength = Math.max(5, liftedIndex * 2.5 + 10);
    thermalAGL = Math.min((inversionStrength / lapseRateDiff) * 1000, 7000);
  }

  let topOfLift = elevationFt + thermalAGL;
  topOfLift = Math.min(topOfLift, lclMSL);  // Cap at LCL (can't exceed cloud base)
  topOfLift -= GLIDER_SINK_ADJ;

  // Weak thermals don't reach full potential height
  if (thermalStrength < 5) {
    const factor = 0.6 + (thermalStrength / 12.5);
    topOfLift = elevationFt + (topOfLift - elevationFt) * factor;
  }

  return applyWindReduction(topOfLift, windSpeed, elevationFt);
};

const analyzeRain = (hourly: any, targetDate: string): string | undefined => {
  const rainHours: Array<{ hour: number, precip: number, prob: number }> = [];

  hourly.time.forEach((time: string, index: number) => {
    const { dateStr, hour } = parseApiTime(time);

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

  const periods = [];
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

const checkWindDirectionMatch = (windDir: number, siteOrientation: string): boolean => {
  const orientationRanges: { [key: string]: [number, number][] } = {
    'N': [[345, 360], [0, 15]],
    'NE': [[15, 75]],
    'E': [[75, 105]],
    'SE': [[105, 165]],
    'S': [[165, 195]],
    'SSW': [[180, 225]],  // For Sylmar/Kagel
    'SW': [[195, 255]],
    'W': [[255, 285]],
    'NW': [[285, 345]],
    'SW-W': [[195, 285]],
    'W-NW': [[245, 345]],
    'SW-NW': [[195, 345]],
    'S-NW': [[165, 345]],  // For Ed Levin - wide range from S through W to NW
    'SSE-WNW': [[150, 300]],  // For Tollhouse - SSE through S, SW, W to WNW - thermals come up the hill
    'W-SW': [[225, 285]],
    'E-SE': [[75, 165]],
    'NE-SE': [[30, 165]],  // For Channing East - NE through E to SE
    'NW-N': [[315, 360], [0, 15]]
  };

  const ranges = orientationRanges[siteOrientation];
  if (!ranges) return false;

  return ranges.some(([min, max]) => windDir >= min && windDir <= max);
};

// Score an hour for thermal flying potential
const scoreThermalHour = (
  temp: number,
  tcon: number,
  windSpeed: number,
  windGust: number,
  cloudCover: number,
  maxWind: number
): number => {
  let score = 0;

  // Temperature vs TCON (thermals triggered when temp >= tcon)
  const tempDeficit = tcon - temp;
  if (tempDeficit <= 0) score += 40;  // Thermals are triggering
  else if (tempDeficit <= 3) score += 30;
  else if (tempDeficit <= 5) score += 20;
  else if (tempDeficit <= 8) score += 10;

  // Wind - moderate is best for thermals
  if (windSpeed >= 5 && windSpeed <= 12) score += 25;
  else if (windSpeed >= 3 && windSpeed <= 15) score += 15;
  else if (windSpeed > maxWind) score -= 20;

  // Gusts penalty
  if (windGust > maxWind) score -= 15;
  else if (windGust > windSpeed * 1.5) score -= 10;

  // Cloud cover - some clouds indicate thermal activity, too much blocks sun
  if (cloudCover >= 20 && cloudCover <= 50) score += 15;  // Cu development
  else if (cloudCover < 20) score += 10;  // Clear but maybe blue thermals
  else if (cloudCover > 70) score -= 10;  // Too overcast

  return score;
};

// Score an hour for soaring (ridge lift) potential
const scoreSoaringHour = (
  windSpeed: number,
  windGust: number,
  windDirection: number,
  siteOrientation: string,
  maxWind: number
): number => {
  let score = 0;

  // Wind direction match is critical for ridge soaring
  const dirMatch = checkWindDirectionMatch(windDirection, siteOrientation);
  if (!dirMatch) return -50;  // Wrong direction = no ridge lift

  // Ideal soaring wind: 10-18 mph
  if (windSpeed >= 10 && windSpeed <= 16) score += 40;
  else if (windSpeed >= 8 && windSpeed <= 20) score += 25;
  else if (windSpeed >= 6 && windSpeed <= 22) score += 10;
  else if (windSpeed < 6) score -= 10;  // Too light
  else if (windSpeed > maxWind) score -= 30;  // Too strong

  // Gusts penalty
  if (windGust > maxWind) score -= 20;
  else if (windGust > 25) score -= 10;

  return score;
};

// Find the best flyable hour based on site type
const findBestFlyableHour = (
  hourlyData: HourlyDataPoint[],
  site: LaunchSite,
  orientation: string
): { hour: number; score: number; data: HourlyDataPoint } | null => {
  const flyableHours = hourlyData.filter(h => h.hour >= 10 && h.hour <= 18);
  if (flyableHours.length === 0) return null;

  let bestHour = flyableHours[0];
  let bestScore = -Infinity;

  for (const h of flyableHours) {
    let score: number;
    if (site.siteType === 'soaring') {
      score = scoreSoaringHour(h.windSpeed, h.windGust, h.windDirection, orientation, site.maxWind);
    } else if (site.siteType === 'thermal') {
      score = scoreThermalHour(h.temperature, h.tcon, h.windSpeed, h.windGust, h.cloudCover, site.maxWind);
    } else {
      // Mixed: use whichever type has better conditions
      const soaringScore = scoreSoaringHour(h.windSpeed, h.windGust, h.windDirection, orientation, site.maxWind);
      const thermalScore = scoreThermalHour(h.temperature, h.tcon, h.windSpeed, h.windGust, h.cloudCover, site.maxWind);
      score = Math.max(soaringScore, thermalScore);
    }
    if (score > bestScore) {
      bestScore = score;
      bestHour = h;
    }
  }

  return { hour: bestHour.hour, score: bestScore, data: bestHour };
};

const calculateLaunchTimeFromHourly = (
  hourlyData: HourlyDataPoint[],
  site: LaunchSite,
  siteOrientation: string
): string => {
  if (!hourlyData || hourlyData.length === 0) {
    return '12:00 PM';  // Fallback
  }

  // Filter to flyable hours (10am - 6pm for launch consideration)
  const flyableHours = hourlyData.filter(h => h.hour >= 10 && h.hour <= 18);

  if (flyableHours.length === 0) {
    return '12:00 PM';
  }

  // Score each hour based on site type
  const scoredHours = flyableHours.map(h => {
    let score = 0;

    if (site.siteType === 'soaring') {
      // Pure soaring site - only care about ridge lift conditions
      score = scoreSoaringHour(h.windSpeed, h.windGust, h.windDirection, siteOrientation, site.maxWind);
    } else if (site.siteType === 'thermal') {
      // Pure thermal site - prioritize thermal conditions
      score = scoreThermalHour(h.temperature, h.tcon, h.windSpeed, h.windGust, h.cloudCover, site.maxWind);
    } else {
      // Mixed site - consider both, weight toward better option
      const thermalScore = scoreThermalHour(h.temperature, h.tcon, h.windSpeed, h.windGust, h.cloudCover, site.maxWind);
      const soaringScore = scoreSoaringHour(h.windSpeed, h.windGust, h.windDirection, siteOrientation, site.maxWind);
      score = Math.max(thermalScore, soaringScore);
    }

    return { hour: h.hour, score };
  });

  // Find the best hour
  const bestHour = scoredHours.reduce((best, current) =>
    current.score > best.score ? current : best
  );

  // Format the hour
  const formatHour = (hour: number): string => {
    if (hour === 12) return '12:00 PM';
    if (hour > 12) return `${hour - 12}:00 PM`;
    return `${hour}:00 AM`;
  };

  return formatHour(bestHour.hour);
};

// Legacy function kept for fallback when no hourly data
const calculateLaunchTime = (
  thermalFlyability: 'good' | 'marginal' | 'poor',
  soaringFlyability: 'good' | 'marginal' | 'poor',
  thermalStrength: number,
  windSpeed: number,
  temperature: number,
  tcon: number
): string => {
  const tempDeficit = tcon - temperature;

  if (thermalFlyability === 'good' && soaringFlyability === 'poor') {
    if (thermalStrength >= 7) return '11:00 AM';
    if (thermalStrength >= 5) return '11:30 AM';
    return '12:00 PM';
  }

  if (soaringFlyability === 'good' && thermalFlyability === 'poor') {
    if (windSpeed >= 15) return '9:00 AM';
    if (windSpeed >= 12) return '10:00 AM';
    return '10:30 AM';
  }

  if (soaringFlyability === 'good' && thermalFlyability === 'good') {
    if (thermalStrength >= 6 && tempDeficit <= 3) return '11:00 AM';
    return '10:30 AM';
  }

  if (soaringFlyability === 'marginal' && thermalFlyability === 'good') {
    if (thermalStrength >= 7) return '11:30 AM';
    return '12:00 PM';
  }

  if (soaringFlyability === 'good' && thermalFlyability === 'marginal') {
    return '10:00 AM';
  }

  if (thermalFlyability === 'marginal') {
    if (tempDeficit <= 5) return '12:00 PM';
    return '1:00 PM';
  }

  if (soaringFlyability === 'marginal') {
    return '11:00 AM';
  }

  return '12:00 PM';
};

const determineSoaringFlyability = (
  site: LaunchSite,
  windSpeed: number,
  windGust: number,
  windDirectionMatch: boolean
): 'good' | 'marginal' | 'poor' => {
  if (!windDirectionMatch) return 'poor';

  // Use site-specific max wind limits
  if (windSpeed < 8) return 'poor';
  if (windSpeed > site.maxWind) return 'poor';
  if (windGust > site.maxWind * 1.25) return 'poor';

  // Good soaring: 10-16 mph with reasonable gusts
  if (windSpeed >= 10 && windSpeed <= 16 && windGust <= site.maxWind) return 'good';
  // Also good: 8+ mph if within site limits
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

// Try to fetch pre-computed cached data first
// Returns { forecasts, generated, isStale } or null if unavailable
const fetchCachedForecast = async (): Promise<{
  forecasts: SiteForecast[];
  generated: Date;
  isStale: boolean;
} | null> => {
  try {
    const response = await fetch('/data/forecast.json');
    if (response.ok) {
      const cached = await response.json();
      const generated = new Date(cached.generated);
      const age = Date.now() - generated.getTime();
      const isStale = age >= 2 * 60 * 60 * 1000;
      if (!isStale) {
        console.log('Using cached forecast data from', cached.generated);
      } else {
        console.log('Cached data is stale (age:', Math.round(age / 60000), 'min), available as fallback');
      }
      return { forecasts: cached.forecasts, generated, isStale };
    }
  } catch (e) {
    console.log('Cached data not available');
  }
  return null;
};

export interface ForecastResult {
  forecasts: SiteForecast[];
  dataTimestamp: Date;
  dataSource: 'live' | 'cached' | 'stale';
}

export const getWeatherForecast = async (): Promise<ForecastResult> => {
  // Try cached data first to avoid API rate limits
  const cachedResult = await fetchCachedForecast();

  // If fresh cached data exists, use it directly
  if (cachedResult && !cachedResult.isStale) {
    dataTimestamp = cachedResult.generated;
    dataSource = 'cached';
    return {
      forecasts: cachedResult.forecasts,
      dataTimestamp: cachedResult.generated,
      dataSource: 'cached'
    };
  }

  // Try live API (stale cache available as fallback)
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

  // Generate 7 days of target dates
  const targetDates = Array.from({ length: 7 }, (_, i) => getPacificDateString(i));

  const forecasts: SiteForecast[] = [];
  let anyHrrrFailed = false;
  let anyApiFailed = false;

  for (const site of launchSites) {
    // Fetch HRRR data for days 0-1 and ECMWF data for days 0-6
    const hrrrData = await fetchHRRRData(site);
    const ecmwfData = await fetchECMWFData(site);

    if (!hrrrData) anyHrrrFailed = true;
    if (!hrrrData && !ecmwfData) anyApiFailed = true;

    const forecastData: WeatherCondition[] = [];

    for (let i = 0; i < targetDates.length; i++) {
      const targetDate = targetDates[i];
      let dayForecast: WeatherCondition | null = null;

      // Use HRRR for days 0-1, ECMWF for days 2-6
      // Only fall through to ECMWF for days 0-1 if HRRR is truly null
      if (i <= 1 && hrrrData) {
        dayForecast = processHRRRDataForDay(site, hrrrData, targetDate);
      }
      // For days 2-6, always use ECMWF. For days 0-1, only use ECMWF if HRRR failed
      if (!dayForecast && ecmwfData) {
        dayForecast = processECMWFDataForDay(site, ecmwfData, targetDate);
      }

      if (dayForecast) {
        forecastData.push(dayForecast);
      } else {
        // Fallback if no data available
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
          flyability: 'poor' as const,
          conditions: 'Forecast not available',
          soaringFlyability: 'poor' as const,
          thermalFlyability: 'poor' as const,
          launchTime: '12:00 PM',
          xcPotential: 'low' as const,
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

    forecasts.push({
      site,
      forecast: forecastData
    });
  }

  // If HRRR failed for any site and we have stale cached data,
  // prefer the stale cache (which has HRRR data) over ECMWF-only results
  if (anyHrrrFailed && cachedResult) {
    console.log('HRRR API failed, falling back to stale cached data (has HRRR)');
    dataTimestamp = cachedResult.generated;
    dataSource = 'stale';
    return {
      forecasts: cachedResult.forecasts,
      dataTimestamp: cachedResult.generated,
      dataSource: 'stale'
    };
  }

  // If all APIs failed entirely and we have stale cache, use it
  if (anyApiFailed && cachedResult) {
    console.log('APIs unavailable, falling back to stale cached data');
    dataTimestamp = cachedResult.generated;
    dataSource = 'stale';
    return {
      forecasts: cachedResult.forecasts,
      dataTimestamp: cachedResult.generated,
      dataSource: 'stale'
    };
  }

  dataTimestamp = now;
  dataSource = 'live';
  return {
    forecasts,
    dataTimestamp: now,
    dataSource: 'live'
  };
};

export const getDataStatus = () => ({
  timestamp: dataTimestamp,
  source: dataSource
});

const PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500];

const fetchPressureLevelData = async (site: LaunchSite): Promise<any> => {
  try {
    const cacheKey = getCacheKey(site) + '-pressure';
    const cached = weatherCache.get(cacheKey);
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
    weatherCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    console.error(`Failed to fetch pressure level data for ${site.name}:`, error);
    const cacheKey = getCacheKey(site) + '-pressure';
    const cached = weatherCache.get(cacheKey);
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
  // Standard atmosphere surface temp adjusted for hour and elevation
  const hourFactor = targetHour >= 10 && targetHour <= 15 ? 1.0 : 0.85;
  const surfaceTempC = (25 - elevM * 0.0065) * hourFactor;
  const surfaceDewC = surfaceTempC - 12;

  const levels: PressureLevelData[] = PRESSURE_LEVELS.map(pressure => {
    // Standard atmosphere altitude for pressure level
    const altM = 44330 * (1 - Math.pow(pressure / 1013.25, 0.1903));
    const altFt = altM * 3.28084;

    // Environmental lapse rate ~6.5°C/km with slight inversion around 850hPa
    let tempC: number;
    if (pressure >= 900) {
      // Surface to ~1km: normal lapse
      tempC = surfaceTempC - (altM - elevM) * 0.0065;
    } else if (pressure >= 850 && pressure < 900) {
      // Slight inversion/isothermal layer (common in Bay Area marine layer)
      const baseTemp = surfaceTempC - (altM - elevM) * 0.004;
      tempC = baseTemp + 1.5; // Temperature inversion
    } else {
      // Above inversion: standard lapse rate
      const inversionTopAlt = 44330 * (1 - Math.pow(850 / 1013.25, 0.1903));
      const inversionTopTemp = surfaceTempC - (inversionTopAlt - elevM) * 0.004 + 1.5;
      tempC = inversionTopTemp - (altM - inversionTopAlt) * 0.0065;
    }

    // Dew point: decreases faster with altitude
    const dewDropRate = 0.002;  // °C/m of dew point depression increase
    const dewPointC = surfaceDewC - (altM - elevM) * dewDropRate;

    // Wind increases with altitude, veers clockwise
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
  // Fallback to generated data when API is unavailable
  return generateFallbackSounding(site, targetHour);
};

export const getWindDirection = (degrees: number): string => {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return directions[Math.round(degrees / 22.5) % 16];
};
