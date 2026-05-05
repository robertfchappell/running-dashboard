import { clearCookie, cookie, parseCookies, randomToken } from './http.js';
import { statements } from './db.js';

const SESSION_COOKIE = 'run_session';
const OAUTH_STATE_COOKIE = 'strava_oauth_state';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_STATE_TTL_SECONDS = 60 * 10;

export function createSession(db, athleteId) {
  const id = randomToken(48);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  statements.createSession(db).run(id, athleteId, expiresAt);
  return {
    id,
    header: cookie(SESSION_COOKIE, id, {
      maxAge: SESSION_TTL_SECONDS
    })
  };
}

export function destroySession(db, req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId) {
    statements.deleteSession(db).run(sessionId);
  }
  return clearCookie(SESSION_COOKIE);
}

export function requireSession(db, req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const session = statements.findSession(db).get(sessionId);
  if (!session || session.expires_at < now) {
    if (session) {
      statements.deleteSession(db).run(sessionId);
    }
    return null;
  }

  statements.touchSession(db).run(sessionId);
  return session;
}

export function createOauthState(db) {
  const state = randomToken(32);
  const expiresAt = Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS;
  statements.insertOauthState(db).run(state, expiresAt);
  return {
    state,
    header: cookie(OAUTH_STATE_COOKIE, state, {
      maxAge: OAUTH_STATE_TTL_SECONDS
    })
  };
}

export function consumeOauthState(db, req, callbackState) {
  const cookies = parseCookies(req);
  const cookieState = cookies[OAUTH_STATE_COOKIE];
  if (!cookieState || !callbackState || cookieState !== callbackState) {
    return false;
  }

  const result = statements.consumeOauthState(db).run(
    callbackState,
    Math.floor(Date.now() / 1000)
  );
  return result.changes === 1;
}

export function clearOauthStateCookie() {
  return clearCookie(OAUTH_STATE_COOKIE);
}

export function cleanupExpiredAuthData(db) {
  const now = Math.floor(Date.now() / 1000);
  statements.deleteExpiredSessions(db).run(now);
  statements.deleteExpiredOauthStates(db).run(now);
}
