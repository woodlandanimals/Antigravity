import React, { useState, useRef, useEffect } from 'react';
import { RefreshCw, ChevronDown } from 'lucide-react';
import { SiteState } from '../types/weather';

interface HeaderProps {
  lastUpdated: Date;
  dataSource: 'cached' | 'stale';
  onRefresh: () => void;
  isLoading: boolean;
  view: 'today' | 'weekly' | 'map';
  onViewChange: (view: 'today' | 'weekly' | 'map') => void;
  selectedState: SiteState;
  onStateChange: (s: SiteState) => void;
}

const STATE_LABELS: Record<SiteState, string> = {
  CA: 'California',
  PA: 'Pennsylvania',
  NY: 'New York',
};

const STATE_ORDER: SiteState[] = ['CA', 'PA', 'NY'];

const formatAge = (date: Date): string => {
  const ageMs = Date.now() - date.getTime();
  const mins = Math.round(ageMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins > 0 ? `${hours}h ${remMins}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h ago` : `${days}d ago`;
};

const StateDropdown: React.FC<{
  selected: SiteState;
  onChange: (s: SiteState) => void;
  compact?: boolean;
}> = ({ selected, onChange, compact }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const textCls = compact
    ? 'font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-400'
    : 'font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-400';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`${textCls} inline-flex items-center gap-1 hover:text-neutral-900 transition-colors`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{STATE_LABELS[selected]}</span>
        <ChevronDown className={`w-2.5 h-2.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1 z-50 bg-white border border-neutral-300 shadow-sm min-w-[140px]"
        >
          {STATE_ORDER.map(s => (
            <button
              key={s}
              role="option"
              aria-selected={s === selected}
              onClick={() => { onChange(s); setOpen(false); }}
              className={`block w-full text-left px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] transition-colors ${
                s === selected
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
              }`}
            >
              {STATE_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const Header: React.FC<HeaderProps> = ({ lastUpdated, dataSource, onRefresh, isLoading, view, onViewChange, selectedState, onStateChange }) => {
  const ageMs = Date.now() - lastUpdated.getTime();
  const isDelayed = dataSource === 'stale' || ageMs > 3 * 60 * 60 * 1000;

  return (
    <header className="bg-white border-b border-neutral-200">
      <div className="max-w-6xl mx-auto px-4 py-4">
        {/* Desktop layout */}
        <div className="hidden md:flex items-center justify-between">
          {/* Logo - TE inspired minimal type */}
          <div className="flex items-baseline gap-3">
            <h1 className="font-mono text-xl font-bold tracking-tight text-neutral-900">
              XC–FORECAST
            </h1>
            <StateDropdown selected={selectedState} onChange={onStateChange} />
          </div>

          {/* Center - View Toggle */}
          <div className="absolute left-1/2 transform -translate-x-1/2">
            <div className="inline-flex border border-neutral-300 bg-white">
              <button
                onClick={() => onViewChange('today')}
                className={`px-6 py-2 font-mono text-xs uppercase tracking-wider transition-all ${
                  view === 'today'
                    ? 'bg-neutral-900 text-white'
                    : 'bg-white text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                Today
              </button>
              <button
                onClick={() => onViewChange('weekly')}
                className={`px-6 py-2 font-mono text-xs uppercase tracking-wider transition-all border-l border-neutral-300 ${
                  view === 'weekly'
                    ? 'bg-neutral-900 text-white'
                    : 'bg-white text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                Weekly
              </button>
              <button
                onClick={() => onViewChange('map')}
                className={`px-6 py-2 font-mono text-xs uppercase tracking-wider transition-all border-l border-neutral-300 ${
                  view === 'map'
                    ? 'bg-neutral-900 text-white'
                    : 'bg-white text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                Map
              </button>
            </div>
          </div>

          {/* Right side - data readout style */}
          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">
                Last Update
              </div>
              <div className="font-mono text-sm font-medium text-neutral-900 tabular-nums">
                {lastUpdated.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false
                })}
              </div>
            </div>

            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="w-10 h-10 flex items-center justify-center border border-neutral-300
                       hover:border-neutral-900 hover:bg-neutral-900 hover:text-white
                       disabled:opacity-50 transition-all duration-150"
              aria-label="Refresh forecasts"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Mobile layout */}
        <div className="md:hidden">
          {/* Top row: Logo and refresh */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="font-mono text-lg font-bold tracking-tight text-neutral-900">
                XC–FORECAST
              </h1>
              <StateDropdown selected={selectedState} onChange={onStateChange} compact />
            </div>

            <div className="flex items-center gap-3">
              <div className="font-mono text-[10px] text-neutral-500 tabular-nums">
                {lastUpdated.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false
                })}
              </div>
              <button
                onClick={onRefresh}
                disabled={isLoading}
                className="w-8 h-8 flex items-center justify-center border border-neutral-300
                         hover:border-neutral-900 hover:bg-neutral-900 hover:text-white
                         disabled:opacity-50 transition-all duration-150"
                aria-label="Refresh forecasts"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Bottom row: Compact toggle */}
          <div className="flex justify-center">
            <div className="inline-flex border border-neutral-300 bg-white">
              <button
                onClick={() => onViewChange('today')}
                className={`px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-all ${
                  view === 'today'
                    ? 'bg-neutral-900 text-white'
                    : 'bg-white text-neutral-600'
                }`}
              >
                Today
              </button>
              <button
                onClick={() => onViewChange('weekly')}
                className={`px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-all border-l border-neutral-300 ${
                  view === 'weekly'
                    ? 'bg-neutral-900 text-white'
                    : 'bg-white text-neutral-600'
                }`}
              >
                Weekly
              </button>
              <button
                onClick={() => onViewChange('map')}
                className={`px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-all border-l border-neutral-300 ${
                  view === 'map'
                    ? 'bg-neutral-900 text-white'
                    : 'bg-white text-neutral-600'
                }`}
              >
                Map
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stale data warning */}
      {isDelayed && (
        <div className="max-w-6xl mx-auto px-4">
          <div className="py-1.5 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
            <span className="font-mono text-[10px] text-neutral-500 tracking-wide">
              Weather data import is delayed, last updated: {formatAge(lastUpdated)}
            </span>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
