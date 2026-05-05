import { statements } from './db.js';

const METERS_PER_MILE = 1609.344;
const SECONDS_PER_DAY = 86_400;
const FEET_PER_METER = 3.28084;
const DEFAULT_ZONE_2 = {
  lower: 126,
  upper: 146,
  source: 'default',
  observedMaxHeartRate: null
};
const ZONE_2_LOWER_FACTOR = 0.68;
const ZONE_2_UPPER_FACTOR = 0.78;

export function buildDashboard(db, athleteId) {
  const athlete = statements.athleteById(db).get(athleteId);
  const lastSync = statements.lastSyncRun(db).get(athleteId) || null;

  const runRows = statements
    .allSportActivities(db)
    .all(athleteId, 'run', 'run')
    .map((activity) => normalizeActivity(activity, 'run'));
  const rideRows = statements
    .allSportActivities(db)
    .all(athleteId, 'ride', 'ride')
    .map((activity) => normalizeActivity(activity, 'ride'));

  return {
    athlete: athlete ? formatAthlete(athlete) : null,
    lastSync,
    totalActivitiesSaved: runRows.length + rideRows.length,
    sports: {
      run: buildSportDashboard(db, athleteId, 'run', runRows),
      ride: buildSportDashboard(db, athleteId, 'ride', rideRows)
    }
  };
}

export function buildActivityDetail(activity, detail, streams, source, warning) {
  const category = activity.is_ride ? 'ride' : 'run';
  const normalized = normalizeActivity(activity, category);
  const zone2Range = estimateZone2([normalized]);
  const samples = buildStreamSamples(streams || {}, category);
  const route = samples
    .filter((sample) => Number.isFinite(sample.lat) && Number.isFinite(sample.lng))
    .map((sample) => [sample.lat, sample.lng]);
  const hrSamples = samples.filter((sample) => Number.isFinite(sample.heartRate));
  const zone2Samples = hrSamples.filter(
    (sample) =>
      sample.heartRate >= zone2Range.lower && sample.heartRate <= zone2Range.upper
  );
  const zone2TimeSeconds = estimateSampleSeconds(zone2Samples);
  const hrTimeSeconds = estimateSampleSeconds(hrSamples);

  return {
    source,
    warning: warning || null,
    activity: {
      ...formatActivity(normalized),
      description: detail.description || '',
      calories: nullableRound(detail.calories, 0),
      deviceName: detail.device_name || '',
      gearName: detail.gear?.name || '',
      location: formatLocation(detail),
      startLatLng: Array.isArray(detail.start_latlng) ? detail.start_latlng : null,
      endLatLng: Array.isArray(detail.end_latlng) ? detail.end_latlng : null,
      map: {
        summaryPolyline:
          detail.map?.summary_polyline || activity.summary_polyline || '',
        polyline: detail.map?.polyline || ''
      }
    },
    zone2Range,
    zone2: {
      sampleCount: zone2Samples.length,
      timeSeconds: zone2TimeSeconds,
      percent:
        hrTimeSeconds > 0 ? round((zone2TimeSeconds / hrTimeSeconds) * 100, 1) : null,
      avgHeartRate: nullableRound(averageValue(zone2Samples, 'heartRate'), 0),
      avgPaceSecondsPerMile: nullableRound(
        paceFromSamples(zone2Samples),
        0
      ),
      avgSpeedMph: nullableRound(speedFromSamples(zone2Samples), 1)
    },
    samples,
    route
  };
}

function buildSportDashboard(db, athleteId, category, activities) {
  const recent = statements
    .recentSportActivities(db)
    .all(athleteId, category, category, 14)
    .map((activity) => normalizeActivity(activity, category));
  const zone2Range = estimateZone2(activities);
  const now = new Date();
  const windows = {
    last7: summarizeWindow(activities, daysAgo(now, 7), now, category, zone2Range),
    prev7: summarizeWindow(
      activities,
      daysAgo(now, 14),
      daysAgo(now, 7),
      category,
      zone2Range
    ),
    last28: summarizeWindow(activities, daysAgo(now, 28), now, category, zone2Range),
    prev28: summarizeWindow(
      activities,
      daysAgo(now, 56),
      daysAgo(now, 28),
      category,
      zone2Range
    ),
    last90: summarizeWindow(activities, daysAgo(now, 90), now, category, zone2Range)
  };

  const trend = buildTrend(category, windows.last28, windows.prev28, zone2Range);

  return {
    key: category,
    label: category === 'ride' ? 'Biking' : 'Running',
    activityNoun: category === 'ride' ? 'ride' : 'run',
    activityNounPlural: category === 'ride' ? 'rides' : 'runs',
    totalSaved: activities.length,
    zone2Range,
    metrics: {
      last7: decorateSummary(windows.last7),
      last28: decorateSummary(windows.last28),
      last90: decorateSummary(windows.last90),
      allTime: decorateSummary(summarizeActivities(activities, category, zone2Range))
    },
    comparison: {
      last28: decorateSummary(windows.last28),
      previous28: decorateSummary(windows.prev28),
      trend
    },
    focusMetrics: buildFocusMetrics(activities, category, zone2Range),
    weekly: buildWeeklySeries(activities, category, zone2Range, 12),
    recentActivities: recent.map(formatActivity),
    efforts: buildEfforts(activities, category, zone2Range)
  };
}

