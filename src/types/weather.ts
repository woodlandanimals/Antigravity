export type SiteType = 'thermal' | 'soaring' | 'mixed';

export interface PressureLevelData {
  pressure: number;           // hPa
  temperature: number;        // °F
  dewPoint: number;           // °F
  windSpeed: number;          // mph
  windDirection: number;      // degrees
  geopotentialHeight: number; // meters (from API)
}

export interface SoundingData {
  levels: PressureLevelData[];  // sorted by pressure descending (surface first)
  surfaceElevation: number;     // site elevation in feet MSL
  hour: number;
}

export interface LaunchSite {
  id: string;
  name: string;
  elevation: number;
  latitude: number;
  longitude: number;
  orientation: string;
  maxWind: number;
  siteType: SiteType;
}

export interface HourlyDataPoint {
  hour: number;           // 6-18
  temperature: number;
  tcon: number;
  windSpeed: number;
  windDirection: number;
  windGust: number;
  cloudCover: number;
}

export interface WeatherCondition {
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

  // XC potential
  xcPotential: 'high' | 'moderate' | 'low';
  xcReason?: string;

  // Hourly breakdown
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

export interface SiteForecast {
  site: LaunchSite;
  forecast: WeatherCondition[];
}

// Grid overlay types for continuous weather map
export interface GridMeta {
  latMin: number;
  latMax: number;
  latStep: number;
  lonMin: number;
  lonMax: number;
  lonStep: number;
  rows: number;
  cols: number;
}

export interface GridHour {
  cape: number[];
  liftedIndex: number[];
  cloudCover: number[];
  windSpeed: number[];
  windDir: number[];
  thermalStrength: number[];
  topOfLift: number[];
  blHeight: number[];
}

export interface GridDay {
  date: string;
  hours: Record<string, GridHour>;
}

export interface GridForecast {
  generated: string;
  grid: GridMeta;
  days: GridDay[];
}
