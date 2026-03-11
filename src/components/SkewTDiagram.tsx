import React from 'react';
import { SoundingData } from '../types/weather';
import { getWindDirection } from '../services/weatherService';

interface SkewTDiagramProps {
  soundingData: SoundingData;
  siteElevation: number;
}

// Wind barb sub-component
const WindBarb: React.FC<{
  speed: number;    // mph
  direction: number; // degrees (meteorological: direction wind comes FROM)
  x: number;
  y: number;
  size?: number;
}> = ({ speed, direction, x, y, size = 24 }) => {
  const knots = speed * 0.868976;
  const rotation = direction; // staff points into the wind (FROM direction)

  if (knots < 2) {
    // Calm - draw a circle
    return (
      <circle cx={x} cy={y} r={3} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
    );
  }

  // Calculate barb elements
  const pennants = Math.floor(knots / 50);
  const remainingAfterPennants = knots - pennants * 50;
  const fullBarbs = Math.floor(remainingAfterPennants / 10);
  const halfBarbs = Math.floor((remainingAfterPennants - fullBarbs * 10) / 5);

  // Build barb path elements
  const barbLength = size * 0.4;
  const barbSpacing = size * 0.15;
  const pennantWidth = size * 0.12;
  let pathParts: string[] = [];
  let currentPos = 0;

  // Staff line
  pathParts.push(`M 0 0 L 0 ${-size}`);

  // Draw pennants (filled triangles) from top
  for (let i = 0; i < pennants; i++) {
    const y1 = -size + currentPos;
    const y2 = -size + currentPos + pennantWidth;
    pathParts.push(`M 0 ${y1} L ${barbLength} ${(y1 + y2) / 2} L 0 ${y2} Z`);
    currentPos += pennantWidth;
  }

  // Draw full barbs
  for (let i = 0; i < fullBarbs; i++) {
    if (pennants > 0 || i > 0) currentPos += barbSpacing;
    const yPos = -size + currentPos;
    pathParts.push(`M 0 ${yPos} L ${barbLength} ${yPos - barbLength * 0.3}`);
    currentPos += 0;
  }

  // Draw half barbs
  for (let i = 0; i < halfBarbs; i++) {
    currentPos += barbSpacing;
    const yPos = -size + currentPos;
    pathParts.push(`M 0 ${yPos} L ${barbLength * 0.5} ${yPos - barbLength * 0.15}`);
  }

  return (
    <g transform={`translate(${x},${y}) rotate(${rotation})`}>
      <path
        d={pathParts.join(' ')}
        fill="rgba(255,255,255,0.7)"
        stroke="rgba(255,255,255,0.7)"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
};

// Moist adiabatic lapse rate varies with temperature
const calculateMALR = (tempF: number): number => {
  const tempC = (tempF - 32) * 5 / 9;
  if (tempC > 25) return 3.3;
  if (tempC > 15) return 3.0;
  if (tempC > 5) return 2.7;
  if (tempC > -5) return 2.2;
  return 1.8;
};

const SkewTDiagram: React.FC<SkewTDiagramProps> = ({ soundingData, siteElevation }) => {
  // SVG dimensions
  const svgWidth = 400;
  const svgHeight = 420;

  // Plot area (shifted right for cloud column)
  const cloudColLeft = 55;
  const cloudColWidth = 12;
  const plotLeft = 70;
  const plotRight = 310;
  const plotTop = 15;
  const plotBottom = 340;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  // Wind barb column
  const barbColumnX = 355;

  // Altitude range (feet)
  const ALT_MIN = 0;
  const ALT_MAX = 20000;

  // Temperature range (Fahrenheit) for x-axis base
  const T_MIN_F = -30;
  const T_MAX_F = 100;

  // Skew factor (reduced from 0.6 to 0.45 to keep data visible at altitude)
  const SKEW_FACTOR = plotWidth * 0.45 / ALT_MAX;

  // Unique clip ID to avoid collision
  const clipId = `skewt-clip-${soundingData.hour}`;

  const metersToFeet = (m: number): number => m * 3.28084;

  const getAltitude = (level: typeof soundingData.levels[0]): number => {
    return metersToFeet(level.geopotentialHeight);
  };

  const altToY = (altFt: number): number => {
    const fraction = (altFt - ALT_MIN) / (ALT_MAX - ALT_MIN);
    return plotBottom - fraction * plotHeight;
  };

  const tempToX = (tempF: number, altFt: number): number => {
    const baseFraction = (tempF - T_MIN_F) / (T_MAX_F - T_MIN_F);
    const baseX = plotLeft + baseFraction * plotWidth;
    const skewOffset = (altFt - ALT_MIN) * SKEW_FACTOR;
    return baseX + skewOffset;
  };

  // DALR = 5.4°F per 1000 ft
  const DALR = 5.4;

  // Filter levels within altitude range
  const visibleLevels = soundingData.levels
    .filter(l => {
      const alt = getAltitude(l);
      return alt >= ALT_MIN && alt <= ALT_MAX;
    })
    .sort((a, b) => getAltitude(a) - getAltitude(b));

  // Interpolate environmental temperature at arbitrary altitude
  const interpolateEnvTemp = (targetAlt: number): number | null => {
    if (visibleLevels.length < 2) return null;
    for (let i = 0; i < visibleLevels.length - 1; i++) {
      const altLow = getAltitude(visibleLevels[i]);
      const altHigh = getAltitude(visibleLevels[i + 1]);
      if (targetAlt >= altLow && targetAlt <= altHigh) {
        const fraction = (targetAlt - altLow) / (altHigh - altLow);
        return visibleLevels[i].temperature +
          fraction * (visibleLevels[i + 1].temperature - visibleLevels[i].temperature);
      }
    }
    return null;
  };

  // Interpolate dewpoint at arbitrary altitude (for cloud column)
  const interpolateDewpoint = (targetAlt: number): number | null => {
    if (visibleLevels.length < 2) return null;
    for (let i = 0; i < visibleLevels.length - 1; i++) {
      const altLow = getAltitude(visibleLevels[i]);
      const altHigh = getAltitude(visibleLevels[i + 1]);
      if (targetAlt >= altLow && targetAlt <= altHigh) {
        const fraction = (targetAlt - altLow) / (altHigh - altLow);
        return visibleLevels[i].dewPoint +
          fraction * (visibleLevels[i + 1].dewPoint - visibleLevels[i].dewPoint);
      }
    }
    return null;
  };

  // Generate temperature profile path
  const tempPoints = visibleLevels.map(l => {
    const alt = getAltitude(l);
    return `${tempToX(l.temperature, alt)},${altToY(alt)}`;
  });
  const tempPath = tempPoints.length > 0 ? `M ${tempPoints.join(' L ')}` : '';

  // Generate dew point profile path
  const dewPoints = visibleLevels.map(l => {
    const alt = getAltitude(l);
    return `${tempToX(l.dewPoint, alt)},${altToY(alt)}`;
  });
  const dewPath = dewPoints.length > 0 ? `M ${dewPoints.join(' L ')}` : '';

  // Detect inversions
  const inversions: Array<{ altBottom: number; altTop: number }> = [];
  for (let i = 0; i < visibleLevels.length - 1; i++) {
    const lower = visibleLevels[i];
    const upper = visibleLevels[i + 1];
    if (upper.temperature > lower.temperature) {
      inversions.push({
        altBottom: getAltitude(lower),
        altTop: getAltitude(upper)
      });
    }
  }

  // Dry adiabat reference lines
  const adiabatStarts = [-20, 0, 20, 40, 60, 80, 100, 120];
  const adiabatPaths = adiabatStarts.map(startTemp => {
    const points: string[] = [];
    for (let alt = ALT_MIN; alt <= ALT_MAX; alt += 500) {
      const temp = startTemp - (alt - ALT_MIN) / 1000 * DALR;
      const x = tempToX(temp, alt);
      const y = altToY(alt);
      if (x >= plotLeft - 20 && x <= plotRight + 20) {
        points.push(`${x},${y}`);
      }
    }
    return points.length > 1 ? `M ${points.join(' L ')}` : '';
  });

  // Grid levels
  const altGridLevels = [2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000, 20000];
  const tempGridValues = [-20, 0, 20, 40, 60, 80];

  // Calculate TCON and LCL from surface data
  const surfaceLevel = visibleLevels[0];
  let tconF = 0;
  let lclFt = 0;
  if (surfaceLevel) {
    const tempC = (surfaceLevel.temperature - 32) * 5 / 9;
    const dewC = (surfaceLevel.dewPoint - 32) * 5 / 9;
    const lclAGL_m = 125 * (tempC - dewC);
    const lclAGL_ft = lclAGL_m * 3.28084;
    lclFt = Math.round(getAltitude(surfaceLevel) + lclAGL_ft);
    tconF = Math.round(surfaceLevel.dewPoint + (lclAGL_ft / 1000) * DALR);
  }

  // === PARCEL TRAJECTORY (green line) ===
  let parcelPath = '';
  let thermalTopAlt: number | null = null;
  let thermalTopTemp: number | null = null;

  if (surfaceLevel) {
    const surfaceAlt = getAltitude(surfaceLevel);
    const surfaceTemp = surfaceLevel.temperature;
    const points: string[] = [];
    let parcelTemp = surfaceTemp;
    let foundTop = false;

    for (let alt = surfaceAlt; alt <= ALT_MAX; alt += 250) {
      // Determine lapse rate
      if (alt > surfaceAlt) {
        const lapseRate = alt <= lclFt ? DALR : calculateMALR(parcelTemp);
        parcelTemp = parcelTemp - lapseRate * (250 / 1000);
      }

      const x = tempToX(parcelTemp, alt);
      const y = altToY(alt);
      points.push(`${x},${y}`);

      // Detect thermal top: parcel cooler than environment
      if (!foundTop && alt > surfaceAlt + 500) {
        const envTemp = interpolateEnvTemp(alt);
        if (envTemp !== null && parcelTemp < envTemp) {
          thermalTopAlt = alt;
          thermalTopTemp = envTemp;
          foundTop = true;
        }
      }
    }

    parcelPath = points.length > 1 ? `M ${points.join(' L ')}` : '';
  }

  // === CLOUD COVER COLUMN data ===
  // Sample at 500ft intervals, check temp-dewpoint spread
  const cloudBars: Array<{ yTop: number; yBottom: number; opacity: number }> = [];
  if (visibleLevels.length >= 2) {
    const minAlt = getAltitude(visibleLevels[0]);
    const maxAlt = getAltitude(visibleLevels[visibleLevels.length - 1]);
    const step = 500;
    for (let alt = minAlt; alt < maxAlt; alt += step) {
      const temp = interpolateEnvTemp(alt);
      const dew = interpolateDewpoint(alt);
      if (temp !== null && dew !== null) {
        const spread = temp - dew;
        if (spread < 8) {
          const opacity = Math.max(0.15, Math.min(0.8, 1 - spread / 8));
          cloudBars.push({
            yTop: altToY(alt + step),
            yBottom: altToY(alt),
            opacity
          });
        }
      }
    }
  }

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        style={{ backgroundColor: '#2d2d2d' }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={plotLeft} y={plotTop} width={plotWidth} height={plotHeight} />
          </clipPath>
        </defs>

        {/* Plot area background */}
        <rect
          x={plotLeft}
          y={plotTop}
          width={plotWidth}
          height={plotHeight}
          fill="#363636"
          stroke="#555"
          strokeWidth="0.5"
        />

        {/* Cloud cover column header */}
        <text
          x={cloudColLeft + cloudColWidth / 2}
          y={plotTop - 2}
          textAnchor="middle"
          fill="rgba(255,255,255,0.4)"
          style={{ fontSize: '7px', fontFamily: 'monospace' }}
        >
          CLD
        </text>

        {/* Cloud cover column background */}
        <rect
          x={cloudColLeft}
          y={plotTop}
          width={cloudColWidth}
          height={plotHeight}
          fill="#303030"
          stroke="#555"
          strokeWidth="0.5"
        />

        {/* Cloud bars */}
        {cloudBars.map((bar, i) => (
          <rect
            key={`cloud-${i}`}
            x={cloudColLeft}
            y={bar.yTop}
            width={cloudColWidth}
            height={bar.yBottom - bar.yTop}
            fill={`rgba(200, 220, 255, ${bar.opacity})`}
          />
        ))}

        {/* Altitude grid lines and labels */}
        {altGridLevels.map(alt => {
          const y = altToY(alt);
          return (
            <g key={`alt-grid-${alt}`}>
              <line
                x1={cloudColLeft}
                y1={y}
                x2={plotRight}
                y2={y}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="0.5"
              />
              <text
                x={cloudColLeft - 5}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fill="rgba(255,255,255,0.6)"
                style={{ fontSize: '9px', fontFamily: 'monospace' }}
              >
                {(alt / 1000).toFixed(0)}k
              </text>
            </g>
          );
        })}

        {/* Y-axis label */}
        <text
          x={12}
          y={plotTop + plotHeight / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.5)"
          style={{ fontSize: '9px', fontFamily: 'monospace' }}
          transform={`rotate(-90, 12, ${plotTop + plotHeight / 2})`}
        >
          ft (amsl)
        </text>

        {/* Clipped content */}
        <g clipPath={`url(#${clipId})`}>
          {/* Isotherms (skewed vertical temperature reference lines) */}
          {tempGridValues.map(tempF => {
            const x1 = tempToX(tempF, ALT_MIN);
            const y1 = altToY(ALT_MIN);
            const x2 = tempToX(tempF, ALT_MAX);
            const y2 = altToY(ALT_MAX);
            return (
              <line
                key={`isotherm-${tempF}`}
                x1={x1} y1={y1}
                x2={x2} y2={y2}
                stroke={tempF === 32 ? 'rgba(100,180,255,0.3)' : 'rgba(255,255,255,0.08)'}
                strokeWidth={tempF === 32 ? 1 : 0.5}
              />
            );
          })}

          {/* Dry adiabats */}
          {adiabatPaths.map((path, i) => (
            path && (
              <path
                key={`adiabat-${i}`}
                d={path}
                fill="none"
                stroke="rgba(200,180,140,0.2)"
                strokeWidth="0.7"
              />
            )
          ))}

          {/* Inversion highlighting */}
          {inversions.map((inv, i) => {
            const yTop = altToY(inv.altTop);
            const yBottom = altToY(inv.altBottom);
            return (
              <g key={`inversion-${i}`}>
                <rect
                  x={plotLeft}
                  y={yTop}
                  width={plotWidth}
                  height={yBottom - yTop}
                  fill="rgba(239, 68, 68, 0.08)"
                />
                <line
                  x1={plotLeft}
                  y1={yTop}
                  x2={plotRight}
                  y2={yTop}
                  stroke="rgba(239, 68, 68, 0.3)"
                  strokeWidth="0.5"
                  strokeDasharray="4,2"
                />
                <text
                  x={plotLeft + 4}
                  y={yTop + 10}
                  fill="rgba(239, 68, 68, 0.5)"
                  style={{ fontSize: '8px', fontFamily: 'monospace' }}
                >
                  INV
                </text>
              </g>
            );
          })}

          {/* LCL indicator line */}
          {lclFt > ALT_MIN && lclFt < ALT_MAX && (
            <g>
              <line
                x1={plotLeft}
                y1={altToY(lclFt)}
                x2={plotRight}
                y2={altToY(lclFt)}
                stroke="rgba(100,180,255,0.3)"
                strokeWidth="0.7"
                strokeDasharray="6,3"
              />
              <text
                x={plotRight - 4}
                y={altToY(lclFt) - 4}
                textAnchor="end"
                fill="rgba(100,180,255,0.6)"
                style={{ fontSize: '8px', fontFamily: 'monospace' }}
              >
                LCL {(lclFt / 1000).toFixed(1)}k&apos;
              </text>
            </g>
          )}

          {/* Site elevation indicator */}
          {siteElevation > ALT_MIN && siteElevation < ALT_MAX && (
            <line
              x1={plotLeft}
              y1={altToY(siteElevation)}
              x2={plotRight}
              y2={altToY(siteElevation)}
              stroke="rgba(34, 197, 94, 0.3)"
              strokeWidth="0.7"
              strokeDasharray="3,3"
            />
          )}

          {/* Dew point profile (blue line) */}
          {dewPath && (
            <path
              d={dewPath}
              fill="none"
              stroke="#60a5fa"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {/* Temperature profile (red line) */}
          {tempPath && (
            <path
              d={tempPath}
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {/* Parcel trajectory (green dashed line) */}
          {parcelPath && (
            <path
              d={parcelPath}
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="6,3"
            />
          )}

          {/* Thermal top indicator */}
          {thermalTopAlt && thermalTopTemp !== null && thermalTopAlt < ALT_MAX && (
            <g>
              <line
                x1={plotLeft}
                y1={altToY(thermalTopAlt)}
                x2={plotRight}
                y2={altToY(thermalTopAlt)}
                stroke="rgba(34, 197, 94, 0.5)"
                strokeWidth="1"
                strokeDasharray="4,2"
              />
              <circle
                cx={tempToX(thermalTopTemp, thermalTopAlt)}
                cy={altToY(thermalTopAlt)}
                r="4"
                fill="#22c55e"
                stroke="#fff"
                strokeWidth="1"
              />
              <text
                x={plotLeft + 4}
                y={altToY(thermalTopAlt) - 6}
                fill="#22c55e"
                style={{ fontSize: '9px', fontFamily: 'monospace', fontWeight: 'bold' }}
              >
                TOP {(thermalTopAlt / 1000).toFixed(1)}k&apos;
              </text>
            </g>
          )}

          {/* Data points on temperature line */}
          {visibleLevels.map(l => {
            const alt = getAltitude(l);
            return (
              <circle
                key={`temp-dot-${l.pressure}`}
                cx={tempToX(l.temperature, alt)}
                cy={altToY(alt)}
                r="2.5"
                fill="#ef4444"
              />
            );
          })}

          {/* Data points on dew point line */}
          {visibleLevels.map(l => {
            const alt = getAltitude(l);
            return (
              <circle
                key={`dew-dot-${l.pressure}`}
                cx={tempToX(l.dewPoint, alt)}
                cy={altToY(alt)}
                r="2.5"
                fill="#60a5fa"
              />
            );
          })}
        </g>

        {/* Temperature axis labels (bottom) */}
        {tempGridValues.map(tempF => {
          const x = tempToX(tempF, ALT_MIN);
          if (x < plotLeft - 5 || x > plotRight + 5) return null;
          return (
            <text
              key={`temp-label-${tempF}`}
              x={x}
              y={plotBottom + 14}
              textAnchor="middle"
              fill="rgba(255,255,255,0.6)"
              style={{ fontSize: '9px', fontFamily: 'monospace' }}
            >
              {tempF}°F
            </text>
          );
        })}

        {/* Wind barbs column */}
        <text
          x={barbColumnX}
          y={plotTop - 2}
          textAnchor="middle"
          fill="rgba(255,255,255,0.4)"
          style={{ fontSize: '8px', fontFamily: 'monospace' }}
        >
          WIND
        </text>

        {/* Wind barb divider line */}
        <line
          x1={plotRight + 5}
          y1={plotTop}
          x2={plotRight + 5}
          y2={plotBottom}
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="0.5"
        />

        {visibleLevels.map(l => {
          const alt = getAltitude(l);
          const y = altToY(alt);
          return (
            <g key={`barb-${l.pressure}`}>
              <WindBarb
                speed={l.windSpeed}
                direction={l.windDirection}
                x={barbColumnX}
                y={y}
                size={22}
              />
              {/* Speed label */}
              <text
                x={barbColumnX + 20}
                y={y + 1}
                dominantBaseline="middle"
                fill="rgba(255,255,255,0.4)"
                style={{ fontSize: '7px', fontFamily: 'monospace' }}
              >
                {l.windSpeed}
              </text>
            </g>
          );
        })}

        {/* Legend */}
        <g transform={`translate(${plotLeft + 5}, ${plotTop + 8})`}>
          <line x1="0" y1="0" x2="12" y2="0" stroke="#ef4444" strokeWidth="2" />
          <text x="15" y="1" dominantBaseline="middle" fill="rgba(255,255,255,0.6)" style={{ fontSize: '7px', fontFamily: 'monospace' }}>
            Temp
          </text>
          <line x1="44" y1="0" x2="56" y2="0" stroke="#60a5fa" strokeWidth="2" />
          <text x="59" y="1" dominantBaseline="middle" fill="rgba(255,255,255,0.6)" style={{ fontSize: '7px', fontFamily: 'monospace' }}>
            Dew
          </text>
          <line x1="82" y1="0" x2="94" y2="0" stroke="#22c55e" strokeWidth="2" strokeDasharray="4,2" />
          <text x="97" y="1" dominantBaseline="middle" fill="rgba(255,255,255,0.6)" style={{ fontSize: '7px', fontFamily: 'monospace' }}>
            Parcel
          </text>
        </g>

        {/* Surface wind arrow */}
        {surfaceLevel && (
          <g transform={`translate(${plotRight - 20}, ${plotBottom + 30})`}>
            <circle cx="0" cy="0" r="12" fill="#444" stroke="#666" strokeWidth="0.5" />
            <g transform={`rotate(${surfaceLevel.windDirection + 180})`}>
              <path d="M0,-8 L-3,3 L0,0.5 L3,3 Z" fill="#22c55e" />
            </g>
            <text
              x="18" y="-2"
              dominantBaseline="middle"
              fill="rgba(255,255,255,0.8)"
              style={{ fontSize: '10px', fontFamily: 'monospace', fontWeight: 'bold' }}
            >
              {surfaceLevel.windSpeed}mph
            </text>
            <text
              x="18" y="9"
              fill="rgba(255,255,255,0.5)"
              style={{ fontSize: '8px', fontFamily: 'monospace' }}
            >
              {getWindDirection(surfaceLevel.windDirection)}
            </text>
          </g>
        )}

        {/* Bottom info bar */}
        <text
          x={plotLeft}
          y={plotBottom + 32}
          fill="rgba(255,255,255,0.5)"
          style={{ fontSize: '9px', fontFamily: 'monospace' }}
        >
          tcon: {tconF}°F   lcl: {lclFt.toLocaleString()}ft
          {thermalTopAlt ? `   top: ${(thermalTopAlt / 1000).toFixed(1)}k` : ''}   elev: {siteElevation.toLocaleString()}ft
        </text>
      </svg>
    </div>
  );
};

export default SkewTDiagram;
