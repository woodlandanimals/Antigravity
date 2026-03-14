import React, { useState, useMemo, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap, Circle } from 'react-leaflet';
import { SiteForecast, WeatherCondition, HourlyDataPoint } from '../types/weather';
import { getWindDirection } from '../services/weatherService';
import WindArrow from './WindArrow';
import 'leaflet/dist/leaflet.css';

interface MapViewProps {
  forecasts: SiteForecast[];
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

// Interpolate hourly data for a given hour
const getHourlySnapshot = (fc: WeatherCondition, hour: number): Partial<HourlyDataPoint> | null => {
  if (!fc.hourlyData || fc.hourlyData.length === 0) return null;
  const match = fc.hourlyData.find(h => h.hour === hour);
  if (match) return match;
  const sorted = [...fc.hourlyData].sort((a, b) => Math.abs(a.hour - hour) - Math.abs(b.hour - hour));
  return sorted[0] || null;
};

// --- Overlay color ramps ---

type OverlayKey = 'topOfLift' | 'liftAGL' | 'liftedIndex' | 'cape' | 'thermalIndex';

// Top of Lift MSL - altitude color ramp
const tolMSLColor = (topOfLift: number) => {
  if (topOfLift >= 12000) return 'rgba(239,68,68,0.45)';
  if (topOfLift >= 10000) return 'rgba(249,115,22,0.4)';
  if (topOfLift >= 8000)  return 'rgba(245,158,11,0.35)';
  if (topOfLift >= 6000)  return 'rgba(234,179,8,0.3)';
  if (topOfLift >= 4000)  return 'rgba(132,204,22,0.25)';
  if (topOfLift >= 2000)  return 'rgba(96,165,250,0.2)';
  return 'rgba(147,197,253,0.12)';
};

// Lift Above Ground - AGL ramp
const liftAGLColor = (agl: number) => {
  if (agl >= 5000) return 'rgba(239,68,68,0.45)';
  if (agl >= 4000) return 'rgba(249,115,22,0.4)';
  if (agl >= 3000) return 'rgba(245,158,11,0.35)';
  if (agl >= 2000) return 'rgba(234,179,8,0.3)';
  if (agl >= 1000) return 'rgba(132,204,22,0.22)';
  return 'rgba(96,165,250,0.12)';
};

// Lifted Index - negative = unstable (good), positive = stable (bad)
const liColor = (li: number) => {
  if (li <= -4) return 'rgba(239,68,68,0.45)';   // very unstable
  if (li <= -2) return 'rgba(249,115,22,0.4)';
  if (li <= 0)  return 'rgba(245,158,11,0.35)';
  if (li <= 2)  return 'rgba(234,179,8,0.25)';
  if (li <= 4)  return 'rgba(132,204,22,0.18)';
  return 'rgba(96,165,250,0.1)';                   // very stable
};

// CAPE
const capeColor = (cape: number) => {
  if (cape >= 1500) return 'rgba(239,68,68,0.45)';
  if (cape >= 1000) return 'rgba(249,115,22,0.4)';
  if (cape >= 500)  return 'rgba(245,158,11,0.35)';
  if (cape >= 200)  return 'rgba(234,179,8,0.28)';
  if (cape >= 50)   return 'rgba(132,204,22,0.2)';
  return 'rgba(96,165,250,0.08)';
};

// Thermal Index (thermalStrength 0-10)
const thermalColor = (strength: number) => {
  if (strength >= 8)  return 'rgba(239,68,68,0.45)';
  if (strength >= 6)  return 'rgba(249,115,22,0.4)';
  if (strength >= 5)  return 'rgba(245,158,11,0.35)';
  if (strength >= 3)  return 'rgba(234,179,8,0.28)';
  if (strength >= 1)  return 'rgba(132,204,22,0.18)';
  return 'rgba(96,165,250,0.08)';
};

// Get overlay circle color for a given layer
const getOverlayColor = (key: OverlayKey, fc: WeatherCondition, elevation: number): string => {
  switch (key) {
    case 'topOfLift': return tolMSLColor(fc.topOfLift);
    case 'liftAGL': return liftAGLColor(fc.topOfLift - elevation);
    case 'liftedIndex': return liColor(fc.liftedIndex ?? 5);
    case 'cape': return capeColor(fc.cape ?? 0);
    case 'thermalIndex': return thermalColor(fc.thermalStrength);
    default: return 'rgba(128,128,128,0.1)';
  }
};

// Get overlay circle radius scaled to value
const getOverlayRadius = (key: OverlayKey, fc: WeatherCondition, elevation: number): number => {
  switch (key) {
    case 'topOfLift': return Math.max(10000, Math.min(35000, (fc.topOfLift / 1000) * 2500));
    case 'liftAGL': {
      const agl = fc.topOfLift - elevation;
      return Math.max(8000, Math.min(30000, agl * 5));
    }
    case 'liftedIndex': {
      const li = fc.liftedIndex ?? 5;
      return Math.max(10000, Math.min(30000, (10 - li) * 2500));
    }
    case 'cape': return Math.max(8000, Math.min(35000, Math.sqrt(fc.cape ?? 0) * 700));
    case 'thermalIndex': return Math.max(8000, Math.min(30000, fc.thermalStrength * 3000));
    default: return 15000;
  }
};

// Get value text for tooltip
const getOverlayValue = (key: OverlayKey, fc: WeatherCondition, elevation: number): string => {
  switch (key) {
    case 'topOfLift': return `${(fc.topOfLift / 1000).toFixed(1)}k'`;
    case 'liftAGL': return `${((fc.topOfLift - elevation) / 1000).toFixed(1)}k'`;
    case 'liftedIndex': return `LI ${fc.liftedIndex ?? '?'}`;
    case 'cape': return `${fc.cape ?? 0}`;
    case 'thermalIndex': return `${fc.thermalStrength}/10`;
    default: return '';
  }
};

// --- Layer definitions ---
const OVERLAY_LAYERS: { key: OverlayKey; label: string; color: string; unit: string }[] = [
  { key: 'topOfLift',    label: 'Top of Lift',       color: '#f59e0b', unit: 'ft MSL' },
  { key: 'liftAGL',      label: 'Lift Above Ground', color: '#f97316', unit: 'ft AGL' },
  { key: 'liftedIndex',  label: 'Lifted Index',      color: '#ef4444', unit: '' },
  { key: 'cape',         label: 'CAPE',              color: '#a855f7', unit: 'J/kg' },
  { key: 'thermalIndex', label: 'Thermal Index',     color: '#22c55e', unit: '/10' },
];

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

// --- Overlay Panel ---

interface OverlayState {
  topOfLift: boolean;
  liftAGL: boolean;
  liftedIndex: boolean;
  cape: boolean;
  thermalIndex: boolean;
}

interface ControlPanelProps {
  overlays: OverlayState;
  setOverlays: React.Dispatch<React.SetStateAction<OverlayState>>;
  activeOverlay: OverlayKey | null;
  setActiveOverlay: (key: OverlayKey | null) => void;
  dayIndex: number;
  setDayIndex: (d: number) => void;
  hour: number;
  setHour: (h: number) => void;
  hasHourly: boolean;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ overlays, setOverlays, activeOverlay, setActiveOverlay, dayIndex, setDayIndex, hour, setHour, hasHourly }) => {
  const [collapsed, setCollapsed] = useState(false);

  const allOff = !Object.values(overlays).some(Boolean);

  const clearAll = () => {
    setOverlays({ topOfLift: false, liftAGL: false, liftedIndex: false, cape: false, thermalIndex: false });
    setActiveOverlay(null);
  };

  const formatHour = (h: number) => {
    if (h === 12) return '12p';
    return h > 12 ? `${h - 12}p` : `${h}a`;
  };

  // Radio-style: only one overlay at a time for clarity
  const handleToggle = (key: OverlayKey) => {
    if (activeOverlay === key) {
      // Turn off
      setActiveOverlay(null);
      setOverlays(prev => ({ ...prev, [key]: false }));
    } else {
      // Turn this one on, rest off
      const newState: OverlayState = { topOfLift: false, liftAGL: false, liftedIndex: false, cape: false, thermalIndex: false };
      newState[key] = true;
      setOverlays(newState);
      setActiveOverlay(key);
    }
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

      {/* Overlay toggles - radio style */}
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
          onClick={clearAll}
          className="w-full font-mono text-[9px] uppercase tracking-wider py-1.5 px-2 border border-neutral-700 rounded-[3px] text-neutral-500 hover:border-neutral-500 hover:text-neutral-300 transition-all mb-3"
        >
          Clear Overlay
        </button>
      )}

      {/* Color ramp legend for active overlay */}
      {activeOverlay && (
        <div className="mb-3">
          <div className="flex items-center gap-0.5 h-2 rounded-sm overflow-hidden">
            {['rgba(96,165,250,0.5)', 'rgba(132,204,22,0.6)', 'rgba(234,179,8,0.7)', 'rgba(245,158,11,0.8)', 'rgba(249,115,22,0.85)', 'rgba(239,68,68,0.9)'].map((c, i) => (
              <div key={i} className="flex-1 h-full" style={{ background: c }} />
            ))}
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="font-mono text-[7px] text-neutral-600">
              {activeOverlay === 'liftedIndex' ? 'Stable' : 'Low'}
            </span>
            <span className="font-mono text-[7px] text-neutral-600">
              {activeOverlay === 'liftedIndex' ? 'Unstable' : 'High'}
            </span>
          </div>
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

const MapView: React.FC<MapViewProps> = ({ forecasts, onSiteClick }) => {
  const [overlays, setOverlays] = useState<OverlayState>({
    topOfLift: false,
    liftAGL: false,
    liftedIndex: false,
    cape: false,
    thermalIndex: false,
  });
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

        {/* Active overlay circles */}
        {activeOverlay && forecasts.map(sf => {
          const fc = getFC(sf);
          if (!fc) return null;
          const color = getOverlayColor(activeOverlay, fc, sf.site.elevation);
          const radius = getOverlayRadius(activeOverlay, fc, sf.site.elevation);
          return (
            <Circle
              key={`overlay-${sf.site.id}`}
              center={[sf.site.latitude, sf.site.longitude]}
              radius={radius}
              pathOptions={{
                fillColor: color,
                fillOpacity: 1,
                color: 'transparent',
                weight: 0,
              }}
            />
          );
        })}

        {/* Site markers with labels */}
        {forecasts.map(sf => {
          const fc = getFC(sf);
          if (!fc) return null;
          const fly = getFlyability(fc);
          const snap = getHourlySnapshot(fc, hour);
          const color = flyabilityColor(fly);

          const baseRadius = 8;
          const radius = baseRadius + (fc.thermalStrength / 10) * 6;

          // Build tooltip text with overlay value
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
        overlays={overlays}
        setOverlays={setOverlays}
        activeOverlay={activeOverlay}
        setActiveOverlay={setActiveOverlay}
        dayIndex={dayIndex}
        setDayIndex={setDayIndex}
        hour={hour}
        setHour={setHour}
        hasHourly={hasHourly}
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
