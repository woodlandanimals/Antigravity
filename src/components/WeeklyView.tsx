import React, { useState, useMemo } from 'react';
import { SiteForecast, WeatherCondition } from '../types/weather';
import WindArrow from './WindArrow';
import SiteDetailModal from './SiteDetailModal';

interface WeeklyViewProps {
  forecasts: SiteForecast[];
}

// Shared helpers — used for both sorting and rendering
const getSoaringLabel = (forecast: WeatherCondition, maxWind: number) => {
  if (!forecast.windDirectionMatch) return 'Cross';
  if (forecast.windSpeed > maxWind || forecast.windGust > maxWind * 1.25) return 'Strong';
  if (forecast.soaringFlyability === 'good') return 'Good';
  if (forecast.soaringFlyability === 'marginal') return 'Wind OK';
  if (forecast.windSpeed < 8) return 'Light';
  return 'Wind OK';
};

const isSoaringFlyable = (label: string) =>
  label === 'Good' || label === 'Wind OK' || label === 'Strong';

const getCellFlyability = (forecast: WeatherCondition, maxWind: number): 'green' | 'yellow' | 'red' => {
  const label = getSoaringLabel(forecast, maxWind);
  const soaringOk = isSoaringFlyable(label);
  const thermalOk = forecast.thermalFlyability === 'good' || forecast.thermalFlyability === 'marginal';

  if (soaringOk && (label === 'Good' || forecast.thermalFlyability === 'good')) return 'green';
  if (soaringOk || thermalOk) return 'yellow';
  return 'red';
};

const CELL_COLORS = {
  green: 'bg-green-100 border-green-400',
  yellow: 'bg-yellow-100 border-yellow-400',
  red: 'bg-red-100 border-red-400',
} as const;

const SOARING_COLOR_CLASS: Record<string, string> = {
  'Good': 'text-green-700 font-bold',
  'Wind OK': 'text-green-600',
  'Strong': 'text-amber-600',
  'Cross': 'text-red-600',
  'Light': 'text-neutral-600',
};

const getThermalLabel = (flyability: string) => {
  if (flyability === 'good') return 'Good';
  if (flyability === 'marginal') return 'Moderate';
  return 'Stable';
};

