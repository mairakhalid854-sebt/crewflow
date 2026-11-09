/* global Deno, Response, TextEncoder, crypto, console, fetch, AbortSignal */

// 4 PM Weather Risk Alert worker. Called hourly by pg_cron; the database
// only returns jobs for workspaces where it is 4 PM local time. For each
// job it geocodes the customer address once (US Census), reads the NWS
// hourly forecast for the job window, records the risk, then queues one
// owner email per workspace when anything is at risk. It never changes a
// job.

import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  WEATHER_USER_AGENT,
  assessWeatherRisk,
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

async function geocode(job) {
  if (!job.street_address || !job.postal_code) return null;
  const body = await getJson(
    censusGeocodeUrl({
      city: job.city,
      state: job.state_code,
      street: job.street_address,
      zip: job.postal_code,
    }),
    'application/json',
  );
  return parseCensusCoordinates(body);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST')
    return json({ error: 'method_not_allowed' }, 405);

  const secretKeys = configuredSecretKeys();
  if (!(await isAuthorized(request.headers.get('apikey'), secretKeys))) {
    return json({ error: 'unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) return json({ error: 'not_configured' }, 503);
  const admin = createClient(supabaseUrl, secretKeys[0], {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: jobs, error } = await admin.rpc('list_weather_check_jobs', {
    target_now: new Date().toISOString(),
  });
  if (error) {
    console.error(
      JSON.stringify({ event: 'weather_list_failed', code: error.code }),
    );
    return json({ error: 'list_failed' }, 500);
  }

  const forecastByPoint = new Map();
  const coordinatesByCustomer = new Map();
  const tenants = new Map();
  let checked = 0;
  let failed = 0;

  for (const job of jobs ?? []) {
    tenants.set(job.tenant_id, job.forecast_date);
    try {
      let coordinates = coordinatesByCustomer.get(job.customer_id);
      if (coordinates === undefined) {
        if (job.geocode_status === 'matched') {
          coordinates = {
            latitude: Number(job.latitude),
            longitude: Number(job.longitude),
          };
        } else if (job.geocode_status === 'no_match') {
          coordinates = null;
        } else {
          coordinates = await geocode(job);
          await admin.rpc('record_customer_geocode', {
            target_address_hash: job.address_hash,
            target_customer_id: job.customer_id,
            target_latitude: coordinates?.latitude ?? null,
            target_longitude: coordinates?.longitude ?? null,
            target_status: coordinates ? 'matched' : 'no_match',
            target_tenant_id: job.tenant_id,
          });
        }
        coordinatesByCustomer.set(job.customer_id, coordinates);
      }

      let assessment;
      if (!coordinates) {
        assessment = {
          details: { reason: 'address_not_found' },
          level: 'unavailable',
          summary: 'Address could not be located for a forecast.',
        };
      } else {
        const pointUrl = nwsPointUrl(
          coordinates.latitude,
          coordinates.longitude,
        );
        let periods = forecastByPoint.get(pointUrl);
        if (!periods) {
          const point = await getJson(pointUrl, 'application/geo+json');
          const hourlyUrl = point?.properties?.forecastHourly;
          if (
            typeof hourlyUrl !== 'string' ||
            !hourlyUrl.startsWith('https://api.weather.gov/')
          ) {
            throw new Error('missing_hourly_forecast');
          }
          const hourly = await getJson(hourlyUrl, 'application/geo+json');
          periods = hourly?.properties?.periods ?? [];
          forecastByPoint.set(pointUrl, periods);
        }
        assessment = assessWeatherRisk(
          periods,
          job.scheduled_start_at,
          job.scheduled_end_at,
        );
      }

      await admin.rpc('record_job_weather_risk', {
        target_details: assessment.details,
        target_forecast_date: job.forecast_date,
        target_job_id: job.job_id,
        target_risk_level: assessment.level,
        target_summary: assessment.summary,
        target_tenant_id: job.tenant_id,
      });
      checked += 1;
    } catch (caught) {
      failed += 1;
      console.error(
        JSON.stringify({
          event: 'weather_job_failed',
          job_id: job.job_id,
          message:
            caught instanceof Error ? caught.message.slice(0, 120) : 'unknown',
        }),
      );
    }
  }

  let queued = 0;
  for (const [tenantId, forecastDate] of tenants) {
    const { data, error: queueError } = await admin.rpc(
      'queue_weather_risk_alert',
      {
        target_forecast_date: forecastDate,
        target_tenant_id: tenantId,
      },
    );
    if (queueError) {
      console.error(
        JSON.stringify({
          event: 'weather_alert_queue_failed',
          code: queueError.code,
        }),
      );
    } else {
      queued += Number(data ?? 0);
    }
  }

  return json({ checked, failed, queued });
});
