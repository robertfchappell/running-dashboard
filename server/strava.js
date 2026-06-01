import { statements } from './db.js';

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const RUN_SPORT_TYPES = new Set([
  'Run',
  'TrailRun',
  'VirtualRun',
  'Wheelchair'
]);
const RIDE_SPORT_TYPES = new Set([
  'Ride',
  'MountainBikeRide',
  'GravelRide',
  'VirtualRide',
  'EBikeRide',
  'EMountainBikeRide',
  'Handcycle',
  'Velomobile'
]);
const DETAIL_CACHE_TTL_SECONDS = 60 * 60 * 12;

export function buildAuthorizationUrl(config, state) {
  const url = new URL('https://www.strava.com/oauth/authorize');
  url.searchParams.set('client_id', config.strava.clientId);
  url.searchParams.set('redirect_uri', config.strava.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('approval_prompt', 'auto');
  url.searchParams.set('scope', 'read,activity:read_all,profile:read_all');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCodeForToken(config, code) {
  return postTokenRequest({
    client_id: config.strava.clientId,
    client_secret: config.strava.clientSecret,
    code,
    grant_type: 'authorization_code'
  });
}

export async function refreshAccessToken(config, refreshToken) {
  return postTokenRequest({
    client_id: config.strava.clientId,
    client_secret: config.strava.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });
}

async function postTokenRequest(params) {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params)
  });

  const json = await parseStravaResponse(response);
  if (!response.ok) {
    throw new Error(
      json?.message || json?.error || `Strava token request failed: ${response.status}`
    );
  }
  return json;
}

export function saveAthleteAndToken(db, tokenResponse, scope) {
  const athlete = tokenResponse.athlete;
  if (!athlete?.id) {
    throw new Error('Strava did not return an athlete id.');
  }

  statements.upsertAthlete(db).run(
    athlete.id,
    athlete.username || '',
    athlete.firstname || '',
    athlete.lastname || '',
    athlete.profile || '',
    athlete.city || '',
    athlete.state || '',
    athlete.country || '',
    athlete.sex || '',
    JSON.stringify(athlete)
  );

  statements.upsertToken(db).run(
    athlete.id,
    tokenResponse.access_token,
    tokenResponse.refresh_token,
    tokenResponse.expires_at,
    scope || ''
  );

  return athlete.id;
}

