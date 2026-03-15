/**
 * Shared weather calculation functions
 *
 * Used by both the hourly fetch script (scripts/fetch-weather.ts)
 * and the client-side weather service (src/services/weatherService.ts).
 *
 * All functions are pure — no API calls, no side effects.
 */

import { LaunchSite } from '../types/weather';

// Parse API time string (e.g. "2026-03-10T14:00") without Date object to avoid UTC shift
export const parseApiTime = (time: string): { dateStr: string; hour: number } => {
  const [dateStr, timePart] = time.split('T');
  return { dateStr, hour: parseInt(timePart.split(':')[0], 10) };
};

// Estimate Lifted Index from CAPE and surface conditions (for ECMWF which lacks LI)
// Scale matches HRRR range: roughly -8 to +8 (°C)
export const estimateLiftedIndex = (cape: number, tempF: number, dewPointF: number): number => {
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

export const calculateLCL = (tempF: number, dewPointF: number, elevationFt: number): { lclMSL: number, tcon: number } => {
  const tempC = (tempF - 32) * 5/9;
  const dewPointC = (dewPointF - 32) * 5/9;
  const lclAGL_m = 125 * (tempC - dewPointC);
  const lclAGL_ft = lclAGL_m * 3.28084;
  let lclMSL_ft = elevationFt + lclAGL_ft;
  lclMSL_ft = Math.max(elevationFt + 500, lclMSL_ft);
  const tcon = dewPointF + (lclAGL_ft / 1000) * 5.4;
  return { lclMSL: lclMSL_ft, tcon: Math.round(tcon) };
};

// Estimate environmental lapse rate from atmospheric stability indicators
export const estimateEnvLapseRate = (cape: number, liftedIndex: number): number => {
  // Returns environmental lapse rate in °F per 1000 ft
  // DALR is 5.4°F/1000ft - stable atmosphere has lower lapse rate
  if (liftedIndex < -4 && cape > 1000) return 5.0;  // Very unstable
  if (liftedIndex < -2 && cape > 500) return 4.5;   // Unstable
  if (liftedIndex < 0 && cape > 200) return 4.0;    // Slightly unstable
  if (liftedIndex < 2) return 3.5;                   // Neutral (typical Bay Area)
  if (liftedIndex < 4) return 3.0;                   // Stable
  return 2.5;                                        // Very stable (inversion)
};

// Apply wind reduction to top of lift - wind shear disrupts thermals
export const applyWindReduction = (topOfLift: number, windSpeed: number, elevationFt: number): number => {
  let reduced = topOfLift;
  if (windSpeed > 20) reduced -= 1000;
  else if (windSpeed > 15) reduced -= 600;
  else if (windSpeed > 10) reduced -= 300;
  return Math.max(elevationFt + 500, Math.round(reduced));
};

// Calculate top of usable lift using thermal equilibrium approach
// This finds where thermals dissipate, not just where clouds form (LCL)
export const calculateTopOfUsableLift = (
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

  // Method 1: Use boundary layer height directly (most accurate)
  if (boundaryLayerHeight && boundaryLayerHeight > 100) {
    const blHeightFt = boundaryLayerHeight * 3.28084;
    let topOfLift = elevationFt + (blHeightFt * 0.85);
    topOfLift = Math.min(topOfLift, lclMSL);
    topOfLift -= GLIDER_SINK_ADJ;
    return applyWindReduction(topOfLift, windSpeed, elevationFt);
  }

  // Method 2: Estimate from atmospheric stability
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

export const calculateThermalStrength = (
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

export const checkWindDirectionMatch = (windDir: number, siteOrientation: string): boolean => {
  const orientationRanges: { [key: string]: [number, number][] } = {
    'N': [[345, 360], [0, 15]],
    'NE': [[15, 75]],
    'NNE-ENE': [[10, 75]],
    'E': [[75, 105]],
    'SE': [[105, 165]],
    'S': [[165, 195]],
    'SSW': [[180, 225]],
    'SW': [[195, 255]],
    'W': [[255, 285]],
    'NW': [[285, 345]],
    'NW-SW': [[285, 360], [0, 15], [195, 255]],  // NW through N to NE + SW
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

export const determineSoaringFlyability = (
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

export const determineThermalFlyability = (
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

export const determineFlyability = (
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

export const calculateXCPotential = (
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

export const analyzeRain = (hourly: any, targetDate: string): string | undefined => {
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

export const extractHourlyData = (
  site: LaunchSite,
  hourly: any,
  targetDate: string
): { hour: number; temperature: number; tcon: number; windSpeed: number; windDirection: number; windGust: number; cloudCover: number }[] => {
  const result: { hour: number; temperature: number; tcon: number; windSpeed: number; windDirection: number; windGust: number; cloudCover: number }[] = [];

  hourly.time.forEach((time: string, index: number) => {
    const { dateStr, hour } = parseApiTime(time);
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

export const calculateLaunchTimeFromHourly = (
  hourlyData: { hour: number; temperature: number; tcon: number; windSpeed: number; windDirection: number; windGust: number; cloudCover: number }[],
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
      score = scoreSoaringHour(h.windSpeed, h.windGust, h.windDirection, siteOrientation, site.maxWind);
    } else if (site.siteType === 'thermal') {
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
