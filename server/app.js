import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import {
  browserSetupAllowed,
  getEffectiveConfig,
  getConfig,
  isStravaConfigured,
  loadEnv,
  saveStravaBrowserSettings,
  stravaConfigSource
} from './config.js';
import { openDatabase, statements } from './db.js';
import {
  clearOauthStateCookie,
  cleanupExpiredAuthData,
  consumeOauthState,
  createOauthState,
  createSession,
  destroySession,
  requireSession
} from './session.js';
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  loadStravaActivityDetail,
  saveAthleteAndToken,
  syncStravaActivities
} from './strava.js';
import {
  notFound,
  readRequestBody,
  readRequestBuffer,
  redirect,
  sendError,
  sendJson,
  serveStatic
} from './http.js';
import { buildDashboard } from './metrics.js';
import { buildActivityDetail } from './metrics.js';
import { resolveActivityLocation } from './geocode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
loadEnv(rootDir);

const config = getConfig(rootDir);
const db = openDatabase(config.databasePath);
const publicDir = path.join(rootDir, 'public');
let stripeClient = null;

cleanupExpiredAuthData(db);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      await routeApi(req, res, url);
      return;
    }

    if (
      url.pathname === '/focus' ||
      url.pathname === '/billing' ||
      url.pathname === '/success' ||
      url.pathname === '/cancel' ||
      url.pathname === '/demo' ||
      url.pathname === '/demo/' ||
      url.pathname === '/demo/focus' ||
      url.pathname === '/demo/focus/'
    ) {
      req.url = '/';
      serveStatic(req, res, publicDir);
      return;
    }

    if (!serveStatic(req, res, publicDir)) {
      notFound(res);
    }
  } catch (error) {
    console.error(error);
    sendError(res, 500, 'Something went wrong.', error.message);
  }
});

server.listen(config.port, () => {
  console.log(
    `${config.appName} running at http://localhost:${config.port}`
  );
});

