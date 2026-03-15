# XC Forecast — How We Score Sites

## The Big Picture

Every hour, we pull weather model data (HRRR for today/tomorrow, ECMWF for days 2-6) and score each site on two independent axes: **ridge soaring** (wind-driven lift along a slope) and **thermals** (rising columns of warm air). The best score wins, and that's how we rank which sites to fly.

---

## Site Ranking

Sites are sorted by their best flyability — whichever is higher between soaring and thermal gets used. Each is rated **Good**, **Marginal**, or **Poor**. The app groups them:

- **Fly Today** — highest-rated site for today
- **Fly Tomorrow** — highest-rated site for tomorrow
- **Other Sites** — everything else, sorted by score

---

## Soaring Flyability

Ridge soaring is binary on wind direction — if wind isn't blowing into the slope, it's an automatic **Poor**. Each site has an accepted wind range (e.g., Ed Levin takes S through NW).

| Rating | Criteria |
|--------|----------|
| **Good** | Wind 10-16 mph, on-direction, gusts within site max |
| **Marginal** | Wind 8+ mph, on-direction, manageable gusts |
| **Poor** | Wrong direction, too light (<8), or too strong |

---

## Thermal Strength (0-10 scale)

This is our composite score for how strong thermals will be. The main ingredients:

| Factor | What it means | Impact |
|--------|--------------|--------|
| **Temp-Dew Spread** | Dry air = stronger thermals. A 25°F+ spread is great, <8°F is poor | Biggest factor (up to +5) |
| **Air Temperature** | Warmer surface = more convection. 80°F+ is ideal | Up to +2 |
| **CAPE** | Convective energy in the atmosphere. Higher = more unstable | Up to +1.5 |
| **Lifted Index** | Atmospheric stability. Negative = unstable (good). Positive = stable | +1 to -1.5 |
| **Wind Speed** | Moderate wind (8-15 mph) helps organize thermals. Too strong kills them | +0.5 to -2 |
| **Site Elevation** | Higher launch = closer to thermal triggers | Up to +1 |

These add up and get clamped to 0-10. A score of 7+ is a strong thermal day; below 3 is unlikely to produce usable lift.

---

## Thermal Flyability

Uses the thermal strength score plus one critical check — **TCON vs Temperature**:

- **TCON** = the temperature the surface needs to reach before thermals trigger
- **Temp deficit** = TCON minus current temp. Zero or negative = thermals are firing

| Rating | Criteria |
|--------|----------|
| **Good** | Strength 5+, temp deficit 5°F or less, wind manageable |
| **Marginal** | Strength 3+, temp deficit 8°F or less |
| **Poor** | Weak thermals, large temp deficit, wrong wind, or overcast |

---

## Lifted Index (LI)

LI measures how stable the atmosphere is by comparing a theoretical rising air parcel to the actual temperature at 500 hPa (~18,000 ft).

| LI Value | Meaning | For pilots |
|----------|---------|------------|
| **< -4** | Very unstable | Strong thermals, watch for overdevelopment |
| **-2 to -4** | Unstable | Good thermal day |
| **0 to -2** | Slightly unstable | Moderate thermals possible |
| **0** | Neutral | Borderline conditions |
| **0 to +4** | Stable | Weak or no thermals |
| **> +4** | Very stable | Don't bother thermalling |

We display LI on the site detail card with a plain-English label (Unstable, Neutral, Stable).

---

## Launch Time

We pick the best hour to launch between 10am-6pm by scoring every hour on:

- **For thermals**: Is TCON reached? Is wind moderate? Are clouds partial (cu = good)?
- **For soaring**: Is wind speed in the sweet spot (10-16 mph)? On direction? Gusts safe?

The hour with the highest combined score wins. As a general rule:
- Strong thermal days → **11am-12pm** (surface heating needs to build)
- Soaring days → **9-10am** (wind is often best in the morning)
- Mixed days → **10:30-11am** (compromise)

---

## Top of Lift (Ceiling)

The maximum altitude thermals can carry you, shown as feet MSL on the site card. Calculated from:

1. **Boundary layer height** (preferred, from HRRR model) — capped at cloud base, reduced by 15% for glider sink
2. **Stability estimate** (fallback) — derived from LI, CAPE, and temp-dew spread

Strong wind reduces the ceiling (shear tears thermals apart). Weak thermal strength also reduces it proportionally — a 3/10 thermal day won't reach the same height as a 7/10 day even with the same atmosphere.

---

## XC Potential

A quick-glance rating for cross-country flying distance:

| Rating | What it takes |
|--------|--------------|
| **High** | 7+ thermals, 4,000+ ft AGL ceiling, wind 15 mph or less |
| **Moderate** | 5+ thermals with 3,000+ ft ceiling, or 6+ thermals with light wind |
| **Low** | Everything else — stay local |

Ridge-only sites always show "Low" for XC since ridge soaring is inherently local.
