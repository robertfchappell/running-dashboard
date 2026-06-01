import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

export function openDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(schema);
  migrateDatabase(db);
  return db;
}

const schema = `
CREATE TABLE IF NOT EXISTS athletes (
  id INTEGER PRIMARY KEY,
  username TEXT,
  firstname TEXT,
  lastname TEXT,
  profile TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  sex TEXT,
  timezone TEXT,
  is_premium INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_subscription_status TEXT,
  stripe_cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  stripe_current_period_end INTEGER,
  last_seen_at TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tokens (
  athlete_id INTEGER PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  scope TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  athlete_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,
  athlete_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  sport_type TEXT,
  distance_m REAL NOT NULL DEFAULT 0,
  moving_time_s INTEGER NOT NULL DEFAULT 0,
  elapsed_time_s INTEGER NOT NULL DEFAULT 0,
  total_elevation_gain_m REAL NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  start_date_local TEXT,
  timezone TEXT,
  average_speed_mps REAL,
  max_speed_mps REAL,
  average_heartrate REAL,
  max_heartrate REAL,
  average_cadence REAL,
  average_watts REAL,
  max_watts REAL,
  kilojoules REAL,
  device_watts INTEGER NOT NULL DEFAULT 0,
  kudos_count INTEGER NOT NULL DEFAULT 0,
  achievement_count INTEGER NOT NULL DEFAULT 0,
  is_run INTEGER NOT NULL DEFAULT 0,
  is_ride INTEGER NOT NULL DEFAULT 0,
  has_heartrate INTEGER NOT NULL DEFAULT 0,
  summary_polyline TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_activities_athlete_start
  ON activities (athlete_id, start_date DESC);

CREATE INDEX IF NOT EXISTS idx_activities_athlete_run_start
  ON activities (athlete_id, is_run, start_date DESC);

CREATE TABLE IF NOT EXISTS activity_details (
  activity_id INTEGER PRIMARY KEY,
  athlete_id INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  streams_json TEXT,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  activity_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  message TEXT,
  FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  page TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_events_athlete_type_created
  ON user_events (athlete_id, event_type, created_at DESC);
`;

