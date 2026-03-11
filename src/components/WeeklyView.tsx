import React, { useState } from 'react';
import { SiteForecast } from '../types/weather';
import WindArrow from './WindArrow';
import SiteDetailModal from './SiteDetailModal';

interface WeeklyViewProps {
  forecasts: SiteForecast[];
}

const WeeklyView: React.FC<WeeklyViewProps> = ({ forecasts }) => {
  const [selectedSite, setSelectedSite] = useState<{ siteForecast: SiteForecast; dayIndex: number } | null>(null);
  // Generate 7 days starting from today in Pacific timezone
  // This must match the weatherService which uses Pacific time for forecast dates
  const getPacificDate = (daysOffset: number) => {
    const now = new Date();
    const date = new Date(now);
    date.setDate(date.getDate() + daysOffset);

    // Get the date components in Pacific timezone
    const pacificDateStr = date.toLocaleDateString('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short'
    });

    // Parse "Sun, 02/02/2026" format
    const [weekday, dateStr] = pacificDateStr.split(', ');
    const [month, day] = dateStr.split('/');

    return {
      dayOfWeek: weekday,
      monthDay: `${parseInt(month)}/${parseInt(day)}`
    };
  };

  const dates = Array.from({ length: 7 }, (_, i) => getPacificDate(i));

  // Helper to determine if a day is flyable (same logic as cell coloring)
  const getDayFlyability = (siteForecast: SiteForecast, dayIndex: number): 'green' | 'yellow' | 'red' => {
    const forecast = siteForecast.forecast[dayIndex];
    if (!forecast) return 'red';

    // Soaring label logic
    const getSoaringLabel = () => {
      if (!forecast.windDirectionMatch) return 'Cross';
      if (forecast.windSpeed > siteForecast.site.maxWind || forecast.windGust > siteForecast.site.maxWind * 1.25) return 'Strong';
      if (forecast.soaringFlyability === 'good') return 'Good';
      if (forecast.soaringFlyability === 'marginal') return 'Wind OK';
      if (forecast.windSpeed < 8) return 'Light';
      return 'Wind OK';
    };

    const soaringLabel = getSoaringLabel();
    const isSoaringFlyable = soaringLabel === 'Good' || soaringLabel === 'Wind OK' || soaringLabel === 'Strong';
    const isThermalFlyable = forecast.thermalFlyability === 'good' || forecast.thermalFlyability === 'marginal';

    if (isSoaringFlyable && (soaringLabel === 'Good' || forecast.thermalFlyability === 'good')) {
      return 'green';
    }
    if (isSoaringFlyable || isThermalFlyable) {
      return 'yellow';
    }
    return 'red';
  };

  // Rank all site/day combos for thermal flying, pick top 3
  const bestThermalKeys = new Set<string>();
  (() => {
    const thermalRanked: { key: string; score: number }[] = [];
    for (const sf of forecasts) {
      for (let d = 0; d < 7; d++) {
        const fc = sf.forecast[d];
        if (!fc) continue;
        // Only consider flyable thermal days
        if (fc.thermalFlyability !== 'good' && fc.thermalFlyability !== 'marginal') continue;
        // Composite score: flyability tier (good=10, marginal=0) + thermalStrength (0-10)
        const tierBonus = fc.thermalFlyability === 'good' ? 10 : 0;
        const score = tierBonus + fc.thermalStrength;
        thermalRanked.push({ key: `${sf.site.id}-${d}`, score });
      }
    }
    thermalRanked.sort((a, b) => b.score - a.score);
    for (const entry of thermalRanked.slice(0, 3)) {
      bestThermalKeys.add(entry.key);
    }
  })();

  // Sort forecasts by flyability score (green=2, yellow=1, red=0)
  const sortedForecasts = [...forecasts].sort((a, b) => {
    let scoreA = 0;
    let scoreB = 0;

    for (let i = 0; i < 7; i++) {
      const flyA = getDayFlyability(a, i);
      const flyB = getDayFlyability(b, i);
      scoreA += flyA === 'green' ? 2 : flyA === 'yellow' ? 1 : 0;
      scoreB += flyB === 'green' ? 2 : flyB === 'yellow' ? 1 : 0;
    }

    return scoreB - scoreA;
  });

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
              {dates.map((date, dayIndex) => {
                const forecast = siteForecast.forecast[dayIndex];
                if (!forecast) {
                  return (
                    <td key={dayIndex} className="p-4">
                      <div className="text-center font-mono text-[10px] text-neutral-400">
                        N/A
                      </div>
                    </td>
                  );
                }

                const getThermalLabel = (flyability: string) => {
                  if (flyability === 'good') return 'Good';
                  if (flyability === 'marginal') return 'Moderate';
                  return 'Stable';
                };

                // Soaring label based on wind direction match and wind speed
                const getSoaringLabel = () => {
                  if (!forecast.windDirectionMatch) return 'Cross';
                  if (forecast.windSpeed > siteForecast.site.maxWind || forecast.windGust > siteForecast.site.maxWind * 1.25) return 'Strong';
                  if (forecast.soaringFlyability === 'good') return 'Good';
                  if (forecast.soaringFlyability === 'marginal') return 'Wind OK';
                  if (forecast.windSpeed < 8) return 'Light';
                  return 'Wind OK';
                };

                const soaringLabel = getSoaringLabel();
                const soaringColorClass =
                  soaringLabel === 'Good' ? 'text-green-700 font-bold' :
                  soaringLabel === 'Wind OK' ? 'text-green-600' :
                  soaringLabel === 'Strong' ? 'text-amber-600' :  // Strong but flyable - amber
                  soaringLabel === 'Cross' ? 'text-red-600' :
                  'text-neutral-600';

                // Determine cell background based on actual flyability
                // Soaring is flyable if wind direction matches and wind is in range
                const isSoaringFlyable = soaringLabel === 'Good' || soaringLabel === 'Wind OK' || soaringLabel === 'Strong';
                const isThermalFlyable = forecast.thermalFlyability === 'good' || forecast.thermalFlyability === 'marginal';

                const getCellColor = () => {
                  if (isSoaringFlyable && (soaringLabel === 'Good' || forecast.thermalFlyability === 'good')) {
                    return 'bg-green-100 border-green-400';
                  }
                  if (isSoaringFlyable || isThermalFlyable) {
                    return 'bg-yellow-100 border-yellow-400';
                  }
                  return 'bg-red-100 border-red-400';
                };

                const isBestThermal = bestThermalKeys.has(`${siteForecast.site.id}-${dayIndex}`);

                return (
                  <td
                    key={dayIndex}
                    className="p-4 cursor-pointer hover:bg-neutral-100 transition-colors"
                    onClick={() => setSelectedSite({ siteForecast, dayIndex })}
                  >
                    <div className={`relative border-l-2 pl-3 ${getCellColor()}`}>
                      <div className="font-mono text-xs">
                        <div className="flex gap-2 mb-1">
                          <span className="text-neutral-500">S:</span>
                          <span className={soaringColorClass}>
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
                      {isBestThermal && (
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
