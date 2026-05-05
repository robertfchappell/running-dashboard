# Strava Training Dashboard

A local website foundation for Strava-powered running and biking metrics.

It includes:
- Strava OAuth login
- SQLite persistence for athletes, tokens, sessions, and activities
- Token refresh before Strava API calls
- Activity sync from Strava
- Separate running and biking dashboards
- Trend scoring for improving, maintaining, or deproving
- Zone 2 estimates using an observed-max-HR aerobic percentage band, with a local default fallback
- Aerobic efficiency signals that compare pace or speed against heart rate
- Dashboard metrics, weekly charts, recent activities, and recent best efforts
- Clickable activity details with cached route, HR stream, pace or speed stream, cadence, watts, and map context
- `/focus` page with deterministic 30-day training recommendations

## Setup

1. Create a Strava app at https://www.strava.com/settings/api.
2. In the Strava app settings, set `Authorization Callback Domain` to `localhost`.
3. Start the app:

```bash
npm start
```

On this Windows machine, if PowerShell blocks `npm`, use:

```powershell
npm.cmd start
```

Then open http://localhost:3000.

The first screen lets the site owner paste the Strava `Client ID` and
`Client Secret` into the browser. Those settings are saved in SQLite, so normal
users do not edit files. They just click `Continue with Strava`.

You can still use environment variables instead, which is better for a deployed
server. Copy `.env.example` to `.env` and set `STRAVA_CLIENT_ID`,
`STRAVA_CLIENT_SECRET`, and `STRAVA_REDIRECT_URI`.

## Notes

- The app stores Strava tokens in the local SQLite database at `data/running.db`.
- For production, move token storage to encrypted storage and serve behind HTTPS.
- Browser setup is only allowed from `localhost` by default. Set `ALLOW_BROWSER_SETUP=false` in production if you only want environment-based configuration.
- The first sync fetches up to `STRAVA_SYNC_PAGES * 100` recent activities. Increase `STRAVA_SYNC_PAGES` in `.env` if you want deeper history.
- The running dashboard accepts Strava `Run`, `TrailRun`, `VirtualRun`, and `Wheelchair` sport types.
- The biking dashboard accepts `Ride`, `MountainBikeRide`, `GravelRide`, `VirtualRide`, `EBikeRide`, `EMountainBikeRide`, `Handcycle`, and `Velomobile`.
- Activity details are fetched lazily when clicked and cached in `activity_details` for 12 hours.
- Zone 2 is estimated. For a serious training product, add a user setting for custom HR zones.