function migrateDatabase(db) {
  const activityColumns = new Set(
    db.prepare('PRAGMA table_info(activities)').all().map((column) => column.name)
  );
  const athleteColumns = new Set(
    db.prepare('PRAGMA table_info(athletes)').all().map((column) => column.name)
  );
  const addActivityColumn = (name, definition) => {
    if (!activityColumns.has(name)) {
      db.exec(`ALTER TABLE activities ADD COLUMN ${name} ${definition}`);
    }
  };
  const addAthleteColumn = (name, definition) => {
    if (!athleteColumns.has(name)) {
      db.exec(`ALTER TABLE athletes ADD COLUMN ${name} ${definition}`);
    }
  };

  addAthleteColumn('is_premium', 'INTEGER NOT NULL DEFAULT 0');
  addAthleteColumn('stripe_customer_id', 'TEXT');
  addAthleteColumn('stripe_subscription_id', 'TEXT');
  addAthleteColumn('stripe_subscription_status', 'TEXT');
  addAthleteColumn('stripe_cancel_at_period_end', 'INTEGER NOT NULL DEFAULT 0');
  addAthleteColumn('stripe_current_period_end', 'INTEGER');
  addAthleteColumn('last_seen_at', 'TEXT');
  addAthleteColumn('timezone', 'TEXT');
  db.exec(`
    UPDATE athletes
    SET last_seen_at = COALESCE(last_seen_at, updated_at, created_at)
    WHERE last_seen_at IS NULL
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_athletes_last_seen
      ON athletes (last_seen_at DESC)
  `);
  db.exec(`
    UPDATE athletes
    SET stripe_current_period_end = NULL
    WHERE stripe_current_period_end IS NOT NULL
      AND stripe_current_period_end < 946684800
  `);

  addActivityColumn('average_watts', 'REAL');
  addActivityColumn('max_watts', 'REAL');
  addActivityColumn('kilojoules', 'REAL');
  addActivityColumn('device_watts', 'INTEGER NOT NULL DEFAULT 0');
  addActivityColumn('is_ride', 'INTEGER NOT NULL DEFAULT 0');
  addActivityColumn('has_heartrate', 'INTEGER NOT NULL DEFAULT 0');
  addActivityColumn('summary_polyline', 'TEXT');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_activities_athlete_ride_start
      ON activities (athlete_id, is_ride, start_date DESC)
  `);
  backfillActivityClassifications(db);
}

function backfillActivityClassifications(db) {
  const rows = db
    .prepare(
      `
        SELECT id, type, sport_type, raw_json
        FROM activities
        WHERE is_ride = 0
          OR has_heartrate = 0
          OR summary_polyline IS NULL
          OR summary_polyline = ''
      `
    )
    .all();
  if (rows.length === 0) {
    return;
  }

  const update = db.prepare(`
    UPDATE activities
    SET is_run = ?,
        is_ride = ?,
        has_heartrate = ?,
        summary_polyline = COALESCE(NULLIF(summary_polyline, ''), ?),
        average_watts = COALESCE(average_watts, ?),
        max_watts = COALESCE(max_watts, ?),
        kilojoules = COALESCE(kilojoules, ?),
        device_watts = COALESCE(device_watts, ?)
    WHERE id = ?
  `);

  db.exec('BEGIN');
  try {
    for (const row of rows) {
      let raw = {};
      try {
        raw = JSON.parse(row.raw_json || '{}');
      } catch {
        raw = {};
      }
      const sportType = raw.sport_type || row.sport_type || row.type || raw.type || '';
      update.run(
        RUN_SPORT_TYPES.has(sportType) ? 1 : 0,
        RIDE_SPORT_TYPES.has(sportType) ? 1 : 0,
        raw.has_heartrate || raw.average_heartrate ? 1 : 0,
        raw.map?.summary_polyline || '',
        nullableNumber(raw.average_watts),
        nullableNumber(raw.max_watts),
        nullableNumber(raw.kilojoules),
        raw.device_watts ? 1 : 0,
        row.id
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function trackEvent(db, athleteId, eventType, page = null) {
  const id = Number(athleteId);
  const type = String(eventType || '').trim();
  if (!Number.isFinite(id) || !type) {
    return;
  }
  statements.trackUserEvent(db).run(id, type, page || null);
}

export const statements = {
  upsertAthlete: (db) =>
    db.prepare(`
      INSERT INTO athletes (
        id, username, firstname, lastname, profile, city, state, country, sex, raw_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        firstname = excluded.firstname,
        lastname = excluded.lastname,
        profile = excluded.profile,
        city = excluded.city,
        state = excluded.state,
        country = excluded.country,
        sex = excluded.sex,
        raw_json = excluded.raw_json,
        updated_at = CURRENT_TIMESTAMP
    `),
  upsertToken: (db) =>
    db.prepare(`
      INSERT INTO tokens (athlete_id, access_token, refresh_token, expires_at, scope, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(athlete_id) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        scope = COALESCE(excluded.scope, tokens.scope),
        updated_at = CURRENT_TIMESTAMP
    `),
  createSession: (db) =>
    db.prepare(`
      INSERT INTO sessions (id, athlete_id, expires_at)
      VALUES (?, ?, ?)
    `),
  findSession: (db) =>
    db.prepare(`
      SELECT sessions.*,
             athletes.firstname,
             athletes.lastname,
             athletes.profile,
             athletes.timezone,
             athletes.is_premium,
             athletes.stripe_customer_id,
             athletes.stripe_subscription_id,
             athletes.stripe_subscription_status,
             athletes.stripe_cancel_at_period_end,
             athletes.stripe_current_period_end
      FROM sessions
      JOIN athletes ON athletes.id = sessions.athlete_id
      WHERE sessions.id = ?
    `),
  touchSession: (db) =>
    db.prepare(`
      UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?
    `),
  updateAthleteLastSeen: (db) =>
    db.prepare(`
      UPDATE athletes
      SET last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `),
  updateAthleteTimezone: (db) =>
    db.prepare(`
      UPDATE athletes
      SET timezone = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `),
  trackUserEvent: (db) =>
    db.prepare(`
      INSERT INTO user_events (athlete_id, event_type, page)
      VALUES (?, ?, ?)
    `),
  deleteSession: (db) =>
    db.prepare(`
      DELETE FROM sessions WHERE id = ?
    `),
  deleteExpiredSessions: (db) =>
    db.prepare(`
      DELETE FROM sessions WHERE expires_at < ?
    `),
  insertOauthState: (db) =>
    db.prepare(`
      INSERT INTO oauth_states (state, expires_at) VALUES (?, ?)
    `),
  consumeOauthState: (db) =>
    db.prepare(`
      DELETE FROM oauth_states WHERE state = ? AND expires_at >= ?
    `),
  deleteExpiredOauthStates: (db) =>
    db.prepare(`
      DELETE FROM oauth_states WHERE expires_at < ?
    `),
  allSettings: (db) =>
    db.prepare(`
      SELECT key, value FROM app_settings
    `),
  upsertSetting: (db) =>
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `),
  findToken: (db) =>
    db.prepare(`
      SELECT * FROM tokens WHERE athlete_id = ?
    `),
  dueAutoSyncAthletes: (db) =>
    db.prepare(`
      SELECT tokens.athlete_id,
             athletes.firstname,
             athletes.lastname,
             latest.last_started_at
      FROM tokens
      JOIN athletes ON athletes.id = tokens.athlete_id
      LEFT JOIN (
        SELECT athlete_id, MAX(started_at) AS last_started_at
        FROM sync_runs
        GROUP BY athlete_id
      ) latest ON latest.athlete_id = tokens.athlete_id
      WHERE latest.last_started_at IS NULL
         OR CAST(strftime('%s', latest.last_started_at) AS INTEGER) <= ?
      ORDER BY COALESCE(latest.last_started_at, '1970-01-01 00:00:00') ASC
      LIMIT ?
    `),
  upsertActivity: (db) =>
    db.prepare(`
      INSERT INTO activities (
        id,
        athlete_id,
        name,
        type,
        sport_type,
        distance_m,
        moving_time_s,
        elapsed_time_s,
        total_elevation_gain_m,
        start_date,
        start_date_local,
        timezone,
        average_speed_mps,
        max_speed_mps,
        average_heartrate,
        max_heartrate,
        average_cadence,
        average_watts,
        max_watts,
        kilojoules,
        device_watts,
        kudos_count,
        achievement_count,
        is_run,
        is_ride,
        has_heartrate,
        summary_polyline,
        raw_json,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        athlete_id = excluded.athlete_id,
        name = excluded.name,
        type = excluded.type,
        sport_type = excluded.sport_type,
        distance_m = excluded.distance_m,
        moving_time_s = excluded.moving_time_s,
        elapsed_time_s = excluded.elapsed_time_s,
        total_elevation_gain_m = excluded.total_elevation_gain_m,
        start_date = excluded.start_date,
        start_date_local = excluded.start_date_local,
        timezone = excluded.timezone,
        average_speed_mps = excluded.average_speed_mps,
        max_speed_mps = excluded.max_speed_mps,
        average_heartrate = excluded.average_heartrate,
        max_heartrate = excluded.max_heartrate,
        average_cadence = excluded.average_cadence,
        average_watts = excluded.average_watts,
        max_watts = excluded.max_watts,
        kilojoules = excluded.kilojoules,
        device_watts = excluded.device_watts,
        kudos_count = excluded.kudos_count,
        achievement_count = excluded.achievement_count,
        is_run = excluded.is_run,
        is_ride = excluded.is_ride,
        has_heartrate = excluded.has_heartrate,
        summary_polyline = excluded.summary_polyline,
        raw_json = excluded.raw_json,
        updated_at = CURRENT_TIMESTAMP
    `),
  activityByAthlete: (db) =>
    db.prepare(`
      SELECT *
      FROM activities
      WHERE athlete_id = ? AND id = ?
    `),
  upsertActivityDetail: (db) =>
    db.prepare(`
      INSERT INTO activity_details (
        activity_id,
        athlete_id,
        raw_json,
        streams_json,
        fetched_at,
        updated_at
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(activity_id) DO UPDATE SET
        raw_json = excluded.raw_json,
        streams_json = excluded.streams_json,
        fetched_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `),
  activityDetail: (db) =>
    db.prepare(`
      SELECT *
      FROM activity_details
      WHERE athlete_id = ? AND activity_id = ?
    `),
  createSyncRun: (db) =>
    db.prepare(`
      INSERT INTO sync_runs (athlete_id) VALUES (?)
    `),
  finishSyncRun: (db) =>
    db.prepare(`
      UPDATE sync_runs
      SET completed_at = CURRENT_TIMESTAMP,
          activity_count = ?,
          status = ?,
          message = ?
      WHERE id = ?
    `),
  lastSyncRun: (db) =>
    db.prepare(`
      SELECT *
      FROM sync_runs
      WHERE athlete_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `),
  recentRuns: (db) =>
    db.prepare(`
      SELECT *
      FROM activities
      WHERE athlete_id = ? AND is_run = 1
      ORDER BY start_date DESC
      LIMIT ?
    `),
  recentSportActivities: (db) =>
    db.prepare(`
      SELECT *
      FROM activities
      WHERE athlete_id = ?
        AND (
          (? = 'run' AND is_run = 1) OR
          (? = 'ride' AND is_ride = 1)
        )
      ORDER BY start_date DESC
      LIMIT ?
    `),
  allRuns: (db) =>
    db.prepare(`
      SELECT *
      FROM activities
      WHERE athlete_id = ? AND is_run = 1
      ORDER BY start_date ASC
    `),
  allSportActivities: (db) =>
    db.prepare(`
      SELECT *
      FROM activities
      WHERE athlete_id = ?
        AND (
          (? = 'run' AND is_run = 1) OR
          (? = 'ride' AND is_ride = 1)
        )
      ORDER BY start_date ASC
    `),
  athleteById: (db) =>
    db.prepare(`
      SELECT * FROM athletes WHERE id = ?
    `),
  usageSummary: (db) =>
    db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM athletes) AS totalUsers,
        (SELECT COUNT(*) FROM athletes WHERE last_seen_at >= datetime('now', 'start of day')) AS activeToday,
        (SELECT COUNT(*) FROM athletes WHERE last_seen_at >= datetime('now', '-7 days')) AS activeThisWeek,
        (SELECT COUNT(*) FROM athletes WHERE last_seen_at >= datetime('now', '-30 days')) AS activeThisMonth
    `),
  usageUsers: (db) =>
    db.prepare(`
      SELECT
        athletes.id AS athleteId,
        COALESCE(
          NULLIF(TRIM(COALESCE(athletes.firstname, '') || ' ' || COALESCE(athletes.lastname, '')), ''),
          athletes.username,
          'Runner'
        ) AS name,
        athletes.last_seen_at AS lastSeen,
        athletes.timezone AS timezone,
        COALESCE(SUM(CASE WHEN user_events.event_type = 'dashboard_viewed' THEN 1 ELSE 0 END), 0) AS dashboardViews,
        COALESCE(SUM(CASE WHEN user_events.event_type = 'focus_viewed' THEN 1 ELSE 0 END), 0) AS focusViews,
        COALESCE(SUM(CASE WHEN user_events.event_type = 'activity_detail_viewed' THEN 1 ELSE 0 END), 0) AS activityViews,
        COALESCE(SUM(CASE WHEN user_events.event_type = 'login_completed' THEN 1 ELSE 0 END), 0) AS loginCount,
        COALESCE(SUM(CASE WHEN user_events.event_type = 'manual_sync_started' THEN 1 ELSE 0 END), 0) AS syncCount
      FROM athletes
      LEFT JOIN user_events ON user_events.athlete_id = athletes.id
      GROUP BY athletes.id
      ORDER BY athletes.last_seen_at IS NULL ASC,
               athletes.last_seen_at DESC,
               athletes.created_at DESC
    `),
  updateAthleteBilling: (db) =>
    db.prepare(`
      UPDATE athletes
      SET is_premium = ?,
          stripe_customer_id = ?,
          stripe_subscription_id = ?,
          stripe_subscription_status = ?,
          stripe_cancel_at_period_end = ?,
          stripe_current_period_end = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `),
  updateAthleteBillingBySubscription: (db) =>
    db.prepare(`
      UPDATE athletes
      SET is_premium = ?,
          stripe_customer_id = COALESCE(?, stripe_customer_id),
          stripe_subscription_status = ?,
          stripe_cancel_at_period_end = ?,
          stripe_current_period_end = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE stripe_subscription_id = ?
    `)
};