async function routeApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/config/status') {
    const effectiveConfig = getEffectiveConfig(config, db);
    sendJson(res, 200, {
      configured: isStravaConfigured(effectiveConfig),
      browserSetupAllowed: browserSetupAllowed(config, req),
      credentialsSource: stravaConfigSource(config, db),
      redirectUri: effectiveConfig.strava.redirectUri,
      databasePath: config.databasePath,
      appMode: config.appMode,
      stripePublishableKey: config.stripe.publishableKey
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/setup/strava') {
    if (!browserSetupAllowed(config, req)) {
      sendError(res, 403, 'Browser setup is only available from localhost.');
      return;
    }

    const body = await readJsonBody(req);
    let values;
    try {
      values = validateStravaSetup(body, config);
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }

    saveStravaBrowserSettings(db, values);
    const effectiveConfig = getEffectiveConfig(config, db);

    sendJson(res, 200, {
      ok: true,
      configured: isStravaConfigured(effectiveConfig),
      redirectUri: effectiveConfig.strava.redirectUri
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/auth/strava') {
    const effectiveConfig = getEffectiveConfig(config, db);
    if (!isStravaConfigured(effectiveConfig)) {
      redirect(res, '/?setup=missing-strava-config');
      return;
    }

    const oauthState = createOauthState(db);
    redirect(res, buildAuthorizationUrl(effectiveConfig, oauthState.state), {
      'set-cookie': oauthState.header
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/auth/strava/callback') {
    await handleStravaCallback(req, res, url);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/auth/logout') {
    const sessionCookie = destroySession(db, req);
    sendJson(
      res,
      200,
      {
        ok: true
      },
      {
        'set-cookie': sessionCookie
      }
    );
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    const session = requireSession(db, req);
    if (!session) {
      sendJson(res, 200, {
        authenticated: false
      });
      return;
    }

    sendJson(res, 200, {
      authenticated: true,
      athlete: {
        id: session.athlete_id,
        name:
          [session.firstname, session.lastname].filter(Boolean).join(' ') ||
          'Runner',
        profile: session.profile,
        isPremium: Boolean(session.is_premium)
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/checkout') {
    const session = requireSession(db, req);
    if (!session) {
      sendError(res, 401, 'Not authenticated.');
      return;
    }

    if (!config.stripe.secretKey || !config.stripe.priceId) {
      sendError(res, 500, 'Stripe checkout is not configured.');
      return;
    }

    try {
      const checkoutOptions = {
        mode: 'subscription',
        line_items: [
          {
            price: config.stripe.priceId,
            quantity: 1
          }
        ],
        success_url: config.stripe.successUrl,
        cancel_url: config.stripe.cancelUrl,
        metadata: {
          athlete_id: String(session.athlete_id)
        },
        subscription_data: {
          metadata: {
            athlete_id: String(session.athlete_id)
          }
        }
      };
      if (session.stripe_customer_id) {
        checkoutOptions.customer = session.stripe_customer_id;
      }

      const checkout = await getStripe().checkout.sessions.create(checkoutOptions);

      sendJson(res, 200, {
        url: checkout.url
      });
    } catch (error) {
      sendError(res, 500, 'Could not create Stripe checkout session.', error.message);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/webhook') {
    await handleStripeWebhook(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/dashboard') {
    const session = requireSession(db, req);
    if (!session) {
      sendError(res, 401, 'Not authenticated.');
      return;
    }

    sendJson(res, 200, decorateDashboard(buildDashboard(db, session.athlete_id), session));
    return;
  }

  const activityMatch = url.pathname.match(/^\/api\/activities\/(\d+)$/);
  if (req.method === 'GET' && activityMatch) {
    const session = requireSession(db, req);
    if (!session) {
      sendError(res, 401, 'Not authenticated.');
      return;
    }

    try {
      const result = await loadStravaActivityDetail(
        db,
        getEffectiveConfig(config, db),
        session.athlete_id,
        Number(activityMatch[1])
      );
      const location = await resolveActivityLocation(
        db,
        result.detail,
        result.streams
      );
      if (location) {
        result.detail.local_resolved_location = location;
      }
      sendJson(
        res,
        200,
        buildActivityDetail(
          result.activity,
          result.detail,
          result.streams,
          result.source,
          result.warning
        )
      );
    } catch (error) {
      sendError(res, error.statusCode || 500, error.message);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/sync') {
    const session = requireSession(db, req);
    if (!session) {
      sendError(res, 401, 'Not authenticated.');
      return;
    }

    const result = await syncStravaActivities(
      db,
      getEffectiveConfig(config, db),
      session.athlete_id
    );
    sendJson(res, 200, result);
    return;
  }

  notFound(res);
}

async function handleStravaCallback(req, res, url) {
  const error = url.searchParams.get('error');
  if (error) {
    redirect(res, `/?auth_error=${encodeURIComponent(error)}`, {
      'set-cookie': clearOauthStateCookie()
    });
    return;
  }

  const code = url.searchParams.get('code');
  const scope = url.searchParams.get('scope') || '';
  const state = url.searchParams.get('state');

  if (!code) {
    redirect(res, '/?auth_error=missing-code', {
      'set-cookie': clearOauthStateCookie()
    });
    return;
  }

  if (!consumeOauthState(db, req, state)) {
    redirect(res, '/?auth_error=invalid-state', {
      'set-cookie': clearOauthStateCookie()
    });
    return;
  }

  const effectiveConfig = getEffectiveConfig(config, db);
  const tokenResponse = await exchangeCodeForToken(effectiveConfig, code);
  const athleteId = saveAthleteAndToken(db, tokenResponse, scope);
  const session = createSession(db, athleteId);

  try {
    await syncStravaActivities(db, effectiveConfig, athleteId);
  } catch (syncError) {
    console.warn('Initial Strava sync failed:', syncError.message);
  }

  redirect(res, '/', {
    'set-cookie': [session.header, clearOauthStateCookie()]
  });
}

function decorateDashboard(dashboard, session) {
  return {
    ...dashboard,
    appMode: config.appMode,
    isPremium: Boolean(session.is_premium || dashboard.athlete?.isPremium)
  };
}

function getStripe() {
  if (!stripeClient) {
    stripeClient = new Stripe(config.stripe.secretKey);
  }
  return stripeClient;
}

async function handleStripeWebhook(req, res) {
  if (!config.stripe.secretKey || !config.stripe.webhookSecret) {
    sendError(res, 500, 'Stripe webhook is not configured.');
    return;
  }

  const signature = req.headers['stripe-signature'];
  if (!signature) {
    sendError(res, 400, 'Missing Stripe signature.');
    return;
  }

  let event;
  try {
    const rawBody = await readRequestBuffer(req);
    event = getStripe().webhooks.constructEvent(
      rawBody,
      signature,
      config.stripe.webhookSecret
    );
  } catch (error) {
    sendError(res, 400, 'Invalid Stripe webhook signature.', error.message);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const checkoutSession = event.data.object;
    const athleteId = Number(checkoutSession.metadata?.athlete_id);
    if (Number.isFinite(athleteId)) {
      statements.updateAthleteBilling(db).run(
        1,
        stripeId(checkoutSession.customer),
        stripeId(checkoutSession.subscription),
        athleteId
      );
    }
  }

  sendJson(res, 200, {
    received: true
  });
}

function stripeId(value) {
  if (!value) {
    return null;
  }
  return typeof value === 'string' ? value : value.id || null;
}

async function readJsonBody(req) {
  const body = await readRequestBody(req);
  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

function validateStravaSetup(body, config) {
  const clientId = String(body.clientId || '').trim();
  const clientSecret = String(body.clientSecret || '').trim();
  const redirectUri = String(
    body.redirectUri ||
      config.strava.redirectUri ||
      `http://localhost:${config.port}/auth/strava/callback`
  ).trim();

  if (!/^\d+$/.test(clientId)) {
    throw new Error('Strava Client ID should be the numeric id from your Strava app.');
  }

  if (clientSecret.length < 12) {
    throw new Error('Strava Client Secret looks too short.');
  }

  const parsedRedirect = new URL(redirectUri);
  if (!['http:', 'https:'].includes(parsedRedirect.protocol)) {
    throw new Error('Redirect URI must start with http:// or https://.');
  }

  return {
    clientId,
    clientSecret,
    redirectUri
  };
}

process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});