function normalizeActivity(activity, category) {
  const distanceMiles = activity.distance_m / METERS_PER_MILE;
  const movingHours = activity.moving_time_s / 3600;
  const speedMph = movingHours > 0 ? distanceMiles / movingHours : null;
  const paceSecondsPerMile =
    distanceMiles > 0 ? activity.moving_time_s / distanceMiles : null;
  const averageHeartRate = nullableNumber(activity.average_heartrate);
  const aerobicEfficiency =
    averageHeartRate && speedMph ? speedMph / averageHeartRate : null;

  return {
    id: activity.id,
    name: activity.name,
    category,
    startDate: new Date(activity.start_date),
    startDateLocal: activity.start_date_local,
    distanceMeters: activity.distance_m,
    distanceMiles,
    movingTimeSeconds: activity.moving_time_s,
    elapsedTimeSeconds: activity.elapsed_time_s,
    elevationMeters: activity.total_elevation_gain_m,
    elevationFeet: activity.total_elevation_gain_m * FEET_PER_METER,
    paceSecondsPerMile,
    speedMph,
    aerobicEfficiency,
    averageHeartRate,
    maxHeartRate: nullableNumber(activity.max_heartrate),
    averageCadence: normalizeCadence(activity.average_cadence, category),
    averageWatts: nullableNumber(activity.average_watts),
    maxWatts: nullableNumber(activity.max_watts),
    kilojoules: nullableNumber(activity.kilojoules),
    achievementCount: activity.achievement_count,
    kudosCount: activity.kudos_count,
    sportType: activity.sport_type || activity.type || sportLabel(category),
    summaryPolyline: activity.summary_polyline || ''
  };
}

function summarizeWindow(activities, start, end, category, zone2Range) {
  return summarizeActivities(
    activities.filter(
      (activity) => activity.startDate >= start && activity.startDate < end
    ),
    category,
    zone2Range
  );
}

function summarizeActivities(activities, category, zone2Range) {
  const distanceMiles = sum(activities, (activity) => activity.distanceMiles);
  const movingTimeSeconds = sum(activities, (activity) => activity.movingTimeSeconds);
  const elevationFeet = sum(activities, (activity) => activity.elevationFeet);
  const longestDistanceMiles = Math.max(
    0,
    ...activities.map((activity) => activity.distanceMiles)
  );
  const avgPaceSecondsPerMile =
    distanceMiles > 0 ? movingTimeSeconds / distanceMiles : null;
  const avgSpeedMph =
    movingTimeSeconds > 0 ? distanceMiles / (movingTimeSeconds / 3600) : null;
  const avgHeartRate = weightedAverage(
    activities.filter((activity) => Number.isFinite(activity.averageHeartRate)),
    'averageHeartRate',
    'movingTimeSeconds'
  );
  const aerobicEfficiency = weightedAverage(
    activities.filter((activity) => Number.isFinite(activity.aerobicEfficiency)),
    'aerobicEfficiency',
    'movingTimeSeconds'
  );
  const zone2Activities = activities.filter(
    (activity) =>
      Number.isFinite(activity.averageHeartRate) &&
      activity.averageHeartRate >= zone2Range.lower &&
      activity.averageHeartRate <= zone2Range.upper
  );
  const zone2DistanceMiles = sum(
    zone2Activities,
    (activity) => activity.distanceMiles
  );
  const zone2MovingTimeSeconds = sum(
    zone2Activities,
    (activity) => activity.movingTimeSeconds
  );

  return {
    category,
    activityCount: activities.length,
    distanceMiles,
    movingTimeSeconds,
    elevationFeet,
    longestDistanceMiles,
    avgPaceSecondsPerMile,
    avgSpeedMph,
    avgHeartRate,
    aerobicEfficiency,
    averageDistanceMiles:
      activities.length > 0 ? distanceMiles / activities.length : 0,
    zone2Count: zone2Activities.length,
    zone2DistanceMiles,
    zone2MovingTimeSeconds,
    zone2AvgHeartRate: weightedAverage(
      zone2Activities,
      'averageHeartRate',
      'movingTimeSeconds'
    ),
    zone2PaceSecondsPerMile:
      zone2DistanceMiles > 0 ? zone2MovingTimeSeconds / zone2DistanceMiles : null,
    zone2SpeedMph:
      zone2MovingTimeSeconds > 0
        ? zone2DistanceMiles / (zone2MovingTimeSeconds / 3600)
        : null,
    zone2Efficiency: weightedAverage(
      zone2Activities.filter((activity) =>
        Number.isFinite(activity.aerobicEfficiency)
      ),
      'aerobicEfficiency',
      'movingTimeSeconds'
    ),
    hrBands: buildHeartRateBands(activities)
  };
}

