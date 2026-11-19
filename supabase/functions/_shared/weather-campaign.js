// Pure rules for weather-triggered campaigns. Kept free of Deno and network
// code so it can be unit tested with plain Node.

/** Days ahead (after today) that count as "coming": 1 through 5. */
export const CAMPAIGN_LOOKAHEAD_DAYS = 5;

function toFahrenheit(temperature, unit) {
  if (typeof temperature !== 'number' || !Number.isFinite(temperature)) {
    return null;
  }
  return unit === 'C' ? Math.round((temperature * 9) / 5 + 32) : temperature;
}

function localDate(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).format(date);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Finds the hottest daytime high at or above heatF and the coldest night low
 * at or below coldF in the NWS 12-hour forecast, for days 1-5 after today in
 * the business's time zone. Returns { heat, cold }, each { date, tempF } or
 * null.
 */
export function assessCampaignWeather(periods, options) {
  const { coldF, heatF, now = new Date(), timeZone } = options;
  const today = localDate(now.toISOString(), timeZone);
  const result = { cold: null, heat: null };
  if (!today || !Array.isArray(periods)) return result;
  const first = addDays(today, 1);
  const last = addDays(today, CAMPAIGN_LOOKAHEAD_DAYS);

  for (const period of periods) {
    const tempF = toFahrenheit(period?.temperature, period?.temperatureUnit);
    const date = localDate(period?.startTime, timeZone);
    if (tempF === null || !date || date < first || date > last) continue;

    if (period.isDaytime === true && tempF >= heatF) {
      if (!result.heat || tempF > result.heat.tempF) {
        result.heat = { date, tempF };
      }
    }
    if (period.isDaytime === false && tempF <= coldF) {
      if (!result.cold || tempF < result.cold.tempF) {
        result.cold = { date, tempF };
      }
    }
  }
  return result;
}
