import fs from 'node:fs';
import path from 'node:path';
import { statements } from './db.js';

export function loadEnv(rootDir) {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsAt = trimmed.indexOf('=');
    if (equalsAt === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsAt).trim();
    let value = trimmed.slice(equalsAt + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

export function getConfig(rootDir) {
  const databasePath = process.env.DATABASE_PATH || './data/running.db';
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  const appMode = normalizeAppMode(process.env.APP_MODE);

  return {
    appName: 'Running Dashboard',
    appMode,
    rootDir,
    port,
    databasePath: path.resolve(rootDir, databasePath),
    sessionSecret: process.env.SESSION_SECRET || 'local-development-secret',
    strava: {
      clientId: process.env.STRAVA_CLIENT_ID || '',
      clientSecret: process.env.STRAVA_CLIENT_SECRET || '',
      redirectUri: process.env.STRAVA_REDIRECT_URI || '',
      defaultRedirectUri: `http://localhost:${port}/auth/strava/callback`,
      syncPages: Math.max(
        1,
        Number.parseInt(process.env.STRAVA_SYNC_PAGES || '3', 10)
      )
    },
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY || '',
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      priceId: process.env.STRIPE_PRICE_ID || '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
      successUrl: 'https://run.mychappell.com/success',
      cancelUrl: 'https://run.mychappell.com/cancel',
      portalReturnUrl:
        process.env.STRIPE_PORTAL_RETURN_URL ||
        'https://run.mychappell.com/billing'
    },
    browserSetupEnabled: process.env.ALLOW_BROWSER_SETUP !== 'false'
  };
}

function normalizeAppMode(value) {
  return value === 'demo' ? 'demo' : 'live';
}

export function isStravaConfigured(config) {
  return Boolean(
    config.strava.clientId &&
      config.strava.clientSecret &&
      config.strava.redirectUri
  );
}

export function getEffectiveConfig(config, db) {
  const settings = readSettings(db);

  return {
    ...config,
    strava: {
      ...config.strava,
      clientId: config.strava.clientId || settings.strava_client_id || '',
      clientSecret:
        config.strava.clientSecret || settings.strava_client_secret || '',
      redirectUri:
        config.strava.redirectUri ||
        settings.strava_redirect_uri ||
        config.strava.defaultRedirectUri
    }
  };
}

export function saveStravaBrowserSettings(db, values) {
  const save = statements.upsertSetting(db);
  db.exec('BEGIN');
  try {
    save.run('strava_client_id', values.clientId);
    save.run('strava_client_secret', values.clientSecret);
    save.run('strava_redirect_uri', values.redirectUri);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function browserSetupAllowed(config, req) {
  if (!config.browserSetupEnabled) {
    return false;
  }

  const host = hostName(req);
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function stravaConfigSource(config, db) {
  if (config.strava.clientId && config.strava.clientSecret) {
    return 'environment';
  }

  const settings = readSettings(db);
  if (settings.strava_client_id && settings.strava_client_secret) {
    return 'browser-setup';
  }

  return 'missing';
}

function readSettings(db) {
  return Object.fromEntries(
    statements.allSettings(db)
      .all()
      .map((setting) => [setting.key, setting.value])
  );
}

function hostName(req) {
  try {
    return new URL(`http://${req.headers.host || 'localhost'}`).hostname.toLowerCase();
  } catch {
    return (req.headers.host || '').split(':')[0].toLowerCase();
  }
}