function buildFocusMetrics(activities, category, zone2Range) {
  const now = new Date();
  const current = summarizeWindow(
    activities,
    daysAgo(now, 30),
    now,
    category,
    zone2Range
  );
  const previous = summarizeWindow(
    activities,
    daysAgo(now, 60),
    daysAgo(now, 30),
    category,
    zone2Range
  );
  const paceOrSpeedBadDirectionChange =
    category === 'run'
      ? percentChange(current.avgPaceSecondsPerMile, previous.avgPaceSecondsPerMile)
      : invertChange(percentChange(current.avgSpeedMph, previous.avgSpeedMph));

  return {
    volume_change_percent: percentNumber(
      percentChange(current.distanceMiles, previous.distanceMiles)
    ),
    run_frequency_change_percent: percentNumber(
      percentChange(current.activityCount, previous.activityCount)
    ),
    zone2_efficiency_change_percent: percentNumber(
      percentChange(current.zone2Efficiency, previous.zone2Efficiency)
    ),
    avg_hr_change: percentNumber(
      percentChange(current.avgHeartRate, previous.avgHeartRate)
    ),
    avg_pace_change: percentNumber(paceOrSpeedBadDirectionChange),
    total_runs_30d: current.activityCount,
    total_miles_30d: round(current.distanceMiles, 1)
  };
}

