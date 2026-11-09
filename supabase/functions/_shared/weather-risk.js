/* global URLSearchParams */

// Pure weather-risk rules for the 4 PM Weather Risk Alert. Kept free of
// Deno and network code so it can be unit tested with plain Node.

export const WEATHER_USER_AGENT =
  'CrewFlow360 weather alerts (support@crewflow360.com)';

// Thresholds are deliberately conservative and documented in the email.
export const THRESHOLDS = Object.freeze({
  highPrecipitation: 70,
  watchPrecipitation: 40,
  highWindMph: 35,
  watchWindMph: 25,
  highHeatF: 105,
  watchHeatF: 95,
  highColdF: 20,
  watchColdF: 32,
});

const DEFAULT_JOB_MINUTES = 120;

/** Highest number in an NWS wind string such as "10 to 15 mph". */
export function parseWindMph(value) {
  if (typeof value !== 'string') return null;
  const numbers = value.match(/\d+(?:\.\d+)?/g);
  if (!numbers) return null;
  const max = Math.max(...numbers.map(Number));
  return Number.isFinite(max) ? max : null;
}

function toFahrenheit(temperature, unit) {
  if (typeof temperature !== 'number' || !Number.isFinite(temperature)) {
    return null;
  }
  return unit === 'C' ? Math.round((temperature * 9) / 5 + 32) : temperature;
}

/** Hourly periods that overlap the job window. */
export function periodsInWindow(periods, startIso, endIso) {
  const start = Date.parse(startIso);
  if (!Number.isFinite(start) || !Array.isArray(periods)) return [];
  const parsedEnd = endIso ? Date.parse(endIso) : Number.NaN;
  const end =
    Number.isFinite(parsedEnd) && parsedEnd > start
      ? parsedEnd
      : start + DEFAULT_JOB_MINUTES * 60_000;

  return periods.filter((period) => {
    const periodStart = Date.parse(period?.startTime);
    const periodEnd = Date.parse(period?.endTime);
    return (
      Number.isFinite(periodStart) &&
      Number.isFinite(periodEnd) &&
      periodStart < end &&
      periodEnd > start
    );
  });
}

/**
 * Assesses one job window. Returns a level (clear, watch, high,
 * unavailable), a short human summary, and the numbers behind it.
 */
export function assessWeatherRisk(periods, startIso, endIso) {
  const window = periodsInWindow(periods, startIso, endIso);
  if (window.length === 0) {
    return {
      level: 'unavailable',
      summary: 'No forecast was available for this time.',
      details: { periods: 0 },
    };
  }

  let maxPrecipitation = 0;
  let maxWind = 0;
  let maxTemp = null;
  let minTemp = null;
  const conditions = new Set();

  for (const period of window) {
    const precipitation = period?.probabilityOfPrecipitation?.value;
    if (typeof precipitation === 'number' && precipitation > maxPrecipitation) {
      maxPrecipitation = precipitation;
    }
    const wind = parseWindMph(period?.windSpeed);
    if (wind !== null && wind > maxWind) maxWind = wind;
    const temp = toFahrenheit(period?.temperature, period?.temperatureUnit);
    if (temp !== null) {
      maxTemp = maxTemp === null ? temp : Math.max(maxTemp, temp);
      minTemp = minTemp === null ? temp : Math.min(minTemp, temp);
    }
    const text = String(period?.shortForecast ?? '').toLowerCase();
    if (text.includes('thunder')) conditions.add('thunderstorms');
    if (/snow|sleet|ice|freezing/.test(text)) conditions.add('snow or ice');
  }

  const t = THRESHOLDS;
  const highReasons = [];
  const watchReasons = [];

  if (conditions.has('thunderstorms')) highReasons.push('thunderstorms');
  if (maxPrecipitation >= t.highPrecipitation) {
    highReasons.push(`rain ${maxPrecipitation}%`);
  } else if (maxPrecipitation >= t.watchPrecipitation) {
    watchReasons.push(`rain ${maxPrecipitation}%`);
  }
  if (maxWind >= t.highWindMph) {
    highReasons.push(`wind up to ${maxWind} mph`);
  } else if (maxWind >= t.watchWindMph) {
    watchReasons.push(`wind up to ${maxWind} mph`);
  }
  if (maxTemp !== null && maxTemp >= t.highHeatF) {
    highReasons.push(`extreme heat ${maxTemp}°F`);
  } else if (maxTemp !== null && maxTemp >= t.watchHeatF) {
    watchReasons.push(`heat ${maxTemp}°F`);
  }
  if (minTemp !== null && minTemp <= t.highColdF) {
    highReasons.push(`hard freeze ${minTemp}°F`);
  } else if (minTemp !== null && minTemp <= t.watchColdF) {
    watchReasons.push(`freezing ${minTemp}°F`);
  }
  if (conditions.has('snow or ice')) watchReasons.push('snow or ice');

  const level =
    highReasons.length > 0
      ? 'high'
      : watchReasons.length > 0
        ? 'watch'
        : 'clear';
  const reasons = [...highReasons, ...watchReasons];
  const firstForecast = String(window[0]?.shortForecast ?? '').trim();
  const summary =
    level === 'clear'
      ? `Looks fine${firstForecast ? `: ${firstForecast}` : ''}.`
      : `${reasons.join(', ')}${firstForecast ? ` (${firstForecast})` : ''}`;

  return {
    level,
    summary: summary.slice(0, 300),
    details: {
      maxPrecipitation,
      maxTemp,
      maxWind,
      minTemp,
      periods: window.length,
      reasons,
    },
  };
}

/** Coordinates from a US Census geocoder response, or null. */
export function parseCensusCoordinates(body) {
  const match = body?.result?.addressMatches?.[0]?.coordinates;
  const longitude = Number(match?.x);
  const latitude = Number(match?.y);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

export function censusGeocodeUrl(address) {
  const params = new URLSearchParams({
    benchmark: 'Public_AR_Current',
    city: address.city ?? '',
    format: 'json',
    state: address.state ?? '',
    street: address.street ?? '',
    zip: address.zip ?? '',
  });
  return `https://geocoding.geo.census.gov/geocoder/locations/address?${params}`;
}

export function nwsPointUrl(latitude, longitude) {
  return `https://api.weather.gov/points/${Number(latitude).toFixed(4)},${Number(longitude).toFixed(4)}`;
}
