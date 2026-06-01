import { getEffectiveConfig, isStravaConfigured } from './config.js';
import { statements } from './db.js';
import { syncStravaActivities } from './strava.js';

export function startAutoSync(db, config) {
  const settings = config.autoSync;
  if (!settings?.enabled || config.appMode === 'demo') {
    console.log('Auto sync disabled.');
    return noopController();
  }

  let running = false;
  let stopped = false;

  async function runOnce() {
    if (running || stopped) {
      return;
    }

    const effectiveConfig = getEffectiveConfig(config, db);
    if (!isStravaConfigured(effectiveConfig)) {
      return;
    }

    running = true;
    try {
      const thresholdUnix =
        Math.floor(Date.now() / 1000) - settings.intervalSeconds;
      const athletes = statements
        .dueAutoSyncAthletes(db)
        .all(thresholdUnix, settings.batchSize);

      for (const athlete of athletes) {
        if (stopped) {
          break;
        }
        const name =
          [athlete.firstname, athlete.lastname].filter(Boolean).join(' ') ||
          athlete.athlete_id;
        try {
          console.log(`Auto syncing Strava activities for ${name}.`);
          await syncStravaActivities(db, effectiveConfig, athlete.athlete_id);
        } catch (error) {
          console.warn(
            `Auto sync failed for athlete ${athlete.athlete_id}: ${error.message}`
          );
        }
      }
    } finally {
      running = false;
    }
  }

  const initialTimer = setTimeout(runOnce, settings.initialDelayMs);
  const intervalTimer = setInterval(runOnce, settings.scanMs);
  console.log(
    `Auto sync enabled every ${settings.intervalHours} hours; checking every ${settings.scanMinutes} minutes.`
  );

  return {
    enabled: true,
    runOnce,
    stop() {
      stopped = true;
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    }
  };
}

function noopController() {
  return {
    enabled: false,
    runOnce() {},
    stop() {}
  };
}