function buildTrend(category, current, previous, zone2Range) {
  const distanceChange = percentChange(current.distanceMiles, previous.distanceMiles);
  const frequencyChange = percentChange(
    current.activityCount,
    previous.activityCount
  );
  const longChange = percentChange(
    current.longestDistanceMiles,
    previous.longestDistanceMiles
  );
  const avgHrChange = percentChange(current.avgHeartRate, previous.avgHeartRate);
  const matchedHrChange = matchedHeartRatePerformanceChange(
    current.hrBands,
    previous.hrBands
  );
  const overallHrEfficiencyChange = percentChange(
    current.aerobicEfficiency,
    previous.aerobicEfficiency
  );
  const sameHrPerformanceChange = choosePerformanceChange(
    matchedHrChange,
    overallHrEfficiencyChange
  );
  const zone2EfficiencyChange = percentChange(
    current.zone2Efficiency,
    previous.zone2Efficiency
  );
  const zone2PaceChange = percentChange(
    current.zone2PaceSecondsPerMile,
    previous.zone2PaceSecondsPerMile
  );
  const zone2SpeedChange = percentChange(
    current.zone2SpeedMph,
    previous.zone2SpeedMph
  );

  let score = 0;
  score += scoreHigherIsBetter(sameHrPerformanceChange, 0.005, 0.015) * 2;
  score += scoreHigherIsBetter(zone2EfficiencyChange, 0.005, 0.02);
  score += scoreVolumeSignal(distanceChange);
  score += scoreVolumeSignal(frequencyChange);
  score += scoreHigherIsBetter(longChange, 0.08, 0.2);

  if (
    sameHrPerformanceChange !== null &&
    sameHrPerformanceChange > 0.015 &&
    (avgHrChange === null || avgHrChange <= 0.015)
  ) {
    score += 2;
  } else if (
    sameHrPerformanceChange !== null &&
    sameHrPerformanceChange < -0.015 &&
    (avgHrChange === null || avgHrChange >= -0.015)
  ) {
    score -= 2;
  }

  let status = 'maintaining';
  if (score >= 2) {
    status = 'improving';
  } else if (score <= -2) {
    status = 'deproving';
  }

  const insights = [];
  if (current.activityCount === 0) {
    insights.push(`No ${sportPlural(category)} are saved for the last 28 days yet.`);
  } else if (previous.activityCount === 0) {
    insights.push(
      `You have recent ${sportPlural(category)}, but no previous 28-day baseline yet.`
    );
  } else {
    insights.push(describeChange('Volume', distanceChange, 'higher-is-better'));
    insights.push(
      describeChange(
        category === 'run' ? 'Pace at the same HR' : 'Speed at the same HR',
        sameHrPerformanceChange,
        'higher-is-better',
        'this is the main trend signal'
      )
    );
    if (current.zone2Count > 0 || previous.zone2Count > 0) {
      insights.push(
        describeChange(
          'Zone 2 efficiency',
          zone2EfficiencyChange,
          'higher-is-better',
          `${zone2Range.lower}-${zone2Range.upper} bpm efforts`
        )
      );
    } else {
      insights.push(
        `No average-HR ${sportPlural(category)} landed in the estimated Zone 2 band (${zone2Range.lower}-${zone2Range.upper} bpm).`
      );
    }
    insights.push(describeHrContext(avgHrChange, sameHrPerformanceChange));
  }

  return {
    status,
    score,
    distanceChange,
    frequencyChange,
    longChange,
    avgHrChange,
    matchedHrChange,
    overallHrEfficiencyChange,
    efficiencyChange: sameHrPerformanceChange,
    sameHrPerformanceChange,
    zone2EfficiencyChange,
    zone2PaceChange,
    zone2SpeedChange,
    label:
      status === 'improving'
        ? 'Improving'
        : status === 'deproving'
          ? 'Deproving'
          : 'Maintaining',
    summary: trendSummary(category, status, score),
    insights
  };
}

function buildWeeklySeries(activities, category, zone2Range, weeks) {
  const now = startOfWeek(new Date());
  const firstWeek = addDays(now, -(weeks - 1) * 7);
  const buckets = new Map();

  for (let index = 0; index < weeks; index += 1) {
    const weekStart = addDays(firstWeek, index * 7);
    const key = dateKey(weekStart);
    buckets.set(key, {
      weekStart: key,
      label: shortDate(weekStart),
      activities: []
    });
  }

  for (const activity of activities) {
    const weekStart = startOfWeek(activity.startDate);
    const key = dateKey(weekStart);
    if (buckets.has(key)) {
      buckets.get(key).activities.push(activity);
    }
  }

  return [...buckets.values()].map((bucket) => {
    const summary = summarizeActivities(bucket.activities, category, zone2Range);
    return {
      weekStart: bucket.weekStart,
      label: bucket.label,
      activityCount: summary.activityCount,
      distanceMiles: round(summary.distanceMiles, 1),
      movingTimeHours: round(summary.movingTimeSeconds / 3600, 1),
      avgPaceSecondsPerMile: nullableRound(summary.avgPaceSecondsPerMile, 0),
      avgSpeedMph: nullableRound(summary.avgSpeedMph, 1),
      avgHeartRate: nullableRound(summary.avgHeartRate, 0),
      zone2PaceSecondsPerMile: nullableRound(summary.zone2PaceSecondsPerMile, 0),
      zone2SpeedMph: nullableRound(summary.zone2SpeedMph, 1),
      zone2Efficiency: nullableRound(summary.zone2Efficiency, 4),
      elevationFeet: Math.round(summary.elevationFeet)
    };
  });
}

function buildEfforts(activities, category, zone2Range) {
  if (activities.length === 0) {
    return [];
  }

  const month = bestDistanceMonth(activities);
  if (category === 'ride') {
    return [
      effortFromActivity('Longest ride', longestActivity(activities), 'distance'),
      effortFromActivity('Best Zone 2 speed', bestZone2Activity(activities, zone2Range), 'speedHr'),
      effortFromActivity('Biggest climb', biggestClimb(activities), 'elevation'),
      month ? { label: 'Best mileage month', value: `${month.distanceMiles} mi`, sub: month.month } : null
    ].filter(Boolean);
  }

  return [
    effortFromActivity('Fastest 5K+ pace', bestPace(activities, 3.10686), 'pace'),
    effortFromActivity('Best Zone 2 pace', bestZone2Activity(activities, zone2Range), 'paceHr'),
    effortFromActivity('Longest run', longestActivity(activities), 'distance'),
    month ? { label: 'Best mileage month', value: `${month.distanceMiles} mi`, sub: month.month } : null
  ].filter(Boolean);
}

