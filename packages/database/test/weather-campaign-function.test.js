import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assessCampaignWeather } from '../../../supabase/functions/_shared/weather-campaign.js';

const checkFunction = readFileSync(
  new URL(
    '../../../supabase/functions/weather-campaign-check/index.js',
    import.meta.url,
  ),
  'utf8',
);
const sendFunction = readFileSync(
  new URL(
    '../../../supabase/functions/process-campaign-emails/index.js',
    import.meta.url,
  ),
  'utf8',
);

const now = new Date('2026-07-01T15:00:00Z');

function period(startTime, temperature, isDaytime, temperatureUnit = 'F') {
  return { isDaytime, startTime, temperature, temperatureUnit };
}

describe('assessCampaignWeather', () => {
  it('finds the hottest coming day above the threshold', () => {
    const result = assessCampaignWeather(
      [
        period('2026-07-01T12:00:00-05:00', 104, true), // today: ignored
        period('2026-07-02T06:00:00-05:00', 96, true),
        period('2026-07-03T06:00:00-05:00', 101, true),
        period('2026-07-03T18:00:00-05:00', 80, false),
        period('2026-07-09T06:00:00-05:00', 110, true), // too far ahead
      ],
      { coldF: 25, heatF: 95, now, timeZone: 'America/Chicago' },
    );
    expect(result).toEqual({
      cold: null,
      heat: { date: '2026-07-03', tempF: 101 },
    });
  });

  it('finds the coldest night below the threshold and converts Celsius', () => {
    const result = assessCampaignWeather(
      [
        period('2026-07-02T18:00:00-05:00', -6, false, 'C'), // 21°F
        period('2026-07-03T18:00:00-05:00', 24, false),
        period('2026-07-04T06:00:00-05:00', 20, true), // daytime: not a night low
      ],
      { coldF: 25, heatF: 95, now, timeZone: 'America/Chicago' },
    );
    expect(result.cold).toEqual({ date: '2026-07-02', tempF: 21 });
    expect(result.heat).toBeNull();
  });

  it('ignores bad input', () => {
    expect(
      assessCampaignWeather(null, {
        coldF: 25,
        heatF: 95,
        now,
        timeZone: 'America/Chicago',
      }),
    ).toEqual({ cold: null, heat: null });
    expect(
      assessCampaignWeather([period('nope', 'hot', true)], {
        coldF: 25,
        heatF: 95,
        now,
        timeZone: 'America/Chicago',
      }),
    ).toEqual({ cold: null, heat: null });
  });
});

describe('campaign edge functions', () => {
  it('only run for the service key', () => {
    expect(checkFunction).toContain('isAuthorized');
    expect(sendFunction).toContain('isAuthorized');
  });

  it('keep marketing mail behind the operator switch with a footer', () => {
    expect(sendFunction).toContain(
      "CREWFLOW_MARKETING_EMAIL_ENABLED') === 'true'",
    );
    expect(sendFunction).toContain('prepareMarketingEmail');
    expect(sendFunction).toContain('{{booking_link}}');
  });
});
