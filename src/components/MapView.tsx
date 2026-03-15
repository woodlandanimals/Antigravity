import React, { useState, useMemo, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { SiteForecast, WeatherCondition, HourlyDataPoint, GridForecast, GridHour } from '../types/weather';
import { getWindDirection } from '../services/weatherService';
import WindArrow from './WindArrow';
import 'leaflet/dist/leaflet.css';

interface MapViewProps {
  forecasts: SiteForecast[];
  gridForecast: GridForecast | null;
  onSiteClick: (forecast: SiteForecast) => void;
}

// --- Helpers ---

const getFlyability = (fc: WeatherCondition) => {
  if (fc.soaringFlyability === 'good' || fc.thermalFlyability === 'good') return 'good';
  if (fc.soaringFlyability === 'marginal' || fc.thermalFlyability === 'marginal') return 'marginal';
  return 'poor';
};

const flyabilityColor = (f: string) => {
  switch (f) {
    case 'good': return '#22c55e';
    case 'marginal': return '#f59e0b';
    default: return '#a3a3a3';
  }
};

const getHourlySnapshot = (fc: WeatherCondition, hour: number): Partial<HourlyDataPoint> | null => {
  if (!fc.hourlyData || fc.hourlyData.length === 0) return null;
  const match = fc.hourlyData.find(h => h.hour === hour);
  if (match) return match;
  const sorted = [...fc.hourlyData].sort((a, b) => Math.abs(a.hour - hour) - Math.abs(b.hour - hour));
  return sorted[0] || null;
};

// --- Overlay types & color ramps ---

type OverlayKey = 'topOfLift' | 'thermalIndex' | 'cape' | 'liftedIndex' | 'cloudCover' | 'windSpeed';

// Color ramps returning [r, g, b, a] for canvas pixel painting
type RGBA = [number, number, number, number];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRGBA = (a: RGBA, b: RGBA, t: number): RGBA => [
  Math.round(lerp(a[0], b[0], t)),
  Math.round(lerp(a[1], b[1], t)),
  Math.round(lerp(a[2], b[2], t)),
  Math.round(lerp(a[3], b[3], t)),
];

// Smooth gradient color ramps — each returns RGBA for a given value
const colorRamps: Record<OverlayKey, (val: number) => RGBA> = {
  topOfLift: (v: number) => {
    // 0–12000+ ft MSL
    const stops: [number, RGBA][] = [
      [0,     [147, 197, 253, 30]],
      [2000,  [96,  165, 250, 50]],
      [4000,  [132, 204, 22,  60]],
      [6000,  [234, 179, 8,   80]],
      [8000,  [245, 158, 11,  95]],
      [10000, [249, 115, 22,  110]],
      [12000, [239, 68,  68,  125]],
    ];
    return interpolateStops(stops, v);
  },
  thermalIndex: (v: number) => {
    // 0–10 thermal strength
    const stops: [number, RGBA][] = [
      [0, [96,  165, 250, 20]],
      [1, [132, 204, 22,  45]],
      [3, [234, 179, 8,   70]],
      [5, [245, 158, 11,  95]],
      [7, [249, 115, 22,  115]],
      [9, [239, 68,  68,  130]],
    ];
    return interpolateStops(stops, v);
  },
  cape: (v: number) => {
    const stops: [number, RGBA][] = [
      [0,    [96,  165, 250, 15]],
      [50,   [132, 204, 22,  50]],
      [200,  [234, 179, 8,   70]],
      [500,  [245, 158, 11,  90]],
      [1000, [249, 115, 22,  110]],
      [1500, [239, 68,  68,  130]],
    ];
    return interpolateStops(stops, v);
  },
  liftedIndex: (v: number) => {
    // Inverted: negative = unstable = good (red), positive = stable = blue
    const stops: [number, RGBA][] = [
      [-6, [239, 68,  68,  130]],
      [-4, [249, 115, 22,  110]],
      [-2, [245, 158, 11,  90]],
      [0,  [234, 179, 8,   70]],
      [2,  [132, 204, 22,  45]],
      [4,  [96,  165, 250, 25]],
    ];
    return interpolateStops(stops, v);
  },
  cloudCover: (v: number) => {
    // 0–100% — clear to white/grey
    const stops: [number, RGBA][] = [
      [0,   [255, 255, 255, 0]],
      [20,  [220, 230, 240, 20]],
      [50,  [200, 210, 220, 60]],
      [80,  [180, 190, 200, 100]],
      [100, [160, 170, 180, 130]],
    ];
    return interpolateStops(stops, v);
  },
  windSpeed: (v: number) => {
    // 0–30+ mph
    const stops: [number, RGBA][] = [
      [0,  [96,  165, 250, 20]],
      [5,  [132, 204, 22,  45]],
      [10, [234, 179, 8,   70]],
      [15, [245, 158, 11,  90]],
      [20, [249, 115, 22,  110]],
      [30, [239, 68,  68,  130]],
    ];
    return interpolateStops(stops, v);
  },
};

function interpolateStops(stops: [number, RGBA][], value: number): RGBA {
  if (value <= stops[0][0]) return stops[0][1];
  if (value >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (value >= stops[i][0] && value <= stops[i + 1][0]) {
      const t = (value - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return lerpRGBA(stops[i][1], stops[i + 1][1], t);
    }
  }
  return stops[0][1];
}

// Map overlay key to grid data field
const GRID_FIELD: Record<OverlayKey, keyof GridHour> = {
  topOfLift: 'topOfLift',
  thermalIndex: 'thermalStrength',
  cape: 'cape',
  liftedIndex: 'liftedIndex',
  cloudCover: 'cloudCover',
  windSpeed: 'windSpeed',
};

// Get overlay value text for site tooltip
const getOverlayValue = (key: OverlayKey, fc: WeatherCondition, elevation: number): string => {
  switch (key) {
    case 'topOfLift': return `${(fc.topOfLift / 1000).toFixed(1)}k'`;
    case 'thermalIndex': return `${fc.thermalStrength}/10`;
    case 'cape': return `${fc.cape ?? 0}`;
    case 'liftedIndex': return `LI ${fc.liftedIndex ?? '?'}`;
    case 'cloudCover': return `${fc.cloudCover ?? 0}%`;
    case 'windSpeed': return `${fc.windSpeed}mph`;
    default: return '';
  }
};

// --- Layer definitions ---
const OVERLAY_LAYERS: { key: OverlayKey; label: string; color: string; unit: string }[] = [
  { key: 'thermalIndex', label: 'Thermal Strength', color: '#22c55e', unit: '/10' },
  { key: 'topOfLift',    label: 'Top of Lift',      color: '#f59e0b', unit: 'ft MSL' },
  { key: 'cape',         label: 'CAPE',             color: '#a855f7', unit: 'J/kg' },
  { key: 'liftedIndex',  label: 'Lifted Index',     color: '#ef4444', unit: '' },
  { key: 'cloudCover',   label: 'Cloud Cover',      color: '#94a3b8', unit: '%' },
  { key: 'windSpeed',    label: 'Wind Speed',       color: '#3b82f6', unit: 'mph' },
];

// --- Bilinear interpolation from grid ---

function bilinearSample(
  grid: GridForecast,
  data: number[],
  lat: number,
  lon: number
): number | null {
  const { latMin, latStep, lonMin, lonStep, rows, cols } = grid.grid;

  // Continuous grid coordinates
  const gRow = (lat - latMin) / latStep;
  const gCol = (lon - lonMin) / lonStep;

  // Out of bounds
  if (gRow < 0 || gRow >= rows - 1 || gCol < 0 || gCol >= cols - 1) return null;

  const r0 = Math.floor(gRow);
  const c0 = Math.floor(gCol);
  const r1 = r0 + 1;
  const c1 = c0 + 1;

  const tRow = gRow - r0;
  const tCol = gCol - c0;

  const v00 = data[r0 * cols + c0];
  const v01 = data[r0 * cols + c1];
  const v10 = data[r1 * cols + c0];
  const v11 = data[r1 * cols + c1];

  if (v00 == null || v01 == null || v10 == null || v11 == null) return null;

  // Bilinear interpolation
  const top = v00 + (v01 - v00) * tCol;
  const bot = v10 + (v11 - v10) * tCol;
  return top + (bot - top) * tRow;
}

// --- Canvas grid layer (Leaflet L.GridLayer) ---

const WeatherGridLayer: React.FC<{
  gridForecast: GridForecast;
  overlayKey: OverlayKey;
  dayIndex: number;
  hour: number;
}> = ({ gridForecast, overlayKey, dayIndex, hour }) => {
  const map = useMap();
  const layerRef = useRef<L.GridLayer | null>(null);

  useEffect(() => {
    const gridDay = gridForecast.days[dayIndex];
    if (!gridDay) return;

    // Find closest available hour
    const availableHours = Object.keys(gridDay.hours).map(Number).sort((a, b) => a - b);
    const closestHour = availableHours.reduce((prev, curr) =>
      Math.abs(curr - hour) < Math.abs(prev - hour) ? curr : prev
    , availableHours[0]);

    const gridHour = gridDay.hours[String(closestHour)];
    if (!gridHour) return;

    const field = GRID_FIELD[overlayKey];
    const data = gridHour[field] as number[];
    if (!data || data.length === 0) return;

    const colorFn = colorRamps[overlayKey];

    const CanvasLayer = L.GridLayer.extend({
      createTile(coords: L.Coords) {
        const tile = document.createElement('canvas');
        const tileSize = this.getTileSize();
        tile.width = tileSize.x;
        tile.height = tileSize.y;
        const ctx = tile.getContext('2d');
        if (!ctx) return tile;

        const imgData = ctx.createImageData(tileSize.x, tileSize.y);
        const pixels = imgData.data;

        // Sample every 4th pixel for performance, then fill 4x4 blocks
        const step = 4;

        for (let py = 0; py < tileSize.y; py += step) {
          for (let px = 0; px < tileSize.x; px += step) {
            // Convert pixel to lat/lon
            const point = L.point(
              coords.x * tileSize.x + px,
              coords.y * tileSize.y + py
            );
            const latlng = map.unproject(point, coords.z);

            const value = bilinearSample(gridForecast, data, latlng.lat, latlng.lng);
            if (value === null) continue;

            const [r, g, b, a] = colorFn(value);

            // Fill step x step block
            for (let dy = 0; dy < step && py + dy < tileSize.y; dy++) {
              for (let dx = 0; dx < step && px + dx < tileSize.x; dx++) {
                const idx = ((py + dy) * tileSize.x + (px + dx)) * 4;
                pixels[idx] = r;
                pixels[idx + 1] = g;
                pixels[idx + 2] = b;
                pixels[idx + 3] = a;
              }
            }
          }
        }

        ctx.putImageData(imgData, 0, 0);
        return tile;
      }
    });

    const layer = new CanvasLayer({ opacity: 1 });
    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, gridForecast, overlayKey, dayIndex, hour]);

  return null;
};

// --- Sub-components ---

const StatusDot: React.FC<{ status: string; label: string }> = ({ status, label }) => {
  const bg = status === 'good' ? 'bg-green-500' : status === 'marginal' ? 'bg-amber-500' : 'bg-neutral-400';
  const text = status === 'good' ? 'text-green-400' : status === 'marginal' ? 'text-amber-400' : 'text-neutral-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${bg}`} />
      <span className={`font-mono text-[9px] uppercase tracking-wider ${text}`}>{label}</span>
    </div>
  );
};

const MapResizer: React.FC = () => {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
};

// --- Site Popup ---

const SitePopup: React.FC<{ sf: SiteForecast; fc: WeatherCondition; hourSnap: Partial<HourlyDataPoint> | null; onDetail: () => void }> = ({ sf, fc, hourSnap, onDetail }) => {
  const fly = getFlyability(fc);
  const wind = hourSnap?.windSpeed ?? fc.windSpeed;
  const windDir = hourSnap?.windDirection ?? fc.windDirection;
  const gust = hourSnap?.windGust ?? fc.windGust;
  const temp = hourSnap?.temperature ?? fc.temperature;
  const cloud = hourSnap?.cloudCover ?? fc.cloudCover ?? 0;
  const agl = fc.topOfLift - sf.site.elevation;

  return (
    <div className="map-popup-content" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-2.5">
        <div>
          <div className="font-mono text-[13px] font-bold text-neutral-100 tracking-tight leading-none">
            {sf.site.name.toUpperCase()}
          </div>
          <div className="font-mono text-[9px] text-neutral-500 mt-1">
            {sf.site.elevation.toLocaleString()}′ · {sf.site.orientation}
          </div>
        </div>
        <div className="flex gap-2.5">
          <StatusDot status={fc.soaringFlyability} label="Soar" />
          <StatusDot status={fc.thermalFlyability} label="Therm" />
        </div>
      </div>

      {/* Accent bar */}
      <div className="h-[2px] rounded-full mb-2.5" style={{ background: flyabilityColor(fly) }} />

      {/* Data grid - row 1 */}
      <div className="grid grid-cols-4 gap-2 mb-1.5">
        <div>
          <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-neutral-500">Wind</div>
          <div className="font-mono text-sm font-semibold text-neutral-100 tabular-nums flex items-center gap-0.5">
            <WindArrow direction={windDir} size={12} className="text-neutral-400" />
            {wind}
          </div>
          <div className="font-mono text-[9px] text-neutral-500">{getWindDirection(windDir)} G{gust}</div>
        </div>
        <div>
          <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-neutral-500">Thermal</div>
          <div className="font-mono text-sm font-semibold text-neutral-100 tabular-nums">
            {fc.thermalStrength}<span className="text-[10px] text-neutral-500">/10</span>
          </div>
        </div>
        <div>
          <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-neutral-500">Top</div>
          <div className="font-mono text-sm font-semibold text-neutral-100 tabular-nums">
            {(fc.topOfLift / 1000).toFixed(1)}<span className="text-[10px] text-neutral-500">k′</span>
          </div>
        </div>
        <div>
          <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-neutral-500">AGL</div>
          <div className="font-mono text-sm font-semibold text-neutral-100 tabular-nums">
            {(agl / 1000).toFixed(1)}<span className="text-[10px] text-neutral-500">k′</span>
          </div>
        </div>
      </div>

      {/* Data grid - row 2 */}
      <div className="grid grid-cols-4 gap-2 mb-2.5">
        <div>
          <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-neutral-500">Temp</div>
          <div className="font-mono text-xs font-semibold text-neutral-200 tabular-nums">
            {temp}<span className="text-[9px] text-neutral-500">°F</span>
          </div>
        </div>
        <div>
          <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-neutral-500">CAPE</div>
          <div className="font-mono text-xs font-semibold text-neutral-200 tabular-nums">
            {fc.cape ?? 0}
          </div>
        </div>
        <div>
          <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-neutral-500">LI</div>
          <div className="font-mono text-xs font-semibold text-neutral-200 tabular-nums">
            {fc.liftedIndex ?? '—'}
          </div>
        </div>
        <div>
          <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-neutral-500">Cloud</div>
          <div className="font-mono text-xs font-semibold text-neutral-200 tabular-nums">
            {Math.round(cloud)}<span className="text-[9px] text-neutral-500">%</span>
          </div>
        </div>
      </div>

      {/* Conditions */}
      <div className="font-mono text-[10px] text-neutral-400 leading-relaxed mb-2 line-clamp-2">
        {fc.conditions}
      </div>

      {/* XC + Detail */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {fc.xcPotential !== 'low' && (
            <span className={`font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-medium ${
              fc.xcPotential === 'high' ? 'bg-green-900/50 text-green-400' : 'bg-amber-900/50 text-amber-400'
            }`}>
              XC {fc.xcPotential}
            </span>
          )}
        </div>
        <button
          onClick={onDetail}
          className="font-mono text-[9px] uppercase tracking-wider text-neutral-500 hover:text-neutral-200 transition-colors"
        >
          Details →
        </button>
      </div>

      {fc.rainInfo && (
        <div className="font-mono text-[9px] text-blue-400 mt-1.5">↓ {fc.rainInfo}</div>
      )}
    </div>
  );
};

// --- Control Panel ---

interface ControlPanelProps {
  activeOverlay: OverlayKey | null;
  setActiveOverlay: (key: OverlayKey | null) => void;
  dayIndex: number;
  setDayIndex: (d: number) => void;
  hour: number;
  setHour: (h: number) => void;
  hasHourly: boolean;
  hasGrid: boolean;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ activeOverlay, setActiveOverlay, dayIndex, setDayIndex, hour, setHour, hasHourly, hasGrid }) => {
  const [collapsed, setCollapsed] = useState(false);

  const formatHour = (h: number) => {
    if (h === 12) return '12p';
    return h > 12 ? `${h - 12}p` : `${h}a`;
  };

  const handleToggle = (key: OverlayKey) => {
    setActiveOverlay(activeOverlay === key ? null : key);
  };

  if (collapsed) {
    return (
      <div className="map-control-panel map-control-collapsed" onClick={() => setCollapsed(false)}>
        <div className="font-mono text-[10px] uppercase tracking-wider text-neutral-400 cursor-pointer flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-neutral-500">
            <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Layers
          {activeOverlay && (
            <span className="text-neutral-500 normal-case">· {OVERLAY_LAYERS.find(l => l.key === activeOverlay)?.label}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="map-control-panel">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400 font-medium">
          Layers
        </div>
        <button onClick={() => setCollapsed(true)} className="text-neutral-600 hover:text-neutral-300 transition-colors">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 8L6 4L10 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Overlay toggles */}
      <div className="space-y-1 mb-3">
        {OVERLAY_LAYERS.map(({ key, label, color, unit }) => (
          <button
            key={key}
            onClick={() => handleToggle(key)}
            className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-[4px] transition-all text-left ${
              activeOverlay === key
                ? 'bg-neutral-700/80'
                : 'hover:bg-neutral-800/50'
            }`}
          >
            <div
              className={`w-3 h-3 rounded-full flex-shrink-0 transition-all ${
                activeOverlay === key ? '' : 'opacity-40'
              }`}
              style={{
                background: activeOverlay === key ? color : '#525252',
                boxShadow: activeOverlay === key ? `0 0 8px ${color}60` : 'none',
              }}
            />
            <div className="flex-1 min-w-0">
              <span className={`font-mono text-[10px] transition-colors ${
                activeOverlay === key ? 'text-neutral-100' : 'text-neutral-400'
              }`}>
                {label}
              </span>
              {unit && activeOverlay === key && (
                <span className="font-mono text-[8px] text-neutral-500 ml-1">{unit}</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Clear */}
      {activeOverlay && (
        <button
          onClick={() => setActiveOverlay(null)}
          className="w-full font-mono text-[9px] uppercase tracking-wider py-1.5 px-2 border border-neutral-700 rounded-[3px] text-neutral-500 hover:border-neutral-500 hover:text-neutral-300 transition-all mb-3"
        >
          Clear Overlay
        </button>
      )}

      {/* Color ramp legend */}
      {activeOverlay && (
        <div className="mb-3">
          <div className="flex items-center gap-0.5 h-2 rounded-sm overflow-hidden">
            {['rgba(96,165,250,0.5)', 'rgba(132,204,22,0.6)', 'rgba(234,179,8,0.7)', 'rgba(245,158,11,0.8)', 'rgba(249,115,22,0.85)', 'rgba(239,68,68,0.9)'].map((c, i) => (
              <div key={i} className="flex-1 h-full" style={{ background: c }} />
            ))}
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="font-mono text-[7px] text-neutral-600">
              {activeOverlay === 'liftedIndex' ? 'Stable' : activeOverlay === 'cloudCover' ? 'Clear' : 'Low'}
            </span>
            <span className="font-mono text-[7px] text-neutral-600">
              {activeOverlay === 'liftedIndex' ? 'Unstable' : activeOverlay === 'cloudCover' ? 'Overcast' : 'High'}
            </span>
          </div>
        </div>
      )}

      {!hasGrid && activeOverlay && (
        <div className="font-mono text-[8px] text-amber-500/70 mb-3">
          Grid data loading...
        </div>
      )}

      {/* Divider */}
      <div className="h-px bg-neutral-700/50 mb-3" />

      {/* Day selector */}
      <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-neutral-500 mb-1.5">Day</div>
      <div className="flex gap-1 mb-3">
        {['Today', 'Tmrw'].map((label, i) => (
          <button
            key={i}
            onClick={() => setDayIndex(i)}
            className={`flex-1 font-mono text-[10px] py-1.5 rounded-[3px] transition-all ${
              dayIndex === i
                ? 'bg-neutral-700 text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Hour slider */}
      {hasHourly && (
        <>
          <div className="flex items-center justify-between mb-1.5">
            <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-neutral-500">Hour</div>
            <div className="font-mono text-[11px] text-neutral-200 font-medium tabular-nums">
              {formatHour(hour)}
            </div>
          </div>
          <div className="relative">
            <input
              type="range"
              min={6}
              max={18}
              value={hour}
              onChange={(e) => setHour(parseInt(e.target.value))}
              className="map-hour-slider w-full"
            />
            <div className="flex justify-between mt-1">
              {[6, 9, 12, 15, 18].map(h => (
                <span key={h} className="font-mono text-[8px] text-neutral-600 tabular-nums">
                  {formatHour(h)}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Site legend */}
      <div className="h-px bg-neutral-700/50 my-3" />
      <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-neutral-600 mb-1.5">Sites</div>
      <div className="space-y-1">
        {[
          { color: '#22c55e', label: 'Good' },
          { color: '#f59e0b', label: 'Marginal' },
          { color: '#a3a3a3', label: 'Poor' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}40` }} />
            <span className="font-mono text-[9px] text-neutral-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Main MapView ---

const MapView: React.FC<MapViewProps> = ({ forecasts, gridForecast, onSiteClick }) => {
  const [activeOverlay, setActiveOverlay] = useState<OverlayKey | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [hour, setHour] = useState(12);
  const mapRef = useRef<any>(null);

  const hasHourly = useMemo(() => {
    return forecasts.some(f => f.forecast[dayIndex]?.hourlyData && f.forecast[dayIndex].hourlyData!.length > 0);
  }, [forecasts, dayIndex]);

  const getFC = (sf: SiteForecast): WeatherCondition | null => {
    return sf.forecast[dayIndex] || null;
  };

  return (
    <div className="map-view-container">
      <MapContainer
        center={[37.5, -120.5]}
        zoom={7}
        minZoom={5}
        maxZoom={13}
        zoomControl={false}
        className="map-canvas"
        ref={mapRef}
      >
        <MapResizer />

        {/* Terrain tiles */}
        <TileLayer
          attribution='Map data: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
          url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
          maxZoom={17}
        />

        {/* Grid weather overlay — renders below site markers */}
        {activeOverlay && gridForecast && (
          <WeatherGridLayer
            gridForecast={gridForecast}
            overlayKey={activeOverlay}
            dayIndex={dayIndex}
            hour={hour}
          />
        )}

        {/* Site markers with labels */}
        {forecasts.map(sf => {
          const fc = getFC(sf);
          if (!fc) return null;
          const fly = getFlyability(fc);
          const snap = getHourlySnapshot(fc, hour);
          const color = flyabilityColor(fly);

          const baseRadius = 8;
          const radius = baseRadius + (fc.thermalStrength / 10) * 6;

          const overlayVal = activeOverlay ? ` · ${getOverlayValue(activeOverlay, fc, sf.site.elevation)}` : '';

          return (
            <React.Fragment key={`site-${sf.site.id}`}>
              {/* Glow ring */}
              <CircleMarker
                center={[sf.site.latitude, sf.site.longitude]}
                radius={radius + 4}
                pathOptions={{
                  fillColor: color,
                  fillOpacity: 0.15,
                  color: color,
                  weight: 1,
                  opacity: 0.3,
                }}
              />
              {/* Main marker */}
              <CircleMarker
                center={[sf.site.latitude, sf.site.longitude]}
                radius={radius}
                pathOptions={{
                  fillColor: color,
                  fillOpacity: 0.9,
                  color: '#fff',
                  weight: 2,
                  opacity: 0.8,
                }}
              >
                <Tooltip
                  permanent
                  direction="right"
                  offset={[radius + 4, 0]}
                  className="map-site-tooltip"
                >
                  <span style={{ color }}>{sf.site.name}</span>
                  {overlayVal && <span className="map-overlay-val">{overlayVal}</span>}
                </Tooltip>
                <Popup className="map-popup" closeButton={false} maxWidth={320} minWidth={260}>
                  <SitePopup
                    sf={sf}
                    fc={fc}
                    hourSnap={snap}
                    onDetail={() => onSiteClick(sf)}
                  />
                </Popup>
              </CircleMarker>
            </React.Fragment>
          );
        })}
      </MapContainer>

      {/* Control panel */}
      <ControlPanel
        activeOverlay={activeOverlay}
        setActiveOverlay={setActiveOverlay}
        dayIndex={dayIndex}
        setDayIndex={setDayIndex}
        hour={hour}
        setHour={setHour}
        hasHourly={hasHourly}
        hasGrid={!!gridForecast}
      />

      {/* Data attribution */}
      <div className="map-attribution">
        <span className="font-mono text-[8px] text-neutral-500">
          HRRR 3km · Open-Meteo
        </span>
      </div>
    </div>
  );
};

export default MapView;
