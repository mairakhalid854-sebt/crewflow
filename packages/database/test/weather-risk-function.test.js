import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  WEATHER_USER_AGENT,
  assessWeatherRisk,
  censusGeocodeUrl,
  nwsPointUrl,
  parseCensusCoordinates,
  parseWindMph,
  periodsInWindow,
} from '../../../supabase/functions/_shared/weather-risk.js';

const edgeFunction = readFileSync(
  new URL(
    '../../../supabase/functions/weather-risk-check/index.js',
    import.meta.url,
  ),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202611090007_ai_weather_risk.sql',
    import.meta.url,
  ),
  'utf8',
);

function period(startHour, overrides = {}) {
  const start = new Date(Date.UTC(2026, 10, 10, startHour));
  const end = new Date(Date.UTC(2026, 10, 10, startHour + 1));
  return {
    endTime: end.toISOString(),
    probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 10 },
    shortForecast: 'Sunny',
    startTime: start.toISOString(),
    temperature: 70,
    temperatureUnit: 'F',
    windSpeed: '5 mph',
    ...overrides,
  };
}

const jobStart = '2026-11-10T14:00:00.000Z';
const jobEnd = '2026-11-10T16:00:00.000Z';

describe('weather risk rules', () => {
  it('reads the highest wind speed from NWS text', () => {
    expect(parseWindMph('10 to 15 mph')).toBe(15);
    expect(parseWindMph('5 mph')).toBe(5);
    expect(parseWindMph('calm')).toBeNull();
    expect(parseWindMph(undefined)).toBeNull();
  });

  it('only uses forecast hours that overlap the job', () => {
    const periods = [period(12), period(14), period(15), period(16)];
    expect(periodsInWindow(periods, jobStart, jobEnd)).toHaveLength(2);
    // Missing end time assumes a two-hour job.
    expect(periodsInWindow(periods, jobStart, null)).toHaveLength(2);
  });

  it('marks clear weather as clear', () => {
    const result = assessWeatherRisk(
      [period(14), period(15)],
      jobStart,
      jobEnd,
    );
    expect(result.level).toBe('clear');
    expect(result.summary).toBe('Looks fine: Sunny.');
  });

  it('flags heavy rain and thunderstorms as high risk', () => {
    const rain = assessWeatherRisk(
      [
        period(14, {
          probabilityOfPrecipitation: { value: 80 },
          shortForecast: 'Rain Likely',
        }),
      ],
      jobStart,
      jobEnd,
    );
    expect(rain.level).toBe('high');
    expect(rain.summary).toContain('rain 80%');

    const storm = assessWeatherRisk(
      [period(15, { shortForecast: 'Chance Showers And Thunderstorms' })],
      jobStart,
      jobEnd,
    );
    expect(storm.level).toBe('high');
    expect(storm.details.reasons).toContain('thunderstorms');
  });

  it('flags moderate rain, wind, heat, and freezing as watch', () => {
    expect(
      assessWeatherRisk(
        [period(14, { probabilityOfPrecipitation: { value: 45 } })],
        jobStart,
        jobEnd,
      ).level,
    ).toBe('watch');
    expect(
      assessWeatherRisk(
        [period(14, { windSpeed: '20 to 28 mph' })],
        jobStart,
        jobEnd,
      ).level,
    ).toBe('watch');
    expect(
      assessWeatherRisk([period(14, { temperature: 97 })], jobStart, jobEnd)
        .level,
    ).toBe('watch');
    expect(
      assessWeatherRisk([period(14, { temperature: 30 })], jobStart, jobEnd)
        .level,
    ).toBe('watch');
  });

  it('converts Celsius forecasts before comparing', () => {
    const result = assessWeatherRisk(
      [period(14, { temperature: 41, temperatureUnit: 'C' })],
      jobStart,
      jobEnd,
    );
    expect(result.level).toBe('high');
    expect(result.details.maxTemp).toBe(106);
  });

  it('reports unavailable instead of guessing when no hour matches', () => {
    const result = assessWeatherRisk([period(2)], jobStart, jobEnd);
    expect(result.level).toBe('unavailable');
  });

  it('parses Census coordinates and rejects bad ones', () => {
    expect(
      parseCensusCoordinates({
        result: {
          addressMatches: [{ coordinates: { x: -97.7431, y: 30.2672 } }],
        },
      }),
    ).toEqual({ latitude: 30.2672, longitude: -97.7431 });
    expect(
      parseCensusCoordinates({ result: { addressMatches: [] } }),
    ).toBeNull();
    expect(
      parseCensusCoordinates({
        result: { addressMatches: [{ coordinates: { x: 999, y: 30 } }] },
      }),
    ).toBeNull();
  });

  it('builds the free government URLs with a contact user agent', () => {
    expect(
      censusGeocodeUrl({
        city: 'Austin',
        state: 'TX',
        street: '1 Main St',
        zip: '78701',
      }),
    ).toMatch(
      /^https:\/\/geocoding\.geo\.census\.gov\/geocoder\/locations\/address\?/,
    );
    expect(nwsPointUrl(30.26721, -97.74312)).toBe(
      'https://api.weather.gov/points/30.2672,-97.7431',
    );
    expect(WEATHER_USER_AGENT).toContain('support@crewflow360.com');
  });
});

describe('weather risk edge function and migration', () => {
  it('requires the service key and never edits jobs', () => {
    expect(edgeFunction).toContain("request.headers.get('apikey')");
    expect(edgeFunction).not.toMatch(/from\('jobs'\)\s*\.update/);
    expect(edgeFunction).toContain("'record_job_weather_risk'");
    expect(edgeFunction).toContain(
      "hourlyUrl.startsWith('https://api.weather.gov/')",
    );
  });

  it('keeps alerts off by default and checks only tomorrow at 4 PM', () => {
    expect(migration).toContain(
      'weather_alerts_enabled boolean NOT NULL DEFAULT false',
    );
    expect(migration).toContain(
      'weather_sensitive boolean NOT NULL DEFAULT false',
    );
    expect(migration).toContain('AT TIME ZONE tenant.time_zone) = 16');
    expect(migration).toContain("job.status = 'scheduled'");
    expect(migration).not.toContain('UPDATE public.jobs');
  });
});
