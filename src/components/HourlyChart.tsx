import React from 'react';
import { HourlyDataPoint } from '../types/weather';
import { getWindDirection } from '../services/weatherService';

interface HourlyChartProps {
  hourlyData: HourlyDataPoint[];
  maxWind: number;
}

const HourlyChart: React.FC<HourlyChartProps> = ({ hourlyData, maxWind }) => {
  if (!hourlyData || hourlyData.length === 0) {
    return null;
  }

  const maxWindSpeed = Math.max(...hourlyData.map(d => Math.max(d.windSpeed, d.windGust)), 5);

  const formatHour = (hour: number) => {
    if (hour === 0) return '12a';
    if (hour === 12) return '12p';
    if (hour > 12) return `${hour - 12}p`;
    return `${hour}a`;
  };

  const getWindBarColor = (speed: number) => {
    const ratio = speed / maxWind;
    if (ratio > 0.9) return '#ef4444';
    if (ratio > 0.7) return '#f59e0b';
    if (ratio > 0.5) return '#84cc16';
    return '#22c55e';
  };

  const getGustBg = (gust: number) => {
    const ratio = gust / maxWind;
    if (ratio > 1.0) return 'bg-red-500 text-white';
    if (ratio > 0.8) return 'bg-orange-400 text-white';
    if (ratio > 0.6) return 'bg-amber-400 text-neutral-900';
    if (ratio > 0.4) return 'bg-lime-400 text-neutral-900';
    return 'bg-green-400 text-neutral-900';
  };

  const getDirBg = (speed: number) => {
    const ratio = speed / maxWind;
    if (ratio > 0.9) return 'bg-red-400 text-white';
    if (ratio > 0.7) return 'bg-amber-400 text-neutral-900';
    if (ratio > 0.5) return 'bg-lime-400 text-neutral-900';
    return 'bg-green-400 text-neutral-900';
  };

  const getTempBg = (temp: number) => {
    if (temp >= 90) return 'bg-red-400 text-white';
    if (temp >= 80) return 'bg-orange-400 text-white';
    if (temp >= 65) return 'bg-amber-400 text-neutral-900';
    if (temp >= 50) return 'bg-yellow-300 text-neutral-900';
    return 'bg-blue-300 text-neutral-900';
  };

  const getCloudIcon = (cloudCover: number) => {
    if (cloudCover <= 10) return '☀️';
    if (cloudCover <= 30) return '🌤';
    if (cloudCover <= 60) return '⛅';
    if (cloudCover <= 85) return '🌥';
    return '☁️';
  };

  // Dense column: ~26px each to fit 24 cols in ~624px + label col
  const col = 'min-w-[26px] w-[26px]';
  const lbl = 'min-w-[36px] w-[36px] pr-1 text-right text-neutral-400 font-bold text-[8px] uppercase tracking-wider shrink-0';

  return (
    <div className="w-full overflow-x-auto">
      <div className="inline-flex flex-col font-mono text-[9px] leading-tight" style={{ minWidth: 'max-content' }}>

        {/* Hour row */}
        <div className="flex items-center">
          <div className={lbl}>Hr</div>
          {hourlyData.map((d, i) => (
            <div key={i} className={`${col} text-center text-neutral-500 font-bold py-0.5 border-b border-neutral-100 text-[8px]`}>
              {formatHour(d.hour)}
            </div>
          ))}
        </div>

        {/* Wind speed bars + values */}
        <div className="flex items-end">
          <div className={`${lbl} self-center`}>
            Wind
          </div>
          {hourlyData.map((d, i) => {
            const barH = Math.max(2, (d.windSpeed / maxWindSpeed) * 36);
            return (
              <div key={i} className={`${col} flex flex-col items-center justify-end`} style={{ height: 52 }}>
                <div className="text-[8px] font-bold text-neutral-700 leading-none mb-px">{d.windSpeed}</div>
                <div
                  className="w-[14px] rounded-t-sm"
                  style={{
                    height: barH,
                    backgroundColor: getWindBarColor(d.windSpeed),
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Wind direction arrows */}
        <div className="flex items-center">
          <div className={lbl} />
          {hourlyData.map((d, i) => (
            <div key={i} className={`${col} flex justify-center py-px`}>
              <svg width="12" height="12" viewBox="0 0 16 16">
                <g transform={`rotate(${d.windDirection + 180}, 8, 8)`}>
                  <line x1="8" y1="13" x2="8" y2="3" stroke="#404040" strokeWidth="1.8" />
                  <polygon points="8,1 5,5 11,5" fill="#404040" />
                </g>
              </svg>
            </div>
          ))}
        </div>

        {/* Wind direction compass label */}
        <div className="flex items-center">
          <div className={lbl} />
          {hourlyData.map((d, i) => (
            <div key={i} className={`${col} text-center py-px`}>
              <span className={`inline-block px-0.5 py-px rounded-sm text-[7px] font-bold ${getDirBg(d.windSpeed)}`}>
                {getWindDirection(d.windDirection)}
              </span>
            </div>
          ))}
        </div>

        {/* Gust row */}
        <div className="flex items-center mt-0.5">
          <div className={lbl}>Gust</div>
          {hourlyData.map((d, i) => (
            <div key={i} className={`${col} text-center py-px`}>
              <span className={`inline-block min-w-[18px] px-0.5 py-px rounded-sm text-[8px] font-bold ${getGustBg(d.windGust)}`}>
                {d.windGust}
              </span>
            </div>
          ))}
        </div>

        {/* Sky row */}
        <div className="flex items-center mt-0.5">
          <div className={lbl}>Sky</div>
          {hourlyData.map((d, i) => (
            <div key={i} className={`${col} text-center py-px text-[10px] leading-none`}>
              {getCloudIcon(d.cloudCover)}
            </div>
          ))}
        </div>

        {/* Temperature row */}
        <div className="flex items-center mt-0.5">
          <div className={lbl}>°F</div>
          {hourlyData.map((d, i) => (
            <div key={i} className={`${col} text-center py-px`}>
              <span className={`inline-block min-w-[18px] px-0.5 py-px rounded-sm text-[8px] font-bold ${getTempBg(d.temperature)}`}>
                {d.temperature}
              </span>
            </div>
          ))}
        </div>

        {/* Cloud % row */}
        <div className="flex items-center mt-0.5">
          <div className={lbl}>Cld</div>
          {hourlyData.map((d, i) => (
            <div key={i} className={`${col} text-center py-px`}>
              <span className="inline-block min-w-[18px] px-0.5 py-px rounded-sm text-[8px] text-neutral-500 bg-neutral-50">
                {d.cloudCover}
              </span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
};

export default HourlyChart;
