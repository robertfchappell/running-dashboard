import { statements } from './db.js';

const USER_AGENT = 'running-strava-dashboard/0.1 local-development';

export async function resolveActivityLocation(db, detail, streams) {
  const existing = formatExistingLocation(detail);
  if (existing) {
    return existing;
  }

  const point = firstLatLng(detail, streams);
  if (!point) {
    return '';
  }

  const cacheKey = `geocode:${point[0].toFixed(4)},${point[1].toFixed(4)}`;
  const cached = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(cacheKey);
  if (cached?.value) {
    return cached.value;
  }

  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(point[0]));
  url.searchParams.set('lon', String(point[1]));
  url.searchParams.set('zoom', '10');
  url.searchParams.set('addressdetails', '1');

  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json'
    }
  });
  if (!response.ok) {
    return '';
  }

  const json = await response.json();
  const address = json.address || {};
  const city =
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.municipality ||
    address.county ||
    '';
  const location = [city, address.state, address.country]
    .filter(Boolean)
    .join(', ');

  if (location) {
    statements.upsertSetting(db).run(cacheKey, location);
  }
  return location;
}

function formatExistingLocation(detail) {
  return [
    detail.location_city,
    detail.location_state,
    detail.location_country
  ]
    .filter(Boolean)
    .join(', ');
}

function firstLatLng(detail, streams) {
  if (Array.isArray(detail.start_latlng) && detail.start_latlng.length === 2) {
    return detail.start_latlng;
  }

  const firstStreamPoint = streams?.latlng?.data?.[0];
  if (Array.isArray(firstStreamPoint) && firstStreamPoint.length === 2) {
    return firstStreamPoint;
  }

  return null;
}