function effortFromActivity(label, activity, mode) {
  if (!activity) {
    return {
      label,
      value: '-',
      sub: 'No qualifying activity yet'
    };
  }

  const values = {
    distance: `${round(activity.distanceMiles, 1)} mi`,
    pace: formatPace(activity.paceSecondsPerMile),
    paceHr: `${formatPace(activity.paceSecondsPerMile)} @ ${nullableRound(activity.averageHeartRate, 0) || '-'} bpm`,
    speedHr: `${nullableRound(activity.speedMph, 1) || '-'} mph @ ${nullableRound(activity.averageHeartRate, 0) || '-'} bpm`,
    elevation: `${Math.round(activity.elevationFeet)} ft`
  };

  return {
    label,
    value: values[mode] || '-',
    sub: `${activity.name} - ${shortDate(activity.startDate)}`
  };
}

function bestPace(activities, minimumMiles) {
  return activities
    .filter(
      (activity) =>
        activity.distanceMiles >= minimumMiles &&
        Number.isFinite(activity.paceSecondsPerMile)
    )
    .sort((a, b) => a.paceSecondsPerMile - b.paceSecondsPerMile)[0];
}

function bestZone2Activity(activities, zone2Range) {
  return activities
    .filter(
      (activity) =>
        Number.isFinite(activity.averageHeartRate) &&
        activity.averageHeartRate >= zone2Range.lower &&
        activity.averageHeartRate <= zone2Range.upper &&
        Number.isFinite(activity.aerobicEfficiency)
    )
    .sort((a, b) => b.aerobicEfficiency - a.aerobicEfficiency)[0];
}

function longestActivity(activities) {
  return [...activities].sort((a, b) => b.distanceMiles - a.distanceMiles)[0];
}

function biggestClimb(activities) {
  return [...activities].sort((a, b) => b.elevationFeet - a.elevationFeet)[0];
}

function bestDistanceMonth(activities) {
  const months = new Map();
  for (const activity of activities) {
    const key = `${activity.startDate.getFullYear()}-${String(
      activity.startDate.getMonth() + 1
    ).padStart(2, '0')}`;
    months.set(key, (months.get(key) || 0) + activity.distanceMiles);
  }

  const best = [...months.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) {
    return null;
  }
  return {
    month: best[0],
    distanceMiles: round(best[1], 1)
  };
}

function buildHeartRateBands(activities) {
  const bands = {};
  for (const activity of activities) {
    if (
      !Number.isFinite(activity.averageHeartRate) ||
      !Number.isFinite(activity.speedMph) ||
      !Number.isFinite(activity.movingTimeSeconds)
    ) {
      continue;
    }

    const band = String(Math.round(activity.averageHeartRate / 5) * 5);
    if (!bands[band]) {
      bands[band] = {
        speedWeight: 0,
        weight: 0,
        count: 0
      };
    }
    bands[band].speedWeight += activity.speedMph * activity.movingTimeSeconds;
    bands[band].weight += activity.movingTimeSeconds;
    bands[band].count += 1;
  }

  return Object.fromEntries(
    Object.entries(bands).map(([band, value]) => [
      band,
      {
        avgSpeedMph: value.weight > 0 ? value.speedWeight / value.weight : null,
        weight: value.weight,
        count: value.count
      }
    ])
  );
}

