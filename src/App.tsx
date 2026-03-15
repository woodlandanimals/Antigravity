import React, { useState, useEffect, useMemo } from 'react';
import Header from './components/Header';
import SiteCard from './components/SiteCard';
import Legend from './components/Legend';
import SiteDetailModal from './components/SiteDetailModal';
import WeeklyView from './components/WeeklyView';
import MapView from './components/MapView';
import { SiteForecast } from './types/weather';
import { getWeatherForecast } from './services/weatherService';

function App() {
  const [forecasts, setForecasts] = useState<SiteForecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [dataSource, setDataSource] = useState<'cached' | 'stale'>('cached');
  const [selectedSite, setSelectedSite] = useState<SiteForecast | null>(null);
  const [view, setView] = useState<'today' | 'weekly' | 'map'>('today');

  const fetchForecasts = async () => {
    try {
      setLoading(true);
      const result = await getWeatherForecast();
      setForecasts(result.forecasts);
      setLastUpdated(result.dataTimestamp);
      setDataSource(result.dataSource);
    } catch (error) {
      console.error('Failed to fetch weather data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchForecasts();
    const interval = setInterval(fetchForecasts, 2 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Sort by best flying conditions first (considering both soaring and thermal)
  const sortedForecasts = useMemo(() => {
    return [...forecasts].sort((a, b) => {
      const scoreMap: Record<string, number> = { good: 3, marginal: 2, poor: 1 };
      const getScore = (f: SiteForecast) => {
        const soaring = scoreMap[f.forecast[0].soaringFlyability];
        const thermal = scoreMap[f.forecast[0].thermalFlyability];
        return Math.max(soaring, thermal);
      };
      return getScore(b) - getScore(a);
    });
  }, [forecasts]);

  // Sort by TOMORROW's conditions (not today's)
  const tomorrowsSorted = useMemo(() => {
    return [...forecasts].sort((a, b) => {
      const scoreMap: Record<string, number> = { good: 3, marginal: 2, poor: 1 };
      const getScore = (f: SiteForecast) => {
        const day2 = f.forecast[1];
        if (!day2) return 0;
        const soaring = scoreMap[day2.soaringFlyability];
        const thermal = scoreMap[day2.thermalFlyability];
        return Math.max(soaring, thermal);
      };
      return getScore(b) - getScore(a);
    });
  }, [forecasts]);

  // Get the single best site for today
  const todaysBest = sortedForecasts.length > 0 ? [sortedForecasts[0]] : [];

  // Get the single best site for tomorrow (based on tomorrow's conditions)
  const tomorrowsBest = tomorrowsSorted.length > 0 && tomorrowsSorted[0].forecast.length > 1
    ? [tomorrowsSorted[0]]
    : [];

  // Remaining sites (all other sites)
  const otherSites = sortedForecasts.slice(1);

  return (
    <div className="min-h-screen bg-neutral-50">
      <Header
        lastUpdated={lastUpdated}
        dataSource={dataSource}
        onRefresh={fetchForecasts}
        isLoading={loading}
        view={view}
        onViewChange={setView}
      />

      <main className={view === 'map' ? '' : 'max-w-6xl mx-auto px-4 py-6'}>
        {loading && forecasts.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-neutral-900 border-t-transparent animate-spin mx-auto mb-4" />
              <p className="font-mono text-sm text-neutral-500">Loading forecast data...</p>
            </div>
          </div>
        )}
        {forecasts.length > 0 && view === 'map' ? (
          <MapView forecasts={sortedForecasts} onSiteClick={(sf) => setSelectedSite(sf)} />
        ) : forecasts.length > 0 && view === 'weekly' ? (
          <WeeklyView forecasts={sortedForecasts} />
        ) : forecasts.length > 0 ? (
          <div className="space-y-8">
            {/* Today's Best - most prominent */}
            {todaysBest.length > 0 && (
              <section>
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase tracking-wider">
                    Fly Today
                  </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {todaysBest.map((forecast) => (
                    <SiteCard
                      key={forecast.site.id}
                      siteForecast={forecast}
                      onClick={() => setSelectedSite(forecast)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Tomorrow's Best */}
            {tomorrowsBest.length > 0 && (
              <section>
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase tracking-wider">
                    Fly Tomorrow
                  </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {tomorrowsBest.map((forecast) => {
                    const tomorrowForecast = {
                      ...forecast,
                      forecast: [forecast.forecast[1]]
                    };
                    return (
                      <SiteCard
                        key={`tomorrow-${forecast.site.id}`}
                        siteForecast={tomorrowForecast}
                        onClick={() => setSelectedSite(forecast)}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* Other Sites - less prominent */}
            {otherSites.length > 0 && (
              <section>
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="font-mono text-sm font-bold text-neutral-400 uppercase tracking-wider">
                    Other Sites
                  </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {otherSites.map((forecast) => (
                    <SiteCard
                      key={forecast.site.id}
                      siteForecast={forecast}
                      onClick={() => setSelectedSite(forecast)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Legend */}
            <Legend />

            {/* Footer */}
            <footer className="border-t border-neutral-200 pt-4">
              <p className="font-mono text-[10px] text-neutral-400 leading-relaxed">
                Forecast for reference only. Verify conditions before flight. Data via Open-Meteo API, optimized for 12:00 launch.
              </p>
            </footer>
          </div>
        ) : null}
      </main>

      {selectedSite && (
        <SiteDetailModal
          siteForecast={selectedSite}
          onClose={() => setSelectedSite(null)}
        />
      )}
    </div>
  );
}

export default App;