const WeeklyView: React.FC<WeeklyViewProps> = ({ forecasts }) => {
  const [selectedSite, setSelectedSite] = useState<{ siteForecast: SiteForecast; dayIndex: number } | null>(null);

  // Generate 7 days starting from today in Pacific timezone
  const dates = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() + i);
      const pacificDateStr = date.toLocaleDateString('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short'
      });
      const [weekday, dateStr] = pacificDateStr.split(', ');
      const [month, day] = dateStr.split('/');
      return { dayOfWeek: weekday, monthDay: `${parseInt(month)}/${parseInt(day)}` };
    }),
  []);

  // Rank top 3 thermal site/day combos for the week
  const bestThermalKeys = useMemo(() => {
    const ranked: { key: string; score: number }[] = [];
    for (const sf of forecasts) {
      for (let d = 0; d < 7; d++) {
        const fc = sf.forecast[d];
        if (!fc || (fc.thermalFlyability !== 'good' && fc.thermalFlyability !== 'marginal')) continue;
        const score = (fc.thermalFlyability === 'good' ? 10 : 0) + fc.thermalStrength;
        ranked.push({ key: `${sf.site.id}-${d}`, score });
      }
    }
    ranked.sort((a, b) => b.score - a.score);
    return new Set(ranked.slice(0, 3).map(e => e.key));
  }, [forecasts]);

  // Sort forecasts by flyability score (green=2, yellow=1, red=0)
  const sortedForecasts = useMemo(() =>
    [...forecasts].sort((a, b) => {
      let scoreA = 0, scoreB = 0;
      for (let i = 0; i < 7; i++) {
        const flyA = a.forecast[i] ? getCellFlyability(a.forecast[i], a.site.maxWind) : 'red';
        const flyB = b.forecast[i] ? getCellFlyability(b.forecast[i], b.site.maxWind) : 'red';
        scoreA += flyA === 'green' ? 2 : flyA === 'yellow' ? 1 : 0;
        scoreB += flyB === 'green' ? 2 : flyB === 'yellow' ? 1 : 0;
      }
      return scoreB - scoreA;
    }),
  [forecasts]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-neutral-900">
            <th className="text-left p-4 font-mono text-xs uppercase tracking-wider text-neutral-900 sticky left-0 bg-neutral-50 z-10">
              Site
            </th>
            {dates.map((date, i) => (
              <th key={i} className="p-4 font-mono text-xs uppercase tracking-wider text-neutral-900 min-w-[120px]">
                <div className="text-center">
                  <div className="font-bold">{date.dayOfWeek}</div>
                  <div className="text-[10px] text-neutral-500 mt-1">{date.monthDay}</div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedForecasts.map((siteForecast) => (
            <tr key={siteForecast.site.id} className="border-b border-neutral-200 hover:bg-neutral-50">
              <td className="p-4 sticky left-0 bg-white z-10 border-r border-neutral-200">
                <div>
                  <div className="font-mono text-sm font-bold text-neutral-900">
                    {siteForecast.site.name}
                  </div>
                  <div className="font-mono text-[10px] text-neutral-500 mt-1">
                    {siteForecast.site.elevation}' · {siteForecast.site.orientation}
                  </div>
                </div>
              </td>
              {dates.map((_date, dayIndex) => {
                const forecast = siteForecast.forecast[dayIndex];
                if (!forecast) {
                  return (
                    <td key={dayIndex} className="p-4">
                      <div className="text-center font-mono text-[10px] text-neutral-400">N/A</div>
                    </td>
                  );
                }

                const soaringLabel = getSoaringLabel(forecast, siteForecast.site.maxWind);
                const flyability = getCellFlyability(forecast, siteForecast.site.maxWind);
                const isBest = bestThermalKeys.has(`${siteForecast.site.id}-${dayIndex}`);

                return (
                  <td
                    key={dayIndex}
                    className="p-4 cursor-pointer hover:bg-neutral-100 transition-colors"
                    onClick={() => setSelectedSite({ siteForecast, dayIndex })}
                  >
                    <div className={`relative border-l-2 pl-3 ${CELL_COLORS[flyability]}`}>
                      <div className="font-mono text-xs">
                        <div className="flex gap-2 mb-1">
                          <span className="text-neutral-500">S:</span>
                          <span className={SOARING_COLOR_CLASS[soaringLabel] || 'text-neutral-600'}>
                            {soaringLabel}
                          </span>
                        </div>
                        <div className="flex gap-2 mb-1">
                          <span className="text-neutral-500">T:</span>
                          <span className={forecast.thermalFlyability === 'good' ? 'text-green-700 font-bold' : 'text-neutral-600'}>
                            {getThermalLabel(forecast.thermalFlyability)}
                          </span>
                        </div>
                        <div className="text-[10px] text-neutral-600 mt-2 flex items-center gap-1">
                          <WindArrow direction={forecast.windDirection} size={12} className="text-neutral-600" />
                          {forecast.windSpeed}-{forecast.windGust}
                        </div>
                        <div className="text-[10px] text-neutral-500">
                          {forecast.launchTime}
                        </div>
                      </div>
                      {isBest && (
                        <span className="absolute bottom-0 right-0 font-mono text-[9px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-1.5 py-0.5 leading-none">
                          Best
                        </span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {selectedSite && (
        <SiteDetailModal
          siteForecast={{
            site: selectedSite.siteForecast.site,
            forecast: [selectedSite.siteForecast.forecast[selectedSite.dayIndex]]
          }}
          startDayIndex={selectedSite.dayIndex}
          onClose={() => setSelectedSite(null)}
        />
      )}
    </div>
  );
};

export default WeeklyView;