function matchedHeartRatePerformanceChange(currentBands, previousBands) {
  const commonBands = Object.keys(currentBands || {}).filter(
    (band) =>
      previousBands?.[band] &&
      Number.isFinite(currentBands[band].avgSpeedMph) &&
      Number.isFinite(previousBands[band].avgSpeedMph) &&
      previousBands[band].avgSpeedMph > 0
  );
  if (commonBands.length === 0) {
    return null;
  }

  let weightedChange = 0;
  let totalWeight = 0;
  for (const band of commonBands) {
    const current = currentBands[band];
    const previous = previousBands[band];
    const weight = Math.min(current.weight || 0, previous.weight || 0);
    if (weight <= 0) {
      continue;
    }
    weightedChange +=
      ((current.avgSpeedMph - previous.avgSpeedMph) / previous.avgSpeedMph) *
      weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedChange / totalWeight : null;
}

function choosePerformanceChange(matchedChange, overallChange) {
  const values = [matchedChange, overallChange].filter((value) =>
    Number.isFinite(value)
  );
  if (values.length === 0) {
    return null;
  }
  if (values.some((value) => value > 0)) {
    return Math.max(...values);
  }
  return Math.min(...values);
}

function estimateZone2(activities) {
  const maxHeartRate = Math.max(
    0,
    ...activities
      .map((activity) => activity.maxHeartRate)
      .filter((value) => Number.isFinite(value) && value >= 120)
  );

  if (!maxHeartRate) {
    return DEFAULT_ZONE_2;
  }

  const adjusted = getZone2Adjusted(maxHeartRate);
  return {
    ...adjusted,
    source: 'observed-max-hr-percent',
    observedMaxHeartRate: Math.round(maxHeartRate)
  };
}

function getZone2Adjusted(maxHeartRate) {
  return {
    lower: Math.max(80, Math.round(maxHeartRate * ZONE_2_LOWER_FACTOR)),
    upper: Math.max(100, Math.ceil(maxHeartRate * ZONE_2_UPPER_FACTOR))
  };
}

function decorateSummary(summary) {
  return {
    category: summary.category,
    activityCount: summary.activityCount,
    distanceMiles: round(summary.distanceMiles, 1),
    movingTimeHours: round(summary.movingTimeSeconds / 3600, 1),
    elevationFeet: Math.round(summary.elevationFeet),
    longestDistanceMiles: round(summary.longestDistanceMiles, 1),
    avgPaceSecondsPerMile: nullableRound(summary.avgPaceSecondsPerMile, 0),
    avgSpeedMph: nullableRound(summary.avgSpeedMph, 1),
    avgHeartRate: nullableRound(summary.avgHeartRate, 0),
    aerobicEfficiency: nullableRound(summary.aerobicEfficiency, 4),
    averageDistanceMiles: round(summary.averageDistanceMiles, 1),
    zone2Count: summary.zone2Count,
    zone2DistanceMiles: round(summary.zone2DistanceMiles, 1),
    zone2MovingTimeHours: round(summary.zone2MovingTimeSeconds / 3600, 1),
    zone2AvgHeartRate: nullableRound(summary.zone2AvgHeartRate, 0),
    zone2PaceSecondsPerMile: nullableRound(summary.zone2PaceSecondsPerMile, 0),
    zone2SpeedMph: nullableRound(summary.zone2SpeedMph, 1),
    zone2Efficiency: nullableRound(summary.zone2Efficiency, 4)
  };
}

function formatAthlete(athlete) {
  return {
    id: athlete.id,
    name:
      [athlete.firstname, athlete.lastname].filter(Boolean).join(' ') ||
      athlete.username ||
      'Runner',
    firstname: athlete.firstname,
    profile: athlete.profile,
    location: [athlete.city, athlete.state, athlete.country]
      .filter(Boolean)
      .join(', ')
  };
}

function formatActivity(activity) {
  return {
    id: activity.id,
    name: activity.name,
    category: activity.category,
    date: activity.startDate.toISOString(),
    localDate: activity.startDateLocal,
    distanceMiles: round(activity.distanceMiles, 2),
    movingTimeSeconds: activity.movingTimeSeconds,
    elapsedTimeSeconds: activity.elapsedTimeSeconds,
    paceSecondsPerMile: nullableRound(activity.paceSecondsPerMile, 0),
    speedMph: nullableRound(activity.speedMph, 1),
    elevationFeet: Math.round(activity.elevationFeet),
    averageHeartRate: nullableRound(activity.averageHeartRate, 0),
    maxHeartRate: nullableRound(activity.maxHeartRate, 0),
    averageCadence: nullableRound(activity.averageCadence, 1),
    averageWatts: nullableRound(activity.averageWatts, 0),
    maxWatts: nullableRound(activity.maxWatts, 0),
    kilojoules: nullableRound(activity.kilojoules, 0),
    achievementCount: activity.achievementCount,
    kudosCount: activity.kudosCount,
    sportType: activity.sportType,
    summaryPolyline: activity.summaryPolyline
  };
}

function normalizeCadence(value, category) {
  const cadence = nullableNumber(value);
  if (!Number.isFinite(cadence)) {
    return null;
  }
  return category === 'run' ? cadence * 2 : cadence;
}

function buildStreamSamples(streams, category) {
  const streamData = {
    time: dataFor(streams, 'time'),
    distance: dataFor(streams, 'distance'),
    latlng: dataFor(streams, 'latlng'),
    altitude: dataFor(streams, 'altitude'),
    velocity: dataFor(streams, 'velocity_smooth'),
    heartrate: dataFor(streams, 'heartrate'),
    cadence: dataFor(streams, 'cadence'),
    watts: dataFor(streams, 'watts'),
    temp: dataFor(streams, 'temp'),
    moving: dataFor(streams, 'moving'),
    grade: dataFor(streams, 'grade_smooth')
  };
  const size = Math.max(0, ...Object.values(streamData).map((items) => items.length));
  if (size === 0) {
    return [];
  }

  const maxSamples = 700;
  const step = Math.max(1, Math.ceil(size / maxSamples));
  const samples = [];
  for (let index = 0; index < size; index += step) {
    const latlng = valueAt(streamData.latlng, index, size);
    const velocityMps = valueAt(streamData.velocity, index, size);
    samples.push({
      timeSeconds: nullableRound(valueAt(streamData.time, index, size), 0),
      distanceMiles: nullableRound(
        valueAt(streamData.distance, index, size) / METERS_PER_MILE,
        2
      ),
      lat: Array.isArray(latlng) ? nullableRound(latlng[0], 6) : null,
      lng: Array.isArray(latlng) ? nullableRound(latlng[1], 6) : null,
      altitudeFeet: nullableRound(
        valueAt(streamData.altitude, index, size) * FEET_PER_METER,
        0
      ),
      speedMph: nullableRound(velocityMps * 2.236936, 1),
      paceSecondsPerMile:
        velocityMps > 0 ? nullableRound(METERS_PER_MILE / velocityMps, 0) : null,
      heartRate: nullableRound(valueAt(streamData.heartrate, index, size), 0),
      cadence: nullableRound(
        normalizeCadence(valueAt(streamData.cadence, index, size), category),
        1
      ),
      watts: nullableRound(valueAt(streamData.watts, index, size), 0),
      temp: nullableRound(valueAt(streamData.temp, index, size), 0),
      moving: Boolean(valueAt(streamData.moving, index, size)),
      grade: nullableRound(valueAt(streamData.grade, index, size), 1)
    });
  }
  return samples;
}

function dataFor(streams, key) {
  const data = streams?.[key]?.data;
  return Array.isArray(data) ? data : [];
}

function valueAt(items, index, targetSize) {
  if (!items.length) {
    return null;
  }
  const scaledIndex =
    targetSize <= 1 ? 0 : Math.round((index / Math.max(1, targetSize - 1)) * (items.length - 1));
  return items[Math.min(items.length - 1, Math.max(0, scaledIndex))];
}

function estimateSampleSeconds(samples) {
  if (samples.length === 0) {
    return 0;
  }

  const times = samples
    .map((sample) => sample.timeSeconds)
    .filter((value) => Number.isFinite(value));
  if (times.length >= 2) {
    return Math.max(0, Math.max(...times) - Math.min(...times));
  }
  return samples.length;
}

function paceFromSamples(samples) {
  const distance = rangeDelta(samples, 'distanceMiles');
  const time = rangeDelta(samples, 'timeSeconds');
  return distance > 0 && time > 0 ? time / distance : null;
}

function speedFromSamples(samples) {
  const distance = rangeDelta(samples, 'distanceMiles');
  const time = rangeDelta(samples, 'timeSeconds');
  return distance > 0 && time > 0 ? distance / (time / 3600) : null;
}

function rangeDelta(samples, key) {
  const values = samples
    .map((sample) => sample[key])
    .filter((value) => Number.isFinite(value));
  if (values.length < 2) {
    return 0;
  }
  return Math.max(...values) - Math.min(...values);
}

function scoreHigherIsBetter(change, small, large) {
  if (change === null) {
    return 0;
  }
  if (change >= large) {
    return 2;
  }
  if (change >= small) {
    return 1;
  }
  if (change <= -large) {
    return -2;
  }
  if (change <= -small) {
    return -1;
  }
  return 0;
}

function scoreLowerIsBetter(change, small, large) {
  if (change === null) {
    return 0;
  }
  if (change <= -large) {
    return 2;
  }
  if (change <= -small) {
    return 1;
  }
  if (change >= large) {
    return -2;
  }
  if (change >= small) {
    return -1;
  }
  return 0;
}

function scoreVolumeSignal(change) {
  if (change === null) {
    return 0;
  }
  if (change >= 0.25) {
    return 2;
  }
  if (change >= 0.1) {
    return 1;
  }
  if (change <= -0.35) {
    return -2;
  }
  if (change <= -0.25) {
    return -1;
  }
  return 0;
}

function describeChange(name, change, direction, context = '') {
  if (change === null) {
    return `${name} does not have enough baseline data yet.`;
  }

  const pct = Math.abs(change * 100).toFixed(0);
  const up = change > 0;
  const flat = Math.abs(change) < 0.005;
  if (flat) {
    return `${name} is basically flat versus the prior 28 days.`;
  }

  const better = direction === 'higher-is-better' ? up : !up;
  const suffix = context ? ` (${context})` : '';
  return `${name} is ${up ? 'up' : 'down'} ${pct}%, which is ${
    better ? 'a positive signal' : 'a caution signal'
  }${suffix}.`;
}

function describeHrContext(avgHrChange, sameHrPerformanceChange) {
  if (avgHrChange === null) {
    return 'Average HR does not have enough baseline data yet.';
  }

  const hrPct = Math.abs(avgHrChange * 100).toFixed(0);
  const hrFlat = Math.abs(avgHrChange) < 0.015;
  if (
    hrFlat &&
    sameHrPerformanceChange !== null &&
    sameHrPerformanceChange > 0.01
  ) {
    return 'Average HR is basically the same while pace/speed improved, which is a strong positive signal.';
  }
  if (
    hrFlat &&
    sameHrPerformanceChange !== null &&
    sameHrPerformanceChange < -0.01
  ) {
    return 'Average HR is basically the same while pace/speed slipped, which is a caution signal.';
  }
  if (hrFlat) {
    return 'Average HR is basically flat versus the prior 28 days.';
  }
  return `Average HR is ${avgHrChange > 0 ? 'up' : 'down'} ${hrPct}%.`;
}

function trendSummary(category, status, score) {
  const noun = sportLabel(category).toLowerCase();
  if (status === 'improving') {
    return `Your recent ${noun} trend is positive with a score of ${score}.`;
  }
  if (status === 'deproving') {
    return `Your recent ${noun} trend is slipping with a score of ${score}.`;
  }
  return `Your recent ${noun} trend is steady with a score of ${score}.`;
}

function percentChange(current, previous) {
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    previous === 0
  ) {
    return null;
  }
  return (current - previous) / previous;
}

