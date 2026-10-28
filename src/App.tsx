import React, { useState, useEffect, useMemo } from 'react';
import Header from './components/Header';
import SiteCard from './components/SiteCard';
import Legend from './components/Legend';
import SiteDetailModal from './components/SiteDetailModal';
import WeeklyView from './components/WeeklyView';
import MapView from './components/MapView';
import { SiteForecast, GridForecast, SiteState } from './types/weather';
import { getWeatherForecast, getGridForecast } from './services/weatherService';

const STATE_STORAGE_KEY = 'xcforecast.selectedState';
const VALID_STATES: SiteState[] = ['CA', 'MA', 'NY', 'PA', 'VT', 'VA'];

const loadInitialState = (): SiteState => {
  try {
    const stored = localStorage.getItem(STATE_STORAGE_KEY);
    if (stored && (VALID_STATES as string[]).includes(stored)) return stored as SiteState;
  } catch { /* localStorage blocked */ }
  return 'CA';
};

function App() {
  const [forecasts, setForecasts] = useState<SiteForecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [dataSource, setDataSource] = useState<'cached' | 'stale'>('cached');
  const [selectedSite, setSelectedSite] = useState<SiteForecast | null>(null);
  const [view, setView] = useState<'today' | 'weekly' | 'map'>('today');
  const [gridForecast, setGridForecast] = useState<GridForecast | null>(null);
  const [selectedState, setSelectedState] = useState<SiteState>(loadInitialState);

  const changeState = (s: SiteState) => {
    setSelectedState(s);
    try { localStorage.setItem(STATE_STORAGE_KEY, s); } catch { /* localStorage blocked */ }
    // Grid heatmap is CA-only; dismissing the modal and resetting state-specific UI
    setSelectedSite(null);
  };

  // Filter forecasts by selected state. Older forecast.json records (pre-state-field
  // deployment) have no site.state — treat them as CA so nothing disappears while the
  // scheduled fetch catches up to the new site data.
  const stateFiltered = useMemo(() => {
    return forecasts.filter(f => (f.site.state ?? 'CA') === selectedState);
  }, [forecasts, selectedState]);

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

  // Load grid data for map overlays (separate from site forecasts, non-blocking)
  useEffect(() => {
    getGridForecast().then(grid => {
      if (grid) setGridForecast(grid);
    });
  }, []);

  useEffect(() => {
    fetchForecasts();
    const interval = setInterval(fetchForecasts, 2 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Sort by best flying conditions first (considering both soaring and thermal)
  const sortedForecasts = useMemo(() => {
    return [...stateFiltered].sort((a, b) => {
      const scoreMap: Record<string, number> = { good: 3, marginal: 2, poor: 1 };
      const getScore = (f: SiteForecast) => {
        const soaring = scoreMap[f.forecast[0].soaringFlyability];
        const thermal = scoreMap[f.forecast[0].thermalFlyability];
        return Math.max(soaring, thermal);
      };
      return getScore(b) - getScore(a);
    });
  }, [stateFiltered]);

  // Sort by TOMORROW's conditions (not today's)
  const tomorrowsSorted = useMemo(() => {
    return [...stateFiltered].sort((a, b) => {
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
  }, [stateFiltered]);

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
        selectedState={selectedState}
        onStateChange={changeState}
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
        {!loading && forecasts.length > 0 && stateFiltered.length === 0 && (
          <div className="max-w-md mx-auto text-center py-20">
            <p className="font-mono text-sm text-neutral-500">
              No forecast data for this state yet. The next hourly fetch will populate it.
            </p>
          </div>
        )}
        {stateFiltered.length > 0 && view === 'map' ? (
          <MapView
            forecasts={sortedForecasts}
            gridForecast={selectedState === 'CA' ? gridForecast : null}
            onSiteClick={(sf) => setSelectedSite(sf)}
          />
        ) : stateFiltered.length > 0 && view === 'weekly' ? (
          <WeeklyView forecasts={sortedForecasts} />
        ) : stateFiltered.length > 0 ? (
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
