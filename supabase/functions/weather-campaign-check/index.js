/* global Deno, Response, TextEncoder, crypto, console, fetch, AbortSignal */

// Daily weather campaign check. For every business that turned weather
// campaigns on, it locates the business address once (US Census), reads the
// National Weather Service 12-hour forecast, and asks the database to draft a
// heat or freeze campaign when the coming days cross the business's
// thresholds. The database decides the audience, cooldown, and auto-send.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { assessCampaignWeather } from '../_shared/weather-campaign.js';
import {
  WEATHER_USER_AGENT,
  censusGeocodeUrl,
  nwsPointUrl,
  parseCensusCoordinates,
} from '../_shared/weather-risk.js';

const REQUEST_TIMEOUT_MS = 10_000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function configuredSecretKeys() {
  const keys = [];
  const encodedKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (encodedKeys) {
    try {
      for (const value of Object.values(JSON.parse(encodedKeys))) {
        if (typeof value === 'string' && value.length > 0) keys.push(value);
      }
    } catch {
      return [];
    }
  }
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacyKey) keys.push(legacyKey);
  return [...new Set(keys)];
}

async function digest(value) {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
}

async function isAuthorized(suppliedKey, secretKeys) {
  if (!suppliedKey || secretKeys.length === 0) return false;
  const supplied = await digest(suppliedKey);
  for (const secretKey of secretKeys) {
    const expected = await digest(secretKey);
    let difference = supplied.length ^ expected.length;
    for (let index = 0; index < supplied.length; index += 1) {
      difference |= supplied[index] ^ expected[index];
    }
    if (difference === 0) return true;
  }
  return false;
}

async function getJson(url, accept) {
  const response = await fetch(url, {
    headers: { accept, 'user-agent': WEATHER_USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function locate(admin, tenant) {
  if (tenant.latitude !== null && tenant.longitude !== null) {
    return {
      latitude: Number(tenant.latitude),
      longitude: Number(tenant.longitude),
    };
  }
  const located = parseCensusCoordinates(
    await getJson(
      censusGeocodeUrl({
        city: tenant.city,
        state: tenant.state_code,
        street: tenant.street_address,
        zip: tenant.postal_code,
      }),
      'application/json',
    ),
  );
  if (located) {
    await admin.rpc('record_weather_campaign_location', {
      target_latitude: located.latitude,
      target_longitude: located.longitude,
      target_tenant_id: tenant.tenant_id,
    });
  }
  return located;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const secretKeys = configuredSecretKeys();
  if (!(await isAuthorized(request.headers.get('apikey'), secretKeys))) {
    return json({ error: 'unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) return json({ error: 'not_configured' }, 503);
  const admin = createClient(supabaseUrl, secretKeys[0], {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: tenants, error } = await admin.rpc(
    'list_weather_campaign_tenants',
  );
  if (error) {
    console.error(
      JSON.stringify({ event: 'campaign_list_failed', code: error.code }),
    );
    return json({ error: 'list_failed' }, 500);
  }

  const counts = { checked: 0, drafted: 0, failed: 0 };
  for (const tenant of tenants ?? []) {
    try {
      const coordinates = await locate(admin, tenant);
      if (!coordinates) {
        counts.failed += 1;
        continue;
      }
      const point = await getJson(
        nwsPointUrl(coordinates.latitude, coordinates.longitude),
        'application/geo+json',
      );
      const forecastUrl = point?.properties?.forecast;
      if (
        typeof forecastUrl !== 'string' ||
        !forecastUrl.startsWith('https://api.weather.gov/')
      ) {
        counts.failed += 1;
        continue;
      }
      const forecast = await getJson(forecastUrl, 'application/geo+json');
      const assessment = assessCampaignWeather(
        forecast?.properties?.periods ?? [],
        {
          coldF: tenant.cold_threshold_f,
          heatF: tenant.heat_threshold_f,
          timeZone: tenant.time_zone,
        },
      );
      counts.checked += 1;

      for (const [kind, hit] of [
        ['heat', assessment.heat],
        ['cold', assessment.cold],
      ]) {
        if (!hit) continue;
        const { data: campaignId, error: draftError } = await admin.rpc(
          'record_weather_campaign_forecast',
          {
            target_forecast_date: hit.date,
            target_forecast_temp_f: hit.tempF,
            target_kind: kind,
            target_tenant_id: tenant.tenant_id,
          },
        );
        if (draftError) {
          counts.failed += 1;
          console.error(
            JSON.stringify({
              event: 'campaign_draft_failed',
              code: draftError.code,
            }),
          );
        } else if (campaignId) {
          counts.drafted += 1;
        }
      }
    } catch {
      counts.failed += 1;
    }
  }

  console.log(JSON.stringify({ event: 'weather_campaign_check', ...counts }));
  return json(counts);
});
