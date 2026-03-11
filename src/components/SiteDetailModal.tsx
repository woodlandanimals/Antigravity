import React, { useState, useEffect, useRef } from 'react';
import { SiteForecast, SoundingData } from '../types/weather';
import { getWindDirection, fetchSoundingData } from '../services/weatherService';
import { X, ChevronDown, ChevronUp } from 'lucide-react';
import HourlyChart from './HourlyChart';
import SkewTDiagram from './SkewTDiagram';
import WindArrow from './WindArrow';

interface SiteDetailModalProps {
  siteForecast: SiteForecast;
  onClose: () => void;
  startDayIndex?: number;
}

const SiteDetailModal: React.FC<SiteDetailModalProps> = ({ siteForecast, onClose, startDayIndex = 0 }) => {
  const { site, forecast } = siteForecast;
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [soundingCache, setSoundingCache] = useState<Record<string, SoundingData | null>>({});
  const [loadingSounding, setLoadingSounding] = useState<string | null>(null);
  const [selectedHour, setSelectedHour] = useState(12);
  const soundingCacheRef = useRef(soundingCache);
  soundingCacheRef.current = soundingCache;

  // Fetch sounding data when a day is expanded or hour changes
  useEffect(() => {
    if (!expandedDay) return;

    const cacheKey = `${expandedDay}-${selectedHour}`;
    if (soundingCacheRef.current[cacheKey] !== undefined) return;

    let cancelled = false;
    setLoadingSounding(expandedDay);

    fetchSoundingData(site, expandedDay, selectedHour)
      .then(data => {
        if (!cancelled) {
          setSoundingCache(prev => ({ ...prev, [cacheKey]: data }));
        }
      })
      .catch(error => {
        console.error('Failed to fetch sounding data:', error);
        if (!cancelled) {
          setSoundingCache(prev => ({ ...prev, [cacheKey]: null }));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSounding(null);
      });

    return () => { cancelled = true; };
  }, [expandedDay, selectedHour, site]);

  const handleHourChange = (hour: number) => {
    setSelectedHour(hour);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'good': return 'bg-green-500';
      case 'marginal': return 'bg-amber-500';
      default: return 'bg-neutral-300';
    }
  };

  const getConditionBorder = (day: typeof forecast[0]) => {
    if (day.soaringFlyability === 'good' || day.thermalFlyability === 'good') {
      return 'border-l-green-500';
    }
    if (day.soaringFlyability === 'marginal' || day.thermalFlyability === 'marginal') {
      return 'border-l-amber-500';
    }
    return 'border-l-neutral-300';
  };

  const getDayLabel = (index: number) => {
    const actualDay = startDayIndex + index;
    if (actualDay === 0) return 'Today';
    if (actualDay === 1) return 'Tomorrow';
    // Use the forecast date to get the day of week
    const day = forecast[index];
    if (day) {
      const [year, month, dayNum] = day.date.split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(dayNum));
      const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
      return dayOfWeek;
    }
    return `Day ${actualDay + 1}`;
  };

  const formatDate = (dateString: string) => {
    const [year, month, day] = dateString.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatHourLabel = (h: number) => {
    if (h === 12) return '12p';
    if (h > 12) return `${h - 12}p`;
    return `${h}a`;
  };

  const soundingHours = [9, 10, 11, 12, 13, 14, 15, 16];

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-mono text-lg font-bold text-neutral-900 tracking-tight">
              {site.name.toUpperCase()}
            </h2>
            <div className="font-mono text-[10px] text-neutral-400 uppercase tracking-wider">
              {site.elevation.toLocaleString()}′ MSL · {site.orientation} · Max {site.maxWind}mph
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center border border-neutral-300
                     hover:border-neutral-900 hover:bg-neutral-900 hover:text-white
                     transition-all duration-150"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Days */}
        <div className="p-6 space-y-6">
          {forecast.map((day, index) => (
            <div
              key={day.date}
              className={`border-l-4 ${getConditionBorder(day)} bg-neutral-50 p-5`}
            >
              {/* Day header */}
              <div className="flex items-start justify-between mb-5">
                <div>
                  <div className="font-mono text-sm font-bold text-neutral-900 uppercase tracking-wider">
                    {getDayLabel(index)}
                  </div>
                  <div className="font-mono text-[10px] text-neutral-400 uppercase tracking-wider">
                    {formatDate(day.date)}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <div className={`w-3 h-3 rounded-full mx-auto mb-1 ${getStatusColor(day.soaringFlyability)}`} />
                    <div className="font-mono text-[9px] uppercase tracking-wider text-neutral-500">Soar</div>
                  </div>
                  <div className="text-center">
                    <div className={`w-3 h-3 rounded-full mx-auto mb-1 ${getStatusColor(day.thermalFlyability)}`} />
                    <div className="font-mono text-[9px] uppercase tracking-wider text-neutral-500">Therm</div>
                  </div>
                  <div className="pl-3 border-l border-neutral-300">
                    <div className={`font-mono text-[10px] uppercase tracking-wider ${day.windDirectionMatch ? 'text-green-600' : 'text-red-600'}`}>
                      {day.windDirectionMatch ? '✓ Wind OK' : '✗ Cross'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Conditions summary */}
              <div className="font-mono text-[11px] text-neutral-700 mb-4 p-3 bg-white border border-neutral-200">
                {day.conditions}
                {day.rainInfo && (
                  <span className="text-blue-600 ml-2">↓ {day.rainInfo}</span>
                )}
              </div>

              {/* Best Launch */}
              <div className="mb-5 p-3 bg-green-50 border border-green-200">
                <div className="font-mono text-[9px] uppercase tracking-wider text-green-600 mb-1">
                  Best Launch Time
                </div>
                <div className="font-mono text-xl font-bold text-green-700">
                  {day.launchTime}
                </div>
              </div>

              {/* Data grid - instrument panel style */}
              <div className="grid grid-cols-4 gap-4">
                {/* Wind */}
                <div className="bg-white p-3 border border-neutral-200">
                  <div className="data-label">Wind</div>
                  <div className="data-value flex items-center gap-1">
                    <WindArrow direction={day.windDirection} size={18} className="text-neutral-700" />
                    {day.windSpeed}
                  </div>
                  <div className="font-mono text-[10px] text-neutral-500">
                    {getWindDirection(day.windDirection)} G{day.windGust}
                  </div>
                </div>

                {/* Temperature */}
                <div className="bg-white p-3 border border-neutral-200">
                  <div className="data-label">Temp</div>
                  <div className="data-value">{day.temperature}°</div>
                  <div className="font-mono text-[10px] text-neutral-500">
                    TCON {day.tcon}°
                  </div>
                </div>

                {/* Thermals */}
                <div className="bg-white p-3 border border-neutral-200">
                  <div className="data-label">Thermal</div>
                  <div className="data-value">{day.thermalStrength}<span className="data-unit">/10</span></div>
                  <div className="font-mono text-[10px] text-neutral-500">
                    CAPE {day.cape}
                  </div>
                </div>

                {/* Top of Lift */}
                <div className="bg-white p-3 border border-neutral-200">
                  <div className="data-label">Ceiling</div>
                  <div className="data-value">{(day.topOfLift / 1000).toFixed(1)}<span className="data-unit">k′</span></div>
                  <div className="font-mono text-[10px] text-neutral-500">
                    {day.topOfLift > site.elevation
                      ? `+${((day.topOfLift - site.elevation) / 1000).toFixed(1)}k AGL`
                      : 'At launch'}
                  </div>
                </div>

                {/* Humidity */}
                <div className="bg-white p-3 border border-neutral-200">
                  <div className="data-label">Humidity</div>
                  <div className="data-value">{day.relativeHumidity}<span className="data-unit">%</span></div>
                  <div className="font-mono text-[10px] text-neutral-500">
                    Dew {day.dewPoint}°
                  </div>
                </div>

                {/* Clouds */}
                <div className="bg-white p-3 border border-neutral-200">
                  <div className="data-label">Clouds</div>
                  <div className="data-value">{day.cloudCover}<span className="data-unit">%</span></div>
                </div>

                {/* Lifted Index */}
                <div className="bg-white p-3 border border-neutral-200">
                  <div className="data-label">LI</div>
                  <div className="data-value">{day.liftedIndex}</div>
                  <div className="font-mono text-[10px] text-neutral-500">
                    {day.liftedIndex && day.liftedIndex < -2 ? 'Unstable' : day.liftedIndex && day.liftedIndex > 2 ? 'Stable' : 'Neutral'}
                  </div>
                </div>

                {/* Spread */}
                <div className="bg-white p-3 border border-neutral-200">
                  <div className="data-label">T–Dew</div>
                  <div className="data-value">{day.temperature - day.dewPoint}°</div>
                  <div className="font-mono text-[10px] text-neutral-500">
                    Spread
                  </div>
                </div>
              </div>

              {/* Hourly breakdown (expandable) */}
              {day.hourlyData && day.hourlyData.length > 0 && (
                <div className="mt-4 pt-4 border-t border-neutral-200">
                  <button
                    onClick={() => setExpandedDay(expandedDay === day.date ? null : day.date)}
                    className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-neutral-500 hover:text-neutral-900 transition-colors"
                  >
                    {expandedDay === day.date ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                    Hourly Breakdown
                  </button>
                  {expandedDay === day.date && (
                    <div className="mt-3 space-y-4">
                      {/* Hourly wind breakdown */}
                      <div className="bg-white border border-neutral-200 py-3 px-1">
                        <HourlyChart
                          hourlyData={day.hourlyData}
                          maxWind={site.maxWind}
                        />
                      </div>

                      {/* Sounding Diagram */}
                      <div className="bg-white border border-neutral-200 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
                            Atmospheric Sounding
                          </div>
                          {/* Hour selector */}
                          <div className="flex gap-1">
                            {soundingHours.map(h => (
                              <button
                                key={h}
                                onClick={() => handleHourChange(h)}
                                className={`font-mono text-[9px] px-1.5 py-0.5 border transition-colors ${
                                  selectedHour === h
                                    ? 'border-neutral-900 bg-neutral-900 text-white'
                                    : 'border-neutral-300 text-neutral-500 hover:border-neutral-500'
                                }`}
                              >
                                {formatHourLabel(h)}
                              </button>
                            ))}
                          </div>
                        </div>

                        {loadingSounding === day.date ? (
                          <div className="flex items-center justify-center py-12 bg-[#2d2d2d]">
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
                          </div>
                        ) : soundingCache[`${day.date}-${selectedHour}`] ? (
                          <SkewTDiagram
                            soundingData={soundingCache[`${day.date}-${selectedHour}`]!}
                            siteElevation={site.elevation}
                          />
                        ) : (
                          <div className="font-mono text-[10px] text-neutral-400 text-center py-12 bg-[#2d2d2d]">
                            Sounding data not available
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* XC Potential indicator */}
              {day.xcPotential && day.xcPotential !== 'low' && (
                <div className="mt-4 pt-4 border-t border-neutral-200">
                  <div className={`inline-flex items-center gap-2 px-3 py-2
                    ${day.xcPotential === 'high' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                    <span className="font-mono text-[10px] uppercase tracking-wider font-bold">
                      XC: {day.xcPotential}
                    </span>
                    {day.xcReason && (
                      <span className="font-mono text-[10px]">— {day.xcReason}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Upper winds if available */}
              {(day.wind850mb || day.wind700mb) && (
                <div className="mt-4 pt-4 border-t border-neutral-200">
                  <div className="font-mono text-[9px] uppercase tracking-wider text-neutral-400 mb-3">
                    Upper Winds
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {day.wind850mb && (
                      <div className="bg-white p-3 border border-neutral-200">
                        <div className="data-label">850mb (~5k′)</div>
                        <div className="data-value">{day.wind850mb}<span className="data-unit">mph</span></div>
                        <div className="font-mono text-[10px] text-neutral-500">
                          {day.windDir850mb ? getWindDirection(day.windDir850mb) : '—'}
                        </div>
                      </div>
                    )}
                    {day.wind700mb && (
                      <div className="bg-white p-3 border border-neutral-200">
                        <div className="data-label">700mb (~10k′)</div>
                        <div className="data-value">{day.wind700mb}<span className="data-unit">mph</span></div>
                        <div className="font-mono text-[10px] text-neutral-500">
                          {day.windDir700mb ? getWindDirection(day.windDir700mb) : '—'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Reference */}
          <div className="border-t border-neutral-200 pt-4">
            <div className="font-mono text-[9px] text-neutral-400 space-y-1">
              <p>TCON = Trigger temp for thermals · CAPE = Convective energy · LI = Lifted Index (negative = unstable)</p>
              <p>Data via Open-Meteo. Optimized for 12:00 launch. Always verify conditions.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SiteDetailModal;