function percentNumber(change) {
  return change === null ? 0 : round(change * 100, 1);
}

function invertChange(change) {
  return change === null ? null : -change;
}

function daysAgo(date, days) {
  return new Date(date.getTime() - days * SECONDS_PER_DAY * 1000);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * SECONDS_PER_DAY * 1000);
}

function startOfWeek(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + mondayOffset);
  return copy;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function shortDate(date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}

function sportLabel(category) {
  return category === 'ride' ? 'Biking' : 'Running';
}

function sportPlural(category) {
  return category === 'ride' ? 'rides' : 'runs';
}

function formatLocation(detail) {
  if (detail.local_resolved_location) {
    return detail.local_resolved_location;
  }

  const pieces = [
    detail.location_city,
    detail.location_state,
    detail.location_country
  ].filter(Boolean);
  return pieces.join(', ');
}

function formatPace(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '-';
  }
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = String(rounded % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableRound(value, places) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return round(value, places);
}

function sum(items, selector) {
  return items.reduce((total, item) => total + selector(item), 0);
}

function averageValue(items, key) {
  const values = items
    .map((item) => item[key])
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }
  return sum(values, (value) => value) / values.length;
}

function weightedAverage(items, valueKey, weightKey = 'movingTimeSeconds') {
  const usable = items.filter(
    (item) => Number.isFinite(item[valueKey]) && Number.isFinite(item[weightKey])
  );
  if (usable.length === 0) {
    return null;
  }

  const totalWeight = sum(usable, (item) => item[weightKey]);
  if (totalWeight <= 0) {
    return sum(usable, (item) => item[valueKey]) / usable.length;
  }
  return sum(usable, (item) => item[valueKey] * item[weightKey]) / totalWeight;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