export async function getValidAccessToken(db, config, athleteId) {
  const token = statements.findToken(db).get(athleteId);
  if (!token) {
    throw new Error('No Strava token is saved for this athlete.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (token.expires_at > now + 300) {
    return token.access_token;
  }

  const refreshed = await refreshAccessToken(config, token.refresh_token);
  statements.upsertToken(db).run(
    athleteId,
    refreshed.access_token,
    refreshed.refresh_token,
    refreshed.expires_at,
    token.scope || ''
  );
  return refreshed.access_token;
}

async function refreshSavedAccessToken(db, config, token) {
  const refreshed = await refreshAccessToken(config, token.refresh_token);
  statements.upsertToken(db).run(
    token.athlete_id,
    refreshed.access_token,
    refreshed.refresh_token,
    refreshed.expires_at,
    token.scope || ''
  );
  return refreshed.access_token;
}

export async function syncStravaActivities(db, config, athleteId) {
  const syncRun = statements.createSyncRun(db).run(athleteId);
  const syncRunId = syncRun.lastInsertRowid;
  let activityCount = 0;

  try {
    let accessToken = await getValidAccessToken(db, config, athleteId);

    for (let page = 1; page <= config.strava.syncPages; page += 1) {
      let activities;
      try {
        activities = await fetchAthleteActivities(accessToken, page, 100);
      } catch (error) {
        if (!isInvalidAccessTokenError(error)) {
          throw error;
        }
        const token = statements.findToken(db).get(athleteId);
        if (!token) {
          throw error;
        }
        accessToken = await refreshSavedAccessToken(db, config, token);
        activities = await fetchAthleteActivities(accessToken, page, 100);
      }
      if (activities.length === 0) {
        break;
      }

      const upsert = statements.upsertActivity(db);
      db.exec('BEGIN');
      try {
        for (const activity of activities) {
          upsert.run(
            activity.id,
            athleteId,
            activity.name || 'Untitled activity',
            activity.type || '',
            activity.sport_type || activity.type || '',
            numberOrZero(activity.distance),
            integerOrZero(activity.moving_time),
            integerOrZero(activity.elapsed_time),
            numberOrZero(activity.total_elevation_gain),
            activity.start_date || '',
            activity.start_date_local || activity.start_date || '',
            activity.timezone || '',
            nullableNumber(activity.average_speed),
            nullableNumber(activity.max_speed),
            nullableNumber(activity.average_heartrate),
            nullableNumber(activity.max_heartrate),
            nullableNumber(activity.average_cadence),
            nullableNumber(activity.average_watts),
            nullableNumber(activity.max_watts),
            nullableNumber(activity.kilojoules),
            activity.device_watts ? 1 : 0,
            integerOrZero(activity.kudos_count),
            integerOrZero(activity.achievement_count),
            isRunActivity(activity) ? 1 : 0,
            isRideActivity(activity) ? 1 : 0,
            activity.has_heartrate || activity.average_heartrate ? 1 : 0,
            activity.map?.summary_polyline || '',
            JSON.stringify(activity)
          );
          activityCount += 1;
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      if (activities.length < 100) {
        break;
      }
    }

    statements.finishSyncRun(db).run(
      activityCount,
      'complete',
      `Synced ${activityCount} activities from Strava.`,
      syncRunId
    );
    return {
      activityCount,
      status: 'complete'
    };
  } catch (error) {
    statements.finishSyncRun(db).run(
      activityCount,
      'failed',
      error.message,
      syncRunId
    );
    throw error;
  }
}

export async function loadStravaActivityDetail(db, config, athleteId, activityId) {
  const activity = statements.activityByAthlete(db).get(athleteId, activityId);
  if (!activity) {
    const error = new Error('Activity was not found in your saved Strava data.');
    error.statusCode = 404;
    throw error;
  }

  const cached = statements.activityDetail(db).get(athleteId, activityId);
  if (isFreshDetail(cached)) {
    return {
      activity,
      detail: JSON.parse(cached.raw_json),
      streams: cached.streams_json ? JSON.parse(cached.streams_json) : null,
      source: 'cache'
    };
  }

  try {
    const accessToken = await getValidAccessToken(db, config, athleteId);
    const detail = await fetchActivityDetail(accessToken, activityId);
    let streams = {};
    let streamWarning = null;
    try {
      streams = await fetchActivityStreams(accessToken, activityId);
    } catch (error) {
      streamWarning = error.message;
    }

    statements.upsertActivityDetail(db).run(
      activityId,
      athleteId,
      JSON.stringify(detail),
      JSON.stringify(streams || {})
    );

    return {
      activity,
      detail,
      streams,
      source: 'strava',
      warning: streamWarning
    };
  } catch (error) {
    if (cached) {
      return {
        activity,
        detail: JSON.parse(cached.raw_json),
        streams: cached.streams_json ? JSON.parse(cached.streams_json) : null,
        source: 'stale-cache',
        warning: error.message
      };
    }
    throw error;
  }
}

async function fetchAthleteActivities(accessToken, page, perPage) {
  const url = new URL(`${STRAVA_API_BASE}/athlete/activities`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(perPage));

  const json = await fetchStravaJson(url, accessToken, 'Strava activities');
  return Array.isArray(json) ? json : [];
}

async function fetchActivityDetail(accessToken, activityId) {
  const url = new URL(`${STRAVA_API_BASE}/activities/${activityId}`);
  url.searchParams.set('include_all_efforts', 'false');

  return (await fetchStravaJson(url, accessToken, 'Strava activity detail')) || {};
}

async function fetchActivityStreams(accessToken, activityId) {
  const url = new URL(`${STRAVA_API_BASE}/activities/${activityId}/streams`);
  url.searchParams.set(
    'keys',
    [
      'time',
      'distance',
      'latlng',
      'altitude',
      'velocity_smooth',
      'heartrate',
      'cadence',
      'watts',
      'temp',
      'moving',
      'grade_smooth'
    ].join(',')
  );
  url.searchParams.set('key_by_type', 'true');

  return (await fetchStravaJson(url, accessToken, 'Strava activity streams')) || {};
}

async function fetchStravaJson(url, accessToken, label, retries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const json = await parseStravaResponse(response);
    if (response.ok) {
      return json;
    }

    const error = stravaApiError(label, response.status, json);
    lastError = error;
    if (isTransientStravaError(error) && attempt < retries) {
      await delay(600 * 2 ** attempt);
      continue;
    }
    throw error;
  }
  throw lastError;
}

function stravaApiError(label, statusCode, body) {
  const message =
    statusCode >= 500
      ? `${label} is currently returning ${statusCode} from Strava. This is usually temporary; try syncing again in a few minutes.`
      : `${label} request failed with status ${statusCode}: ${JSON.stringify(body)}`;
  const error = new Error(message);
  error.statusCode = statusCode;
  error.body = body;
  return error;
}

function isTransientStravaError(error) {
  return error.statusCode === 500 || error.statusCode === 502 || error.statusCode === 503 || error.statusCode === 504;
}

function isInvalidAccessTokenError(error) {
  return (
    error.statusCode === 401 &&
    Array.isArray(error.body?.errors) &&
    error.body.errors.some(
      (item) => item.field === 'access_token' && item.code === 'invalid'
    )
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseStravaResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return {
      message: text
    };
  }
}

function isRunActivity(activity) {
  return RUN_SPORT_TYPES.has(activity.sport_type || activity.type);
}

function isRideActivity(activity) {
  return RIDE_SPORT_TYPES.has(activity.sport_type || activity.type);
}

function isFreshDetail(cached) {
  if (!cached?.fetched_at) {
    return false;
  }

  const fetchedAt = new Date(`${cached.fetched_at}Z`).getTime();
  if (!Number.isFinite(fetchedAt)) {
    return false;
  }
  return Date.now() - fetchedAt < DETAIL_CACHE_TTL_SECONDS * 1000;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function integerOrZero(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
