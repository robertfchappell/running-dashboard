const app = document.querySelector('#app');
const state = {
  dashboard: null,
  configStatus: null,
  currentUser: null,
  activeSport: 'run',
  chartMetric: 'distanceMiles',
  toastTimer: null,
  demoMode: false
};

const icons = {
  strava:
    '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m14.6 13.4-2.6-5-2.6 5H5L12 0l7 13.4h-4.4Zm0 0 2.2 4.3 2.2-4.3h3.2L16.8 24l-5.4-10.6h3.2Z"/></svg>',
  sync:
    '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 0 0-15.1-6.6L3 8m0 0V3m0 5h5m-5 4a9 9 0 0 0 15.1 6.6L21 16m0 0v5m0-5h-5"/></svg>',
  logout:
    '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9"/></svg>',
  miles:
    '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 17c4-8 8 8 12 0s6-4 6-4M5 5h14"/></svg>',
  timer:
    '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M10 2h4m-2 12 4-4m4 4a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"/></svg>',
  flame:
    '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 22c4 0 8-3 8-8 0-4-3-7-5-9 .2 3-1 5-3 6 0-4-2-7-5-9 1 5-3 7-3 12 0 5 4 8 8 8Z"/></svg>',
  heart:
    '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>',
  bike:
    '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5.5 17.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm13 0a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5.5 14h4L12 8h3l3.5 6M9.5 14 7 9h3m2-1 2.5 6H12"/></svg>',
  close:
    '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M18 6 6 18M6 6l12 12"/></svg>'
};

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection', event.reason);
  if (isStillLoading()) {
    renderStartupError(event.reason || new Error('Startup promise failed.'));
  }
});

window.addEventListener('error', (event) => {
  console.error('Unhandled browser error', event.error || event.message);
  if (isStillLoading()) {
    renderStartupError(event.error || new Error(event.message));
  }
});

init().catch((error) => {
  console.error('Startup failed', error);
  renderStartupError(error);
});

async function init() {
  if (window.location.pathname === '/success') {
    renderCheckoutResult('success');
    return;
  }
  if (window.location.pathname === '/cancel') {
    renderCheckoutResult('cancel');
    return;
  }

  const demoPath = window.location.pathname.startsWith('/demo');
  if (demoPath) {
    state.demoMode = true;
    loadDemoDashboard();
    return;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.has('auth_error')) {
    showToast(`Strava login failed: ${params.get('auth_error')}`);
    history.replaceState(null, '', '/');
  }

  const [configStatus, me] = await Promise.all([
    api('/api/config/status'),
    api('/api/me')
  ]);
  state.configStatus = configStatus;
  state.currentUser = me;

  if (configStatus.appMode === 'demo') {
    state.demoMode = true;
    loadDemoDashboard();
    return;
  }

  if (window.location.pathname === '/about') {
    renderMethodologyPage(me);
    return;
  }

  if (window.location.pathname === '/billing') {
    renderBillingPage(me);
    return;
  }

  if (!configStatus.configured) {
    renderLogin(configStatus, false);
    return;
  }

  if (!me.authenticated) {
    renderLogin(configStatus, true);
    return;
  }

  await loadDashboard();
}

function renderStartupError(error) {
  app.innerHTML = `
    <section class="screen screen-login">
      <div class="login-copy">
        <p class="eyebrow">Strava training metrics</p>
        <h1>Startup issue</h1>
        <p class="lede">${escapeHtml(error.message || 'The dashboard could not finish loading.')}</p>
      </div>
      <div class="login-panel">
        <h2>Try refreshing</h2>
        <p>The app hit a startup error instead of hanging on the loading screen. Refreshing gets the latest uncached files from the local server.</p>
        <button class="primary-button" data-action="reload-page" type="button">${icons.sync}<span>Refresh dashboard</span></button>
      </div>
    </section>
  `;

  document
    .querySelector('[data-action="reload-page"]')
    ?.addEventListener('click', () => window.location.reload());
}

function isStillLoading() {
  return Boolean(document.querySelector('[data-view="loading"]'));
}

function renderLogin(configStatus, canLogin) {
  app.innerHTML = `
    <section class="screen screen-login">
      <div class="login-copy">
        <p class="eyebrow">Strava running metrics</p>
        <h1>Running Dashboard</h1>
        <p class="lede">Connect Strava once, sync your saved runs and rides, and get a clear read on whether your aerobic training is improving, maintaining, or deproving.</p>
      </div>
      <div class="login-panel">
        <h2>${canLogin ? 'Sign in with Strava' : 'Finish local setup'}</h2>
        <p>${canLogin ? 'Your Strava account becomes your login. The app stores your athlete profile, tokens, sessions, and activities in SQLite.' : 'Add your Strava app credentials before using OAuth login.'}</p>
        ${
          canLogin
            ? `<a class="primary-button" href="/auth/strava">${icons.strava}<span>Continue with Strava</span></a>`
            : setupMarkup(configStatus)
        }
        <div class="login-actions">
          <a class="secondary-button demo-button" href="/demo">View demo dashboard</a>
          <a class="secondary-button demo-button" href="/about">How it works</a>
        </div>
      </div>
    </section>
  `;

  const setupForm = document.querySelector('[data-action="save-strava-setup"]');
  if (setupForm) {
    setupForm.addEventListener('submit', saveStravaSetup);
  }
}

function renderBillingPage(me = { authenticated: false }) {
  const isPremium = Boolean(me.athlete?.isPremium || state.dashboard?.isPremium);
  const billing = getBillingState(me);
  const planLabel = isPremium ? 'Active plan' : 'Recommended';
  const cancelCopy =
    billing.cancelAtPeriodEnd && billing.currentPeriodEnd
      ? `Cancellation scheduled for ${formatUnixDate(billing.currentPeriodEnd)}`
      : 'Your plan is active';
  app.innerHTML = `
    <section class="dashboard billing-page">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">${icons.flame}</div>
          <div class="brand-text">
            <strong>Focus Premium</strong>
            <span>${isPremium ? escapeHtml(cancelCopy) : 'Upgrade your training'}</span>
          </div>
        </div>
        <div class="topbar-actions">
          <a class="secondary-button topbar-link" href="/about">How it works</a>
          <a class="secondary-button topbar-link" href="/">Dashboard</a>
        </div>
      </header>

      <main class="dashboard-main billing-main">
        <section class="billing-hero">
          <p class="eyebrow">Premium coaching</p>
          <h1>Upgrade your training</h1>
          <p>Unlock weekly targets and clear coaching guidance built from your Strava training.</p>
        </section>

        <section class="billing-grid">
          <article class="billing-card">
            <span>Current plan</span>
            <h2>Free</h2>
            <strong>$0</strong>
            <ul>
              <li>Basic dashboard metrics</li>
              <li>Recent runs and rides</li>
              <li>No coaching insights</li>
            </ul>
          </article>

          <article class="billing-card premium-plan">
            <span>${escapeHtml(planLabel)}</span>
            <h2>Focus Premium</h2>
            <strong>$5/month</strong>
            <ul>
              <li>Weekly run targets</li>
              <li>Personalized coaching insights</li>
              <li>What to fix next guidance</li>
              ${isPremium ? '<li>Update payment method and invoices through Stripe</li>' : ''}
              ${billing.cancelAtPeriodEnd ? `<li>Cancellation scheduled for ${escapeHtml(formatUnixDate(billing.currentPeriodEnd))}</li>` : ''}
            </ul>
            ${
              isPremium
                ? `<div class="billing-actions">
                    <button class="primary-button" data-action="billing-portal" type="button">Manage payment method</button>
                    <button class="secondary-button danger-button" data-action="cancel-subscription" type="button" ${billing.cancelAtPeriodEnd ? 'disabled' : ''}>
                      ${billing.cancelAtPeriodEnd ? 'Cancellation scheduled' : 'Cancel subscription'}
                    </button>
                    <a class="secondary-button billing-secondary-link" href="/focus">Open Focus</a>
                  </div>`
                : `<button class="primary-button" data-action="checkout" type="button">Unlock Focus - $5/month</button>`
            }
          </article>
        </section>
      </main>
    </section>
  `;

  document.querySelector('[data-action="checkout"]')?.addEventListener('click', () => {
    if (!me.authenticated) {
      showToast('Sign in with Strava before upgrading.');
      window.location.href = '/auth/strava';
      return;
    }
    startCheckout();
  });
  document.querySelector('[data-action="billing-portal"]')?.addEventListener('click', () => {
    if (!me.authenticated) {
      showToast('Sign in with Strava before managing billing.');
      window.location.href = '/auth/strava';
      return;
    }
    openBillingPortal();
  });
  document.querySelector('[data-action="cancel-subscription"]')?.addEventListener('click', () => {
    if (!me.authenticated) {
      showToast('Sign in with Strava before managing billing.');
      window.location.href = '/auth/strava';
      return;
    }
    cancelSubscription();
  });
}

function renderMethodologyPage(me = { authenticated: false }) {
  const isAuthenticated = Boolean(me.authenticated);
  const dashboardHref = state.demoMode ? '/demo' : '/';
  const focusHref = state.demoMode ? '/demo/focus' : '/focus';
  const accountActions = state.demoMode
    ? `<a class="secondary-button topbar-link" href="${dashboardHref}">Dashboard</a>
        <a class="secondary-button topbar-link" href="${focusHref}">Focus</a>
        <a class="secondary-button topbar-link" href="/">Connect Strava</a>`
    : isAuthenticated
      ? `<a class="secondary-button topbar-link" href="/">Dashboard</a>
          <a class="secondary-button topbar-link" href="/focus">Focus</a>
          <a class="secondary-button topbar-link" href="/billing">Billing</a>
          <button class="icon-button" data-action="logout" title="Log out" aria-label="Log out">${icons.logout}</button>`
      : `<a class="secondary-button topbar-link" href="/">Home</a>
          <a class="secondary-button topbar-link" href="/demo">Demo</a>
          <a class="primary-button topbar-link" href="/auth/strava">${icons.strava}<span>Sign in</span></a>`;

  app.innerHTML = `
    <section class="dashboard methodology-page">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">${icons.timer}</div>
          <div class="brand-text">
            <strong>How it works</strong>
            <span>Training score methodology</span>
          </div>
        </div>
        <div class="topbar-actions">
          ${accountActions}
        </div>
      </header>

      <main class="dashboard-main methodology-main">
        <section class="methodology-hero">
          <p class="eyebrow">Methodology</p>
          <h1>What the numbers mean</h1>
          <p>The app is trying to answer one question first: are you producing more output at the same effort?</p>
        </section>

        <section class="methodology-window-grid" aria-label="Calculation windows">
          ${methodStat('Dashboard trend', '28 days', 'Compares your last 28 days with the 28 days before that.')}
          ${methodStat('Focus plan', '30 days', 'Uses last 30 days versus the previous 30 days for coaching targets.')}
          ${methodStat('Weekly chart', '12 weeks', 'Shows week-by-week volume, Zone 2 performance, HR, and count.')}
        </section>

        <section class="methodology-grid">
          <article class="methodology-card methodology-score-card">
            <span>Trend score</span>
            <h2>-14 to +14</h2>
            <p>The full theoretical range is -14 to +14. Most real scores are smaller because missing HR or Zone 2 data contributes zero.</p>
            <div class="score-scale" aria-label="Trend score scale">
              <div><strong>-2 or lower</strong><span>Deproving</span></div>
              <div><strong>-1 to +1</strong><span>Maintaining</span></div>
              <div><strong>+2 or higher</strong><span>Improving</span></div>
            </div>
          </article>

          <article class="methodology-card">
            <span>Main signal</span>
            <h2>Pace at the same HR</h2>
            <p>Runs and rides are grouped into 5 bpm average-HR bands. If you are faster in the same HR band than you were in the previous block, that is the strongest improvement signal.</p>
          </article>

          <article class="methodology-card">
            <span>Zone 2</span>
            <h2>Easy-effort efficiency</h2>
            <p>Zone 2 is estimated from your highest saved activity HR: 68% to 78% of observed max HR. Zone 2 efficiency is speed divided by average HR for activities in that band.</p>
          </article>

          <article class="methodology-card">
            <span>Volume and rhythm</span>
            <h2>Miles plus frequency</h2>
            <p>Volume is total miles. Frequency is activity count. More volume helps only when effort is controlled; a volume drop can explain why fitness looks flat.</p>
          </article>
        </section>

        <section class="panel methodology-panel">
          <div class="panel-header">
            <div>
              <h2>How the dashboard score is built</h2>
              <span>Last 28 days vs previous 28 days</span>
            </div>
          </div>
          <div class="methodology-factor-grid">
            ${factorCard('Same-HR performance', 'Largest weight', 'Speed or pace improvement at comparable average heart rates.')}
            ${factorCard('Zone 2 efficiency', 'Medium weight', 'Whether easy efforts are producing better output per heartbeat.')}
            ${factorCard('Volume', 'Small weight', 'Total mileage change. Big drops can pull the score down.')}
            ${factorCard('Frequency', 'Small weight', 'Run or ride count change. Consistency matters.')}
            ${factorCard('Longest effort', 'Small weight', 'Whether the long run or ride is progressing.')}
            ${factorCard('HR context', 'Bonus or penalty', 'Extra credit when pace improves without HR rising; penalty when pace slips without HR dropping.')}
          </div>
        </section>

        <section class="panel methodology-panel">
          <div class="panel-header">
            <div>
              <h2>How Focus decides what to fix</h2>
              <span>Last 30 days vs previous 30 days</span>
            </div>
          </div>
          <div class="methodology-rules">
            ${ruleRow('Consistency', 'Volume or frequency dropped more than 10%.')}
            ${ruleRow('Aerobic base', 'Zone 2 efficiency is not improving while volume is not meaningfully down.')}
            ${ruleRow('Fatigue', 'Average HR is rising and pace is not improving.')}
            ${ruleRow('Progress', 'Volume is up and Zone 2 efficiency is up.')}
            ${ruleRow('Maintain', 'None of the above patterns are strong enough yet.')}
          </div>
        </section>

        <section class="panel methodology-panel">
          <div class="panel-header">
            <div>
              <h2>Terms</h2>
              <span>Plain-English definitions</span>
            </div>
          </div>
          <dl class="methodology-terms">
            ${termRow('Aerobic efficiency', 'Speed divided by average HR. Higher means more speed for each heartbeat.')}
            ${termRow('Avg HR trend', 'Moving-time-weighted average heart rate compared with the prior block.')}
            ${termRow('Pace change', 'For running, negative means faster pace. For biking, the app converts speed so negative also means better.')}
            ${termRow('Zone 2 activity', 'An activity whose average HR lands inside the estimated Zone 2 range.')}
            ${termRow('Deproving', 'The app sees a clear negative trend, usually slower output at similar HR, lower efficiency, or a large consistency drop.')}
          </dl>
        </section>

        <section class="methodology-note">
          <strong>Important:</strong>
          <span>This is a coaching signal, not a lab test. Weather, terrain, sleep, heat, devices, and bad HR readings can move the score. The cleaner the HR data and the more history you have, the better the read gets.</span>
        </section>
      </main>
    </section>
  `;

  document.querySelector('[data-action="logout"]')?.addEventListener('click', logout);
}

function methodStat(label, value, copy) {
  return `
    <article class="method-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(copy)}</p>
    </article>
  `;
}

function factorCard(title, weight, copy) {
  return `
    <article class="factor-card">
      <span>${escapeHtml(weight)}</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(copy)}</p>
    </article>
  `;
}

function ruleRow(title, copy) {
  return `
    <article>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(copy)}</p>
    </article>
  `;
}

function termRow(title, copy) {
  return `
    <div>
      <dt>${escapeHtml(title)}</dt>
      <dd>${escapeHtml(copy)}</dd>
    </div>
  `;
}

function renderCheckoutResult(status) {
  const success = status === 'success';
  app.innerHTML = `
    <section class="dashboard billing-page">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">${success ? icons.flame : icons.close}</div>
          <div class="brand-text">
            <strong>${success ? 'Focus Premium' : 'Checkout'}</strong>
            <span>${success ? 'Subscription started' : 'No subscription changes'}</span>
          </div>
        </div>
        <div class="topbar-actions">
          <a class="secondary-button topbar-link" href="/">Dashboard</a>
        </div>
      </header>
      <main class="dashboard-main billing-main">
        <section class="billing-hero result-hero">
          <p class="eyebrow">${success ? 'Success' : 'Canceled'}</p>
          <h1>${success ? "You're upgraded 🎉" : 'Checkout canceled'}</h1>
          <p>${success ? 'Your Focus Premium access will unlock after Stripe confirms the subscription.' : 'You can return anytime to unlock weekly coaching targets.'}</p>
          <a class="primary-button result-button" href="${success ? '/focus' : '/billing'}">${success ? 'Open Focus' : 'Return to billing'}</a>
        </section>
      </main>
    </section>
  `;
}

function getBillingState(me) {
  const athlete = me.athlete || {};
  const dashboardBilling = state.dashboard?.billing || {};
  return {
    subscriptionStatus:
      athlete.stripeSubscriptionStatus || dashboardBilling.subscriptionStatus || null,
    cancelAtPeriodEnd: Boolean(
      athlete.stripeCancelAtPeriodEnd || dashboardBilling.cancelAtPeriodEnd
    ),
    currentPeriodEnd:
      athlete.stripeCurrentPeriodEnd || dashboardBilling.currentPeriodEnd || null
  };
}

function setupMarkup(configStatus) {
  if (!configStatus.browserSetupAllowed) {
    return `
      <ul class="setup-list">
        <li>Browser setup is disabled for this host.</li>
        <li>Set Strava credentials in server environment variables before starting the app.</li>
      </ul>
    `;
  }

  return `
    <form class="setup-form" data-action="save-strava-setup">
      <label>
        <span>Client ID</span>
        <input name="clientId" inputmode="numeric" autocomplete="off" required>
      </label>
      <label>
        <span>Client Secret</span>
        <input name="clientSecret" type="password" autocomplete="off" required>
      </label>
      <label>
        <span>Redirect URI</span>
        <input name="redirectUri" type="url" value="${escapeHtml(configStatus.redirectUri)}" required>
      </label>
      <button class="primary-button" type="submit">${icons.strava}<span>Save and continue</span></button>
    </form>
    <ul class="setup-list">
      <li>Create a Strava API app and set callback domain to <span class="code-chip">localhost</span>.</li>
      <li>Use callback URL <span class="code-chip">${escapeHtml(configStatus.redirectUri)}</span>.</li>
      <li>After this, runners and riders only need the Strava button.</li>
    </ul>
  `;
}

async function saveStravaSetup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const formData = new FormData(form);
  button.disabled = true;
  button.innerHTML = `${icons.sync}<span>Saving</span>`;

  try {
    await api('/api/setup/strava', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        clientId: formData.get('clientId'),
        clientSecret: formData.get('clientSecret'),
        redirectUri: formData.get('redirectUri')
      })
    });
    showToast('Strava app saved. You can sign in now.');
    const configStatus = await api('/api/config/status');
    renderLogin(configStatus, true);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = `${icons.strava}<span>Save and continue</span>`;
  }
}

async function loadDashboard() {
  state.dashboard = await api('/api/dashboard');
  if (!state.dashboard.sports[state.activeSport]?.totalSaved) {
    state.activeSport = state.dashboard.sports.run.totalSaved
      ? 'run'
      : state.dashboard.sports.ride.totalSaved
        ? 'ride'
        : 'run';
  }
  renderCurrentPage();
}

function loadDemoDashboard() {
  state.dashboard = createDemoDashboard();
  state.activeSport = 'run';
  state.chartMetric = 'distanceMiles';
  renderCurrentPage();
}

function renderCurrentPage() {
  if (window.location.pathname === '/focus' || window.location.pathname === '/demo/focus') {
    renderFocusPage(state.dashboard);
    return;
  }
  if (window.location.pathname === '/about' || window.location.pathname === '/demo/about') {
    renderMethodologyPage(state.currentUser || { authenticated: false });
    return;
  }
  if (window.location.pathname === '/billing') {
    renderBillingPage(state.currentUser || { authenticated: true });
    return;
  }
  renderDashboard(state.dashboard);
}

function renderDashboard(data) {
  const sport = data.sports[state.activeSport] || data.sports.run;
  const trend = sport.comparison.trend;
  const last28 = sport.metrics.last28;
  const allTime = sport.metrics.allTime;
  const athleteName = data.athlete?.name || 'Athlete';
  const syncLabel = data.lastSync?.completed_at
    ? `Last sync ${formatDateTime(data.lastSync.completed_at)}`
    : 'Ready to sync';
  const focusHref = state.demoMode ? '/demo/focus' : '/focus';
  const aboutHref = state.demoMode ? '/demo/about' : '/about';
  const accountActions = state.demoMode
    ? '<a class="secondary-button topbar-link" href="/">Connect Strava</a>'
    : `<button class="secondary-button" data-action="sync">${icons.sync}<span>Sync</span></button>
          <button class="icon-button" data-action="logout" title="Log out" aria-label="Log out">${icons.logout}</button>`;

  app.innerHTML = `
    <section class="dashboard">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">${state.activeSport === 'ride' ? icons.bike : icons.miles}</div>
          <div class="brand-text">
            <strong>${escapeHtml(athleteName)}</strong>
            <span>${escapeHtml(syncLabel)}</span>
          </div>
        </div>
        <div class="topbar-actions">
          <div class="sport-switch" role="tablist" aria-label="Sport">
            ${sportTab('run', data.sports.run.totalSaved)}
            ${sportTab('ride', data.sports.ride.totalSaved)}
          </div>
          <a class="secondary-button topbar-link" href="${focusHref}">Focus</a>
          <a class="secondary-button topbar-link" href="${aboutHref}">How it works</a>
          ${state.demoMode ? '' : '<a class="secondary-button topbar-link" href="/billing">Billing</a>'}
          ${accountActions}
        </div>
      </header>

      <main class="dashboard-main">
        <section class="status-band">
          <div class="status-copy">
            <p class="eyebrow">${escapeHtml(sport.label)} trend</p>
            <h1>${escapeHtml(trend.label)}</h1>
            <p>${escapeHtml(trend.summary)}</p>
          </div>
          <aside class="status-card">
            <div>
              <span class="status-pill ${trend.status}">${escapeHtml(trend.label)}</span>
              <div class="status-score">
                <strong>${trend.score}</strong>
                <span>trend score</span>
              </div>
              <p class="zone-note">${escapeHtml(zoneRangeCopy(sport.zone2Range))}</p>
            </div>
            <ul class="insights">
              ${trend.insights.map((insight) => `<li>${escapeHtml(insight)}</li>`).join('')}
            </ul>
          </aside>
        </section>

        <section class="metric-grid">
          ${metricCard('Miles', formatNumber(last28.distanceMiles), 'last 28 days', icons.miles)}
          ${metricCard(zoneMetricLabel(sport.key), zoneMetricValue(sport.key, last28), `${last28.zone2Count} Zone 2 ${sport.activityNounPlural}`, icons.timer)}
          ${metricCard('Avg HR', bpm(last28.avgHeartRate), 'last 28 days', icons.heart)}
          ${metricCard(titleCase(sport.activityNounPlural), formatNumber(last28.activityCount, 0), `${formatNumber(allTime.activityCount, 0)} saved`, sport.key === 'ride' ? icons.bike : icons.flame)}
        </section>

        <section class="content-grid">
          <div>
            <section class="panel">
              <div class="panel-header">
                <div>
                  <h2>Weekly ${escapeHtml(sport.activityNounPlural)}</h2>
                  <span>Last 12 weeks</span>
                </div>
                <div class="chart-tabs" role="tablist" aria-label="Chart metric">
                  ${chartTab('distanceMiles', 'Miles')}
                  ${chartTab('zone2Performance', sport.key === 'run' ? 'Z2 pace' : 'Z2 speed')}
                  ${chartTab('avgHeartRate', 'HR')}
                  ${chartTab('activityCount', titleCase(sport.activityNounPlural))}
                </div>
              </div>
              <div class="chart-wrap">
                <canvas class="chart" id="weeklyChart" width="1200" height="520"></canvas>
                <div class="chart-tooltip is-hidden" id="weeklyTooltip"></div>
                <div class="empty-state is-hidden" id="chartEmpty">Sync Strava to build your weekly graph.</div>
              </div>
            </section>

            <section class="effort-section panel">
              <div class="panel-header">
                <div>
                  <h2>Notable ${escapeHtml(sport.activityNounPlural)}</h2>
                  <span>Saved history</span>
                </div>
              </div>
              <div class="effort-grid">
                ${
                  sport.efforts.length
                    ? sport.efforts.map(effortCard).join('')
                    : '<div class="empty-state">No qualifying activities yet.</div>'
                }
              </div>
            </section>
          </div>

          <aside class="panel">
            <div class="panel-header">
              <div>
                <h2>Recent ${escapeHtml(sport.activityNounPlural)}</h2>
                <span>${sport.totalSaved} saved ${sport.activityNounPlural}</span>
              </div>
            </div>
            <div class="recent-list">
              ${
                sport.recentActivities.length
                  ? sport.recentActivities.map(activityRow).join('')
                  : '<div class="empty-state">No activities saved yet.</div>'
              }
            </div>
          </aside>
        </section>
      </main>
    </section>
  `;

  bindDashboardEvents();
  drawWeeklyChart();
}

function renderFocusPage(data) {
  const sport = data.sports.run;
  const metrics = sport.focusMetrics;
  const focus = getFocus(metrics);
  const diagnosis = getImprovementDiagnosis(metrics, focus);
  const targets = getThisWeekTargets(metrics, focus, diagnosis.status);
  const plan = getPlan(focus, targets, diagnosis.status);
  const oneThing = getOneThing(focus, diagnosis.status);
  const access = getFocusAccess(data);
  diagnosis.fix = access.isLocked
    ? 'Start with the one thing below. Unlock Focus for exact runs, mileage, and long-run targets.'
    : getDiagnosisFix(focus, targets);
  const athleteName = data.athlete?.name || 'Athlete';
  const syncLabel = data.lastSync?.completed_at
    ? `Last sync ${formatDateTime(data.lastSync.completed_at)}`
    : 'Ready to sync';
  const dashboardHref = state.demoMode ? '/demo' : '/';
  const aboutHref = state.demoMode ? '/demo/about' : '/about';
  const accountActions = state.demoMode
    ? '<a class="secondary-button topbar-link" href="/">Connect Strava</a>'
    : `<button class="secondary-button" data-action="sync">${icons.sync}<span>Sync</span></button>
          <button class="icon-button" data-action="logout" title="Log out" aria-label="Log out">${icons.logout}</button>`;

  app.innerHTML = `
    <section class="dashboard focus-page">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">${state.activeSport === 'ride' ? icons.bike : icons.miles}</div>
          <div class="brand-text">
            <strong>${escapeHtml(athleteName)}</strong>
            <span>${escapeHtml(syncLabel)}</span>
          </div>
        </div>
        <div class="topbar-actions">
          ${state.demoMode ? '' : '<a class="secondary-button topbar-link" href="/billing">Billing</a>'}
          <a class="secondary-button topbar-link" href="${aboutHref}">How it works</a>
          <a class="secondary-button topbar-link" href="${dashboardHref}">Dashboard</a>
          ${accountActions}
        </div>
      </header>

      <main class="dashboard-main focus-main">
        <section class="focus-hero">
          <p class="eyebrow">Last 30 days</p>
          <h1>Your Current Focus</h1>
          <h2>${escapeHtml(plan.title)}</h2>
          <p>${escapeHtml(plan.explanation)}</p>
        </section>

        ${access.isDemo ? '<div class="demo-mode-banner">Demo Mode - Focus is a premium feature in the full app</div>' : ''}

        <section class="focus-diagnosis" aria-label="Training diagnosis">
          <article class="focus-answer focus-answer-primary ${escapeHtml(diagnosis.status)}">
            <span>Are you actually improving?</span>
            <strong>${escapeHtml(diagnosis.label)}</strong>
            <p>${escapeHtml(diagnosis.summary)}</p>
          </article>

          <article class="focus-answer">
            <span>Why?</span>
            <p>${escapeHtml(diagnosis.why)}</p>
          </article>

          <article class="focus-answer">
            <span>Fix it</span>
            <p>${escapeHtml(diagnosis.fix)}</p>
          </article>
        </section>

        <section class="focus-grid">
          <article class="panel focus-panel">
            <div class="panel-header">
              <div>
                <h2>Action plan</h2>
                <span>${escapeHtml(sport.label)}</span>
              </div>
            </div>
            <p class="one-thing"><strong>If you do ONE thing:</strong> ${escapeHtml(oneThing)}</p>
            <div class="premium-lock-wrap ${access.isLocked ? 'is-locked' : ''}">
              <div class="${access.isLocked ? 'premium-locked' : ''}">
                <div class="this-week">
                  <span class="this-week-title">THIS WEEK</span>
                  <div class="this-week-grid">
                    ${thisWeekItem('Runs', rangeCopy(targets.runs, 'runs'))}
                    ${thisWeekItem('Total mileage', rangeCopy(targets.mileage, 'miles'))}
                    ${thisWeekItem('Zone 2 target', `${targets.zone2.lower}-${targets.zone2.upper}% of runs`)}
                    ${thisWeekItem('Long run', rangeCopy(targets.longRun, 'miles'))}
                  </div>
                </div>
                <ul class="focus-actions">
                  ${plan.actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('')}
                </ul>
              </div>
              ${access.isLocked ? premiumOverlayMarkup() : ''}
            </div>
          </article>

          <article class="focus-goal">
            <span>Goal</span>
            <strong>${escapeHtml(plan.goal)}</strong>
          </article>
        </section>

        <section class="metric-grid focus-stats">
          ${metricCard('Volume', percent(metrics.volume_change_percent), 'last 30 vs previous 30', icons.miles)}
          ${metricCard('Efficiency', percent(metrics.zone2_efficiency_change_percent), 'Zone 2 efficiency', icons.timer)}
          ${metricCard('HR trend', percent(metrics.avg_hr_change), 'average HR change', icons.heart)}
          ${metricCard('30 days', `${formatNumber(metrics.total_miles_30d)} mi`, `${metrics.total_runs_30d} ${sport.activityNounPlural}`, sport.key === 'ride' ? icons.bike : icons.flame)}
        </section>
      </main>
    </section>
  `;

  bindFocusEvents();
}

function bindFocusEvents() {
  document.querySelector('[data-action="sync"]')?.addEventListener('click', sync);
  document.querySelector('[data-action="logout"]')?.addEventListener('click', logout);
  document
    .querySelector('[data-action="upgrade-focus"]')
    ?.addEventListener('click', () => {
      window.location.href = '/billing';
    });
}

function getFocusAccess(data) {
  const appMode = state.demoMode ? 'demo' : data.appMode || 'live';
  const isPremium = Boolean(data.isPremium);
  return {
    appMode,
    isPremium,
    isDemo: appMode === 'demo',
    isLocked: appMode === 'live' && !isPremium
  };
}

function premiumOverlayMarkup() {
  return `
    <div class="premium-overlay">
      <div class="premium-overlay-card">
        <h3>Unlock weekly coaching targets</h3>
        <p>Get exact runs, mileage, and Zone 2 targets based on your training.</p>
        <button class="primary-button" data-action="upgrade-focus" type="button">Upgrade now</button>
      </div>
    </div>
  `;
}

function showPremiumRecapModal() {
  closePremiumRecapModal();
  document.body.insertAdjacentHTML(
    'beforeend',
    `
      <div class="premium-modal-overlay" data-action="close-premium-recap">
        <section class="premium-modal" role="dialog" aria-modal="true" aria-label="Unlock Focus">
          <button class="icon-button" data-action="close-premium-recap-button" type="button" title="Close" aria-label="Close">${icons.close}</button>
          <span>Focus Premium</span>
          <h2>Unlock weekly coaching targets</h2>
          <ul>
            <li>Weekly run count, mileage, and long-run targets</li>
            <li>Personalized recommendations from your latest training block</li>
            <li>Progress tracking that explains what to fix next</li>
          </ul>
          <button class="primary-button" data-action="premium-checkout" type="button">Continue to checkout</button>
        </section>
      </div>
    `
  );

  document
    .querySelector('[data-action="close-premium-recap"]')
    ?.addEventListener('click', (event) => {
      if (event.target.dataset.action === 'close-premium-recap') {
        closePremiumRecapModal();
      }
    });
  document
    .querySelector('[data-action="close-premium-recap-button"]')
    ?.addEventListener('click', closePremiumRecapModal);
  document.querySelector('[data-action="premium-checkout"]')?.addEventListener('click', () => {
    startCheckout();
  });
}

function closePremiumRecapModal() {
  document.querySelector('.premium-modal-overlay')?.remove();
}

function getFocus(metrics) {
  if (
    metrics.volume_change_percent < -10 ||
    metrics.run_frequency_change_percent < -10
  ) {
    return 'consistency';
  }
  if (
    metrics.zone2_efficiency_change_percent <= 0 &&
    metrics.volume_change_percent >= -5
  ) {
    return 'aerobic_base';
  }
  if (metrics.avg_hr_change > 0 && metrics.avg_pace_change >= 0) {
    return 'fatigue';
  }
  if (
    metrics.volume_change_percent > 0 &&
    metrics.zone2_efficiency_change_percent > 0
  ) {
    return 'progress';
  }
  return 'maintain';
}

function getPlan(focus, targets, status) {
  const runRange = rangeCopy(targets.runs, 'times');
  const mileageRange = rangeCopy(targets.mileage, 'miles');
  const longRunRange = rangeCopy(targets.longRun, 'miles');
  const increaseRange = rangeCopy(targets.mileageIncrease, 'miles');
  const plans = {
    consistency: {
      title: 'Increase consistency',
      explanation:
        'Your fitness is there, but the training rhythm slipped. Rebuild the week first.',
      actions: [
        `Run ${runRange} this week`,
        `Keep total mileage between ${mileageRange}`,
        `Keep the long run between ${longRunRange}`,
        'Avoid gaps longer than 2 days',
        `Keep ${targets.zone2.lower}-${targets.zone2.upper}% of runs in Zone 2`
      ],
      goal: 'Return to consistent weekly training'
    },
    aerobic_base: {
      title: 'Build aerobic base',
      explanation: 'Easy effort is not turning into better pace yet. Keep the work controlled.',
      actions: [
        `Run ${runRange} this week`,
        `Hold total mileage between ${mileageRange}`,
        `Keep ${targets.zone2.lower}-${targets.zone2.upper}% of runs in Zone 2`,
        `Keep the long run between ${longRunRange}`,
        'Skip hard efforts this week'
      ],
      goal: 'Improve pace at the same heart rate'
    },
    fatigue: {
      title: 'Reduce fatigue',
      explanation: 'Heart rate is rising without pace gains. Absorb the work before adding more.',
      actions: [
        `Run ${runRange} this week`,
        `Cap total mileage at ${mileageRange}`,
        `Keep the long run between ${longRunRange}`,
        'Take 1-2 full recovery days',
        'Avoid back-to-back hard efforts'
      ],
      goal: 'Lower heart rate at the same pace'
    },
    progress: {
      title: 'Keep building',
      explanation: 'You are improving. Add a small amount of volume and keep the easy work easy.',
      actions: [
        `Increase weekly mileage by ${increaseRange}`,
        `Run ${runRange} this week`,
        `Keep the long run between ${longRunRange}`,
        `Keep ${targets.zone2.lower}-${targets.zone2.upper}% of runs in Zone 2`
      ],
      goal: 'Continue progression without burnout'
    },
    maintain: {
      title: 'Maintain fitness',
      explanation:
        status === 'declining'
          ? 'The trend is soft. Keep the week simple and finish fresh.'
          : 'Your training is stable. Hold the structure and add one small progression.',
      actions: [
        `Run ${runRange} this week`,
        `Keep total mileage between ${mileageRange}`,
        `Keep the long run between ${longRunRange}`,
        'Add one small progression: 10-15 minutes steady or 1 extra easy mile'
      ],
      goal: 'Move from maintenance to improvement'
    }
  };
  return plans[focus] || plans.maintain;
}

function getImprovementDiagnosis(metrics, focus) {
  const volumeChange = safeMetric(metrics.volume_change_percent);
  const frequencyChange = safeMetric(metrics.run_frequency_change_percent);
  const efficiencyChange = safeMetric(metrics.zone2_efficiency_change_percent);
  const hrChange = safeMetric(metrics.avg_hr_change);
  const paceChange = safeMetric(metrics.avg_pace_change);

  const fatiguePattern = hrChange > 0.5 && paceChange >= 0;
  const clearEfficiencyDrop = efficiencyChange < -0.5 && paceChange > 0.5;
  const efficiencyImproved = efficiencyChange > 0.5;
  const paceImproved = paceChange < -0.5;
  const hrIsStableOrLower = hrChange <= 0.5;

  let status = 'flat';
  if (fatiguePattern || clearEfficiencyDrop) {
    status = 'declining';
  } else if (
    focus === 'progress' ||
    (efficiencyImproved && (paceImproved || hrIsStableOrLower)) ||
    (paceImproved && hrIsStableOrLower)
  ) {
    status = 'improving';
  }

  const labels = {
    improving: 'Improving',
    declining: 'Declining',
    flat: 'Flat'
  };

  const summaries = {
    improving:
      'You are getting more output without paying for it in heart rate.',
    declining:
      'Heart rate is up and pace is not better. Treat this as fatigue first.',
    flat: 'You are holding fitness. This week needs consistency, not hero work.'
  };

  return {
    status,
    label: labels[status],
    summary: summaries[status],
    why: getDiagnosisWhy(metrics, status, focus),
    fix: ''
  };
}

function getDiagnosisWhy(metrics, status, focus) {
  const volumeChange = safeMetric(metrics.volume_change_percent);
  const frequencyChange = safeMetric(metrics.run_frequency_change_percent);
  const efficiencyChange = safeMetric(metrics.zone2_efficiency_change_percent);
  const hrChange = safeMetric(metrics.avg_hr_change);
  const paceChange = safeMetric(metrics.avg_pace_change);
  const blockers = [];
  const positives = [];

  if (efficiencyChange > 0) {
    positives.push(`Zone 2 efficiency improved ${absolutePercent(efficiencyChange)}`);
  }
  if (paceChange < 0) {
    positives.push(`pace improved ${absolutePercent(paceChange)}`);
  }
  if (hrChange < 0) {
    positives.push(`HR dropped ${absolutePercent(hrChange)}`);
  }
  if (volumeChange < -10) {
    blockers.push(`volume dropped ${absolutePercent(volumeChange)}`);
  }
  if (frequencyChange < -10) {
    blockers.push(`frequency dropped ${absolutePercent(frequencyChange)}`);
  }

  if (status === 'declining') {
    if (hrChange > 0.5 && paceChange >= 0) {
      return `HR rose ${absolutePercent(hrChange)} and pace did not improve. Back off intensity and rebuild frequency.`;
    }
    if (efficiencyChange < 0 && paceChange > 0) {
      return `Zone 2 efficiency dropped ${absolutePercent(efficiencyChange)} and pace slowed ${absolutePercent(paceChange)}. Keep the week easy.`;
    }
    return 'The trend softened. Rebuild frequency before adding intensity.';
  }
  if (blockers.length > 0 && positives.length > 0) {
    return `${capitalize(joinCopy(positives))}. ${capitalize(joinCopy(blockers))}, so the limiter is consistency.`;
  }
  if (blockers.length > 0) {
    return `${capitalize(joinCopy(blockers))}. Run frequency is the first fix.`;
  }
  if (focus === 'aerobic_base') {
    return `Zone 2 efficiency is ${percent(efficiencyChange)}. Easy runs are not producing better pace yet.`;
  }
  if (status === 'improving') {
    return `${capitalize(joinCopy(positives))}. You are producing better output at lower effort.`;
  }
  return `Volume is ${percent(volumeChange)}, Zone 2 efficiency is ${percent(efficiencyChange)}, and HR is ${percent(hrChange)}. Stable, but not moving yet.`;
}

function getDiagnosisFix(focus, targets) {
  const runRange = rangeCopy(targets.runs, 'runs');
  const mileageRange = rangeCopy(targets.mileage, 'miles');
  const longRunRange = rangeCopy(targets.longRun, 'miles');
  const fixes = {
    consistency:
      `Run ${runRange}, keep mileage at ${mileageRange}, and do not miss more than 2 days in a row.`,
    aerobic_base:
      `Run ${runRange}, keep ${targets.zone2.lower}-${targets.zone2.upper}% in Zone 2, and hold mileage at ${mileageRange}.`,
    fatigue:
      `Run ${runRange}, cap mileage at ${mileageRange}, and take 1-2 recovery days.`,
    progress:
      `Add ${rangeCopy(targets.mileageIncrease, 'miles')}, keep the long run ${longRunRange}, and keep ${targets.zone2.lower}-${targets.zone2.upper}% in Zone 2.`,
    maintain:
      `Run ${runRange}, keep mileage at ${mileageRange}, and add one small progression.`
  };

  return fixes[focus] || fixes.maintain;
}

function getThisWeekTargets(metrics, focus, status) {
  const totalMiles = Math.max(0, safeMetric(metrics.total_miles_30d));
  const totalRuns = Math.max(0, safeMetric(metrics.total_runs_30d));
  const baseMiles = totalMiles > 0 ? (totalMiles / 30) * 7 : 10;
  const baseRuns = totalRuns > 0 ? (totalRuns / 30) * 7 : 3;
  const increase = mileageIncreaseRange(baseMiles);
  let runs;
  let mileage;

  if (focus === 'fatigue') {
    const lower = clamp(Math.floor(baseRuns) - 1, 2, 4);
    runs = normalizeRange(lower, clamp(Math.round(baseRuns), lower, 5));
    mileage = normalizeRange(
      Math.max(4, Math.round(baseMiles * 0.75)),
      Math.max(5, Math.round(baseMiles * 0.9))
    );
  } else if (focus === 'consistency' || status === 'declining') {
    const lower = clamp(Math.max(3, Math.ceil(baseRuns)), 3, 5);
    runs = normalizeRange(lower, clamp(lower + 1, lower, 5));
    mileage = normalizeRange(
      Math.max(6, Math.round(baseMiles * 0.9)),
      Math.max(8, Math.round(baseMiles * 1.05))
    );
  } else if (focus === 'progress' || status === 'improving') {
    const lower = clamp(Math.max(3, Math.round(baseRuns)), 3, 5);
    runs = normalizeRange(lower, clamp(lower + 1, lower, 6));
    mileage = normalizeRange(
      Math.round(baseMiles + increase.lower),
      Math.round(baseMiles + increase.upper)
    );
  } else {
    const lower = clamp(Math.max(3, Math.round(baseRuns)), 3, 5);
    runs = normalizeRange(lower, clamp(lower + 1, lower, 5));
    mileage = normalizeRange(
      Math.max(6, Math.round(baseMiles)),
      Math.max(8, Math.round(baseMiles + Math.min(3, Math.max(1, baseMiles * 0.08))))
    );
  }

  const longRun = longRunRange(mileage, focus);

  return {
    runs,
    mileage,
    mileageIncrease: increase,
    zone2: {
      lower: 70,
      upper: 85
    },
    longRun
  };
}

function getOneThing(focus, status) {
  if (focus === 'fatigue') {
    return 'take one full recovery day before the next hard effort.';
  }
  if (status === 'declining' || focus === 'consistency') {
    return 'hit the run count target, even if every run is short and easy.';
  }
  if (status === 'improving') {
    return 'repeat the structure and keep the easy runs easy.';
  }
  if (focus === 'aerobic_base') {
    return 'keep every run under the top of Zone 2.';
  }
  return 'hit the mileage range before chasing pace.';
}

function thisWeekItem(label, value) {
  return `
    <div class="this-week-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function mileageIncreaseRange(baseMiles) {
  if (baseMiles < 10) {
    return {
      lower: 1,
      upper: 2
    };
  }
  if (baseMiles < 20) {
    return {
      lower: 2,
      upper: 3
    };
  }
  return {
    lower: 2,
    upper: 4
  };
}

function longRunRange(mileage, focus) {
  const lowerFactor = focus === 'fatigue' ? 0.22 : 0.27;
  const upperFactor = focus === 'fatigue' ? 0.3 : 0.35;
  return normalizeRange(
    Math.max(3, Math.round(mileage.lower * lowerFactor)),
    Math.max(4, Math.round(mileage.upper * upperFactor))
  );
}

function rangeCopy(range, unit) {
  const lower = compactNumber(range.lower);
  const upper = compactNumber(range.upper);
  if (lower === upper) {
    return `${lower} ${unit}`;
  }
  return `${lower}-${upper} ${unit}`;
}

function normalizeRange(lower, upper) {
  const safeLower = Math.max(0, Math.round(lower));
  const safeUpper = Math.max(safeLower, Math.round(upper));
  return {
    lower: safeLower,
    upper: safeUpper
  };
}

function compactNumber(value) {
  return Number.isInteger(value) ? String(value) : formatNumber(value, 1);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function safeMetric(value) {
  return Number.isFinite(value) ? value : 0;
}

function absolutePercent(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return `${formatNumber(Math.abs(value), 1)}%`;
}

function joinCopy(parts) {
  if (parts.length <= 1) {
    return parts[0] || '';
  }
  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}

function capitalize(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function bindDashboardEvents() {
  document.querySelector('[data-action="sync"]')?.addEventListener('click', sync);
  document.querySelector('[data-action="logout"]')?.addEventListener('click', logout);
  document.querySelectorAll('[data-sport]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeSport = button.dataset.sport;
      state.chartMetric = 'distanceMiles';
      renderDashboard(state.dashboard);
    });
  });
  document.querySelectorAll('.chart-tab').forEach((button) => {
    button.addEventListener('click', () => {
      state.chartMetric = button.dataset.metric;
      document.querySelectorAll('.chart-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.metric === state.chartMetric);
      });
      drawWeeklyChart();
    });
  });
  document.querySelectorAll('[data-activity-id]').forEach((button) => {
    button.addEventListener('click', () => openActivity(button.dataset.activityId));
  });
}

async function sync() {
  const button = document.querySelector('[data-action="sync"]');
  button.disabled = true;
  button.innerHTML = `${icons.sync}<span>Syncing</span>`;
  try {
    const result = await api('/api/sync', { method: 'POST' });
    showToast(`Synced ${result.activityCount} activities from Strava.`);
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function startCheckout() {
  const button = document.querySelector('[data-action="checkout"], [data-action="premium-checkout"]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Opening Stripe...';
  }

  try {
    const result = await api('/api/checkout', { method: 'POST' });
    if (!result.url) {
      throw new Error('Stripe did not return a checkout URL.');
    }
    window.location.href = result.url;
  } catch (error) {
    showToast(error.message);
    if (button) {
      button.disabled = false;
      button.textContent = 'Unlock Focus - $5/month';
    }
  }
}

async function openBillingPortal() {
  const button = document.querySelector('[data-action="billing-portal"]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Opening Stripe...';
  }

  try {
    const result = await api('/api/billing-portal', { method: 'POST' });
    if (!result.url) {
      throw new Error('Stripe did not return a billing portal URL.');
    }
    window.location.href = result.url;
  } catch (error) {
    showToast(error.message);
    if (button) {
      button.disabled = false;
      button.textContent = 'Manage subscription';
    }
  }
}

async function cancelSubscription() {
  if (
    !window.confirm(
      'Cancel Focus Premium at the end of the current billing period? You will keep access until then.'
    )
  ) {
    return;
  }

  const button = document.querySelector('[data-action="cancel-subscription"]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Canceling...';
  }

  try {
    const result = await api('/api/cancel-subscription', { method: 'POST' });
    showToast(
      result.currentPeriodEnd
        ? `Cancellation scheduled for ${formatUnixDate(result.currentPeriodEnd)}.`
        : 'Cancellation scheduled.'
    );
    const me = await api('/api/me');
    state.currentUser = me;
    renderBillingPage(me);
  } catch (error) {
    showToast(error.message);
    if (button) {
      button.disabled = false;
      button.textContent = 'Cancel subscription';
    }
  }
}

async function logout() {
  await api('/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

async function openActivity(activityId) {
  renderActivityDrawerLoading();
  try {
    const detail = state.demoMode
      ? getDemoActivityDetail(activityId)
      : await api(`/api/activities/${activityId}`);
    renderActivityDrawer(detail);
  } catch (error) {
    closeActivityDrawer();
    showToast(error.message);
  }
}

function renderActivityDrawerLoading() {
  closeActivityDrawer();
  document.body.insertAdjacentHTML(
    'beforeend',
    `
      <div class="detail-overlay">
        <aside class="detail-panel">
          <div class="detail-loading">Loading activity detail...</div>
        </aside>
      </div>
    `
  );
}

function renderActivityDrawer(detail) {
  const activity = detail.activity;
  const sport = detail.activity.category;
  const route = detail.route.length
    ? detail.route
    : decodePolyline(activity.map.polyline || activity.map.summaryPolyline);
  const hasSamples = detail.samples.length > 0;

  closeActivityDrawer();
  document.body.insertAdjacentHTML(
    'beforeend',
    `
      <div class="detail-overlay" data-action="close-detail">
        <aside class="detail-panel" role="dialog" aria-modal="true" aria-label="Activity detail">
          <header class="detail-header">
            <div>
              <p class="eyebrow">${escapeHtml(activity.sportType)}</p>
              <h2>${escapeHtml(activity.name)}</h2>
              <span>${formatDate(activity.date)} &middot; ${formatNumber(activity.distanceMiles)} mi &middot; ${formatDuration(activity.movingTimeSeconds)}</span>
              ${activity.location ? `<span>${escapeHtml(activity.location)}</span>` : ''}
            </div>
            <button class="icon-button" data-action="close-detail-button" title="Close" aria-label="Close">${icons.close}</button>
          </header>

          <section class="detail-metrics">
            ${detailMetric('Pace', sport === 'run' ? formatPace(activity.paceSecondsPerMile) : `${formatNumber(activity.speedMph)} mph`)}
            ${detailMetric('Avg HR', bpm(activity.averageHeartRate))}
            ${detailMetric('Max HR', bpm(activity.maxHeartRate))}
            ${detailMetric('Elevation', `${formatNumber(activity.elevationFeet, 0)} ft`)}
            ${detailMetric('Cadence', formatCadence(activity))}
            ${detailMetric('Power', activity.averageWatts ? `${formatNumber(activity.averageWatts, 0)} W` : '-')}
          </section>

          <section class="detail-grid">
            <div class="detail-block">
              <div class="detail-block-header">
                <h3>Route</h3>
                <span>${escapeHtml(activity.location || (route.length ? `${route.length} points` : 'No GPS stream'))}</span>
              </div>
              <canvas class="route-canvas" id="routeCanvas" width="900" height="420"></canvas>
              <div class="map-attribution">Map tiles by OpenStreetMap contributors</div>
            </div>

            <div class="detail-block">
              <div class="detail-block-header">
                <h3>Heart rate</h3>
                <span>Average ${bpm(activity.averageHeartRate)}</span>
              </div>
              <canvas class="detail-chart" id="hrDetailChart" width="900" height="300"></canvas>
            </div>
          </section>

          <section class="detail-grid">
            <div class="detail-block">
              <div class="detail-block-header">
                <h3>${sport === 'run' ? 'Pace' : 'Speed'}</h3>
                <span>${hasSamples ? 'Stream data' : 'No stream data'}</span>
              </div>
              <canvas class="detail-chart" id="performanceDetailChart" width="900" height="300"></canvas>
            </div>
            <div class="detail-block detail-notes">
              <div class="detail-block-header">
                <h3>Activity notes</h3>
                <span>${escapeHtml(detail.source)}</span>
              </div>
              <p>${activity.description ? escapeHtml(activity.description) : 'No Strava description saved for this activity.'}</p>
              <p>${activity.deviceName ? `Device: ${escapeHtml(activity.deviceName)}` : ''}</p>
              <p>${activity.gearName ? `Gear: ${escapeHtml(activity.gearName)}` : ''}</p>
            </div>
          </section>
        </aside>
      </div>
    `
  );

  document
    .querySelector('[data-action="close-detail"]')
    .addEventListener('click', (event) => {
      if (event.target.dataset.action === 'close-detail') {
        closeActivityDrawer();
      }
    });
  document
    .querySelector('[data-action="close-detail-button"]')
    .addEventListener('click', closeActivityDrawer);

  requestAnimationFrame(() => {
    drawRouteMap(route);
    drawDetailLineChart(
      'hrDetailChart',
      detail.samples.map((sample) => sample.heartRate),
      {
        label: 'bpm',
        color: '#c2414a'
      }
    );
    drawDetailLineChart(
      'performanceDetailChart',
      detail.samples.map((sample) =>
        sport === 'run' ? sample.paceSecondsPerMile : sample.speedMph
      ),
      {
        label: sport === 'run' ? 'pace' : 'mph',
        color: '#2967b1',
        formatter: sport === 'run' ? formatPace : (value) => formatNumber(value, 1)
      }
    );
  });
}

function closeActivityDrawer() {
  document.querySelector('.detail-overlay')?.remove();
}

function drawWeeklyChart() {
  const canvas = document.querySelector('#weeklyChart');
  const empty = document.querySelector('#chartEmpty');
  const tooltip = document.querySelector('#weeklyTooltip');
  if (!canvas || !empty) {
    return;
  }
  const sport = state.dashboard.sports[state.activeSport] || state.dashboard.sports.run;
  const weekly = sport.weekly || [];
  const values = weekly.map((week) => chartValue(week, sport.key));
  const hasData = values.some((value) => Number(value) > 0);
  canvas.classList.toggle('is-hidden', !hasData);
  empty.classList.toggle('is-hidden', hasData);
  if (!hasData) {
    hideWeeklyTooltip(tooltip);
    canvas.onpointermove = null;
    canvas.onpointerleave = null;
    return;
  }

  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.scale(ratio, ratio);

  const width = rect.width;
  const height = rect.height;
  const padding = {
    top: 24,
    right: 24,
    bottom: 54,
    left: 58
  };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...values.filter(Number.isFinite), 1);
  const minValue =
    state.chartMetric === 'zone2Performance' && sport.key === 'run'
      ? Math.min(...values.filter((value) => Number.isFinite(value) && value > 0))
      : 0;
  const range = Math.max(maxValue - minValue, 1);
  const stepX = weekly.length > 1 ? chartWidth / (weekly.length - 1) : chartWidth;
  const points = values.map((value, index) => ({
    x: padding.left + index * stepX,
    y:
      padding.top +
      chartHeight -
      ((Math.max(value || 0, minValue) - minValue) / range) * chartHeight,
    value,
    label: weekly[index].label,
    week: weekly[index]
  }));

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height, padding, chartHeight, minValue, maxValue, sport.key);

  const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  gradient.addColorStop(0, 'rgba(252, 76, 2, 0.22)');
  gradient.addColorStop(1, 'rgba(41, 103, 177, 0.03)');

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.lineTo(points[points.length - 1].x, height - padding.bottom);
  ctx.lineTo(points[0].x, height - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.strokeStyle = '#fc4c02';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  points.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#fc4c02';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  ctx.fillStyle = '#626b75';
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  points.forEach((point, index) => {
    if (index % 2 === 0 || width > 760) {
      ctx.fillText(point.label, point.x, height - 22);
    }
  });

  ctx.textAlign = 'right';
  ctx.fillStyle = '#15171a';
  ctx.font = '700 13px Inter, system-ui, sans-serif';
  ctx.fillText(chartTitle(sport.key), width - padding.right, padding.top + 6);

  bindWeeklyTooltip(canvas, tooltip, points, sport.key, stepX);
}

function bindWeeklyTooltip(canvas, tooltip, points, sport, stepX) {
  if (!tooltip) {
    return;
  }

  canvas.onpointermove = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nearest = nearestPoint(points, x, y);
    const hitRadius = Math.max(14, Math.min(28, stepX * 0.32));

    if (!nearest || nearest.distance > hitRadius) {
      canvas.style.cursor = 'default';
      hideWeeklyTooltip(tooltip);
      return;
    }

    canvas.style.cursor = 'pointer';
    showWeeklyTooltip(tooltip, nearest.point, sport, rect);
  };

  canvas.onpointerleave = () => {
    canvas.style.cursor = 'default';
    hideWeeklyTooltip(tooltip);
  };
}

function nearestPoint(points, x, y) {
  return points.reduce(
    (best, point) => {
      const distance = Math.hypot(point.x - x, point.y - y);
      return distance < best.distance ? { point, distance } : best;
    },
    { point: null, distance: Number.POSITIVE_INFINITY }
  );
}

function showWeeklyTooltip(tooltip, point, sport, rect) {
  tooltip.innerHTML = weeklyTooltipHtml(point.week, sport);
  tooltip.classList.remove('is-hidden');

  const margin = 10;
  const tooltipWidth = tooltip.offsetWidth;
  const tooltipHeight = tooltip.offsetHeight;
  let left = point.x + 14;
  let top = point.y - tooltipHeight - 14;

  if (left + tooltipWidth > rect.width - margin) {
    left = point.x - tooltipWidth - 14;
  }
  if (top < margin) {
    top = point.y + 14;
  }
  if (left < margin) {
    left = margin;
  }

  tooltip.style.left = `${left}px`;
  const maxTop = Math.max(margin, rect.height - tooltipHeight - margin);
  tooltip.style.top = `${Math.min(Math.max(top, margin), maxTop)}px`;
}

function hideWeeklyTooltip(tooltip) {
  tooltip?.classList.add('is-hidden');
}

function weeklyTooltipHtml(week, sport) {
  const activityLabel = sport === 'run' ? 'Runs' : 'Rides';
  const zoneLabel = sport === 'run' ? 'Z2 pace' : 'Z2 speed';
  const zoneValue =
    sport === 'run'
      ? formatPace(week.zone2PaceSecondsPerMile)
      : week.zone2SpeedMph
        ? `${formatNumber(week.zone2SpeedMph, 1)} mph`
        : '-';

  return `
    <strong>${escapeHtml(week.label)}</strong>
    <div><span>Miles</span><b>${escapeHtml(formatNumber(week.distanceMiles, 1))} mi</b></div>
    <div><span>${escapeHtml(zoneLabel)}</span><b>${escapeHtml(zoneValue)}</b></div>
    <div><span>Avg HR</span><b>${escapeHtml(bpm(week.avgHeartRate))}</b></div>
    <div><span>${escapeHtml(activityLabel)}</span><b>${escapeHtml(formatNumber(week.activityCount, 0))}</b></div>
  `;
}

function drawGrid(ctx, width, height, padding, chartHeight, minValue, maxValue, sport) {
  ctx.strokeStyle = '#e7ebef';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#626b75';
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + (chartHeight / 4) * index;
    const value = maxValue - ((maxValue - minValue) / 4) * index;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(formatChartValue(value, sport), padding.left - 12, y + 4);
  }
  ctx.strokeStyle = '#dce2e8';
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();
}

async function drawRouteMap(route) {
  const canvas = document.querySelector('#routeCanvas');
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.scale(ratio, ratio);

  const width = rect.width;
  const height = rect.height;
  ctx.fillStyle = '#eef2f5';
  ctx.fillRect(0, 0, width, height);

  if (!route.length) {
    ctx.fillStyle = '#626b75';
    ctx.font = '700 14px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No route stream available', width / 2, height / 2);
    return;
  }

  const lats = route.map((point) => point[0]);
  const lngs = route.map((point) => point[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const zoom = chooseRouteZoom(
    { minLat, maxLat, minLng, maxLng },
    width,
    height
  );
  const center = {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2
  };
  const centerPixel = latLngToPixel(center.lat, center.lng, zoom);
  const topLeft = {
    x: centerPixel.x - width / 2,
    y: centerPixel.y - height / 2
  };
  const tileSize = 256;
  const tileCount = 2 ** zoom;
  const minTileX = Math.floor(topLeft.x / tileSize);
  const maxTileX = Math.floor((topLeft.x + width) / tileSize);
  const minTileY = Math.max(0, Math.floor(topLeft.y / tileSize));
  const maxTileY = Math.min(
    tileCount - 1,
    Math.floor((topLeft.y + height) / tileSize)
  );

  const tileTasks = [];
  for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;
      const x = tileX * tileSize - topLeft.x;
      const y = tileY * tileSize - topLeft.y;
      tileTasks.push(
        loadMapTile(
          `https://tile.openstreetmap.org/${zoom}/${wrappedTileX}/${tileY}.png`
        )
          .then((image) => {
            ctx.drawImage(image, x, y, tileSize, tileSize);
          })
          .catch(() => null)
      );
    }
  }

  await Promise.all(tileTasks);
  drawRouteLine(ctx, route, zoom, topLeft, width, height);
}

function drawRouteLine(ctx, route, zoom, topLeft, width, height) {
  const points = route.map((point) => {
    const pixel = latLngToPixel(point[0], point[1], zoom);
    return {
      x: pixel.x - topLeft.x,
      y: pixel.y - topLeft.y
    };
  });

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = 8;
  ctx.stroke();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.strokeStyle = '#fc4c02';
  ctx.lineWidth = 4;
  ctx.stroke();

  const start = points[0];
  const end = points[points.length - 1];
  drawMapDot(ctx, start.x, start.y, '#157f5b');
  drawMapDot(ctx, end.x, end.y, '#c2414a');

  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.fillRect(8, height - 28, 214, 20);
  ctx.fillStyle = '#15171a';
  ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('OpenStreetMap', 14, height - 14);
  ctx.restore();
}

function drawMapDot(ctx, x, y, color) {
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function chooseRouteZoom(bounds, width, height) {
  for (let zoom = 17; zoom >= 4; zoom -= 1) {
    const nw = latLngToPixel(bounds.maxLat, bounds.minLng, zoom);
    const se = latLngToPixel(bounds.minLat, bounds.maxLng, zoom);
    if (
      Math.abs(se.x - nw.x) <= width * 0.78 &&
      Math.abs(se.y - nw.y) <= height * 0.78
    ) {
      return zoom;
    }
  }
  return 4;
}

function latLngToPixel(lat, lng, zoom) {
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const scale = 256 * 2 ** zoom;
  return {
    x: ((lng + 180) / 360) * scale,
    y:
      (0.5 -
        Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) *
      scale
  };
}

function loadMapTile(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.referrerPolicy = 'no-referrer';
    image.src = url;
  });
}

function drawDetailLineChart(canvasId, values, options) {
  const canvas = document.querySelector(`#${canvasId}`);
  if (!canvas) {
    return;
  }
  const cleanValues = values.filter((value) => Number.isFinite(value) && value > 0);
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.scale(ratio, ratio);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, rect.width, rect.height);

  if (cleanValues.length < 2) {
    ctx.fillStyle = '#626b75';
    ctx.font = '700 14px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No stream data available', rect.width / 2, rect.height / 2);
    return;
  }

  const padding = {
    top: 20,
    right: 20,
    bottom: 30,
    left: 52
  };
  const max = Math.max(...cleanValues);
  const min = Math.min(...cleanValues);
  const range = Math.max(max - min, 1);
  const chartWidth = rect.width - padding.left - padding.right;
  const chartHeight = rect.height - padding.top - padding.bottom;
  const stepX = chartWidth / (cleanValues.length - 1);

  ctx.strokeStyle = '#e7ebef';
  ctx.lineWidth = 1;
  for (let index = 0; index <= 3; index += 1) {
    const y = padding.top + (chartHeight / 3) * index;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(rect.width - padding.right, y);
    ctx.stroke();
  }

  ctx.beginPath();
  cleanValues.forEach((value, index) => {
    const x = padding.left + index * stepX;
    const y = padding.top + chartHeight - ((value - min) / range) * chartHeight;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.strokeStyle = options.color;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  const formatter = options.formatter || ((value) => formatNumber(value, 0));
  ctx.fillStyle = '#626b75';
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(formatter(max), padding.left - 10, padding.top + 5);
  ctx.fillText(formatter(min), padding.left - 10, rect.height - padding.bottom);
  ctx.textAlign = 'left';
  ctx.fillText(options.label, padding.left, rect.height - 9);
}

function sportTab(key, count) {
  const active = key === state.activeSport;
  const label = key === 'ride' ? 'Bike' : 'Run';
  return `<button class="sport-tab ${active ? 'active' : ''}" data-sport="${key}" role="tab">${label}<span>${count}</span></button>`;
}

function chartTab(metric, label) {
  return `<button class="chart-tab ${metric === state.chartMetric ? 'active' : ''}" data-metric="${metric}" role="tab">${label}</button>`;
}

function chartValue(week, sport) {
  if (state.chartMetric === 'zone2Performance') {
    return sport === 'run'
      ? Number(week.zone2PaceSecondsPerMile) || 0
      : Number(week.zone2SpeedMph) || 0;
  }
  return Number(week[state.chartMetric]) || 0;
}

function chartTitle(sport) {
  if (state.chartMetric === 'zone2Performance') {
    return sport === 'run' ? 'Zone 2 pace' : 'Zone 2 speed';
  }
  if (state.chartMetric === 'avgHeartRate') {
    return 'Average HR';
  }
  if (state.chartMetric === 'activityCount') {
    return 'Activities per week';
  }
  return 'Miles per week';
}

function formatChartValue(value, sport) {
  if (state.chartMetric === 'zone2Performance' && sport === 'run') {
    return formatPace(value);
  }
  if (state.chartMetric === 'avgHeartRate') {
    return `${Math.round(value)}`;
  }
  return String(Math.round(value * 10) / 10);
}

function metricCard(label, value, context, icon) {
  return `
    <article class="metric-card">
      <span>${icon}${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <small>${escapeHtml(context)}</small>
    </article>
  `;
}

function effortCard(effort) {
  return `
    <article class="effort-card">
      <h3>${escapeHtml(effort.label)}</h3>
      <p>${escapeHtml(effort.sub)}</p>
      <strong>${escapeHtml(effort.value)}</strong>
    </article>
  `;
}

function activityRow(activity) {
  const performance =
    activity.category === 'run'
      ? formatPace(activity.paceSecondsPerMile)
      : `${formatNumber(activity.speedMph)} mph`;
  return `
    <button class="run-row activity-row" data-activity-id="${activity.id}">
      <div>
        <h3>${escapeHtml(activity.name)}</h3>
        <p>${formatDate(activity.date)} &middot; ${escapeHtml(activity.sportType)}</p>
      </div>
      <div class="run-stats">
        <span><strong>${formatNumber(activity.distanceMiles)}</strong> mi</span>
        <span><strong>${performance}</strong></span>
        <span><strong>${bpm(activity.averageHeartRate)}</strong></span>
      </div>
    </button>
  `;
}

function detailMetric(label, value) {
  return `
    <div class="detail-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value || '-'))}</strong>
    </div>
  `;
}

function formatCadence(activity) {
  if (!Number.isFinite(activity.averageCadence)) {
    return '-';
  }
  const isRun = activity.category === 'run';
  const cadence = isRun
    ? formatNumber(activity.averageCadence, 0)
    : formatNumber(activity.averageCadence, 1);
  return `${cadence} ${isRun ? 'spm' : 'rpm'}`;
}

function zoneMetricLabel(sport) {
  return sport === 'run' ? 'Zone 2 pace' : 'Zone 2 speed';
}

function zoneMetricValue(sport, summary) {
  if (sport === 'run') {
    return formatPace(summary.zone2PaceSecondsPerMile);
  }
  return summary.zone2SpeedMph ? `${formatNumber(summary.zone2SpeedMph)} mph` : '-';
}

function zoneRangeCopy(zone) {
  if (zone?.observedMaxHeartRate) {
    return `Zone 2 band: ${zone.lower}-${zone.upper} bpm from observed max HR ${zone.observedMaxHeartRate}.`;
  }
  return `Zone 2 band: ${zone.lower}-${zone.upper} bpm. Add more HR data to replace the default.`;
}

function createDemoDashboard() {
  const runWeekly = [
    demoWeek('Feb 16', 16.8, 602, null, 146, 4),
    demoWeek('Feb 23', 19.2, 596, null, 145, 4),
    demoWeek('Mar 2', 20.5, 590, null, 145, 5),
    demoWeek('Mar 9', 13.4, 604, null, 147, 3),
    demoWeek('Mar 16', 22.1, 584, null, 144, 5),
    demoWeek('Mar 23', 24.0, 578, null, 143, 5),
    demoWeek('Mar 30', 22.7, 575, null, 143, 5),
    demoWeek('Apr 6', 18.4, 570, null, 142, 4),
    demoWeek('Apr 13', 19.0, 566, null, 142, 4),
    demoWeek('Apr 20', 20.8, 560, null, 141, 5),
    demoWeek('Apr 27', 21.6, 556, null, 141, 5),
    demoWeek('May 4', 11.2, 552, null, 140, 3)
  ];
  const rideWeekly = [
    demoWeek('Feb 16', 31.5, null, 15.8, 134, 2),
    demoWeek('Feb 23', 42.0, null, 16.2, 133, 2),
    demoWeek('Mar 2', 38.4, null, 16.1, 132, 2),
    demoWeek('Mar 9', 22.0, null, 15.4, 136, 1),
    demoWeek('Mar 16', 48.8, null, 16.5, 132, 3),
    demoWeek('Mar 23', 55.2, null, 16.9, 131, 3),
    demoWeek('Mar 30', 51.0, null, 17.0, 130, 3),
    demoWeek('Apr 6', 44.6, null, 16.8, 130, 2),
    demoWeek('Apr 13', 47.4, null, 17.1, 129, 2),
    demoWeek('Apr 20', 52.9, null, 17.4, 129, 3),
    demoWeek('Apr 27', 57.0, null, 17.6, 128, 3),
    demoWeek('May 4', 24.5, null, 17.7, 128, 1)
  ];
  const runActivities = [
    demoActivity('demo-run-1', 'Morning Run', 'run', '2026-05-04T11:30:00Z', 4.0, 535, 148, 167, 102, 182, 340),
    demoActivity('demo-run-2', 'Zone 2 Lunch Run', 'run', '2026-05-02T16:45:00Z', 6.2, 552, 142, 156, 185, 180, 295),
    demoActivity('demo-run-3', 'Easy Neighborhood Run', 'run', '2026-04-30T12:15:00Z', 5.1, 562, 139, 153, 120, 178, 280),
    demoActivity('demo-run-4', 'Long Aerobic Run', 'run', '2026-04-27T12:00:00Z', 10.3, 575, 143, 162, 410, 176, 300)
  ];
  const rideActivities = [
    demoActivity('demo-ride-1', 'Tempo Bike Loop', 'ride', '2026-05-03T13:20:00Z', 24.5, null, 131, 155, 620, 86, 178, 17.7),
    demoActivity('demo-ride-2', 'Easy Spin', 'ride', '2026-04-29T18:10:00Z', 18.2, null, 124, 144, 310, 84, 142, 16.4),
    demoActivity('demo-ride-3', 'Weekend Ride', 'ride', '2026-04-26T14:00:00Z', 38.8, null, 136, 162, 980, 82, 191, 18.1)
  ];

  return {
    athlete: {
      id: 'demo',
      name: 'Demo Athlete',
      firstname: 'Demo',
      profile: '',
      location: 'Raleigh, North Carolina'
    },
    appMode: 'demo',
    isPremium: false,
    lastSync: {
      completed_at: '2026-05-05T12:00:00Z'
    },
    totalActivitiesSaved: 228,
    sports: {
      run: {
        key: 'run',
        label: 'Run',
        activityNoun: 'run',
        activityNounPlural: 'runs',
        totalSaved: 172,
        zone2Range: {
          lower: 126,
          upper: 146,
          source: 'observed',
          observedMaxHeartRate: 186
        },
        metrics: {
          last28: {
            distanceMiles: 83.6,
            activityCount: 19,
            avgHeartRate: 142,
            zone2Count: 15,
            zone2PaceSecondsPerMile: 560
          },
          allTime: {
            activityCount: 172
          }
        },
        comparison: {
          trend: {
            status: 'improving',
            label: 'Improving',
            score: 6,
            summary:
              'Your easy pace is getting faster while average heart rate is slightly lower.',
            insights: [
              'Volume is up 8.4% compared with the previous block.',
              'Pace at the same HR improved 3.1%; this is the main trend signal.',
              'Zone 2 efficiency improved 4.2% across 126-146 bpm efforts.',
              'Average HR is down while pace is faster, which is a strong aerobic signal.'
            ]
          }
        },
        focusMetrics: {
          volume_change_percent: 8.4,
          run_frequency_change_percent: 10.0,
          zone2_efficiency_change_percent: 4.2,
          avg_hr_change: -1.8,
          avg_pace_change: -3.1,
          total_runs_30d: 21,
          total_miles_30d: 89.4
        },
        weekly: runWeekly,
        recentActivities: runActivities,
        efforts: [
          { label: 'Best Zone 2 run', sub: 'Apr 27', value: '9:16 @ 143 bpm' },
          { label: 'Longest run', sub: 'Last 30 days', value: '10.3 mi' },
          { label: 'Best mileage week', sub: 'Mar 23', value: '24.0 mi' },
          { label: 'Lowest easy HR', sub: 'Apr 30', value: '139 bpm' }
        ]
      },
      ride: {
        key: 'ride',
        label: 'Bike',
        activityNoun: 'ride',
        activityNounPlural: 'rides',
        totalSaved: 56,
        zone2Range: {
          lower: 126,
          upper: 146,
          source: 'observed',
          observedMaxHeartRate: 186
        },
        metrics: {
          last28: {
            distanceMiles: 181.8,
            activityCount: 10,
            avgHeartRate: 130,
            zone2Count: 8,
            zone2SpeedMph: 17.2
          },
          allTime: {
            activityCount: 56
          }
        },
        comparison: {
          trend: {
            status: 'improving',
            label: 'Improving',
            score: 5,
            summary:
              'Bike volume and Zone 2 speed are both trending up without higher heart rate.',
            insights: [
              'Ride volume is up 12.6% compared with the previous block.',
              'Speed at the same HR improved 2.8%; this is the main trend signal.',
              'Zone 2 efficiency improved 3.5% across 126-146 bpm rides.',
              'Average HR is stable, so the extra speed looks productive.'
            ]
          }
        },
        focusMetrics: {
          volume_change_percent: 12.6,
          run_frequency_change_percent: 8.0,
          zone2_efficiency_change_percent: 3.5,
          avg_hr_change: -0.5,
          avg_pace_change: -2.8,
          total_runs_30d: 10,
          total_miles_30d: 181.8
        },
        weekly: rideWeekly,
        recentActivities: rideActivities,
        efforts: [
          { label: 'Longest ride', sub: 'Apr 26', value: '38.8 mi' },
          { label: 'Best Zone 2 speed', sub: 'May 3', value: '17.7 mph' },
          { label: 'Best mileage week', sub: 'Apr 27', value: '57.0 mi' },
          { label: 'Lowest easy HR', sub: 'Apr 29', value: '124 bpm' }
        ]
      }
    }
  };
}

function demoWeek(label, distanceMiles, zone2PaceSecondsPerMile, zone2SpeedMph, avgHeartRate, activityCount) {
  return {
    weekStart: label,
    label,
    distanceMiles,
    zone2PaceSecondsPerMile,
    zone2SpeedMph,
    avgHeartRate,
    activityCount
  };
}

function demoActivity(
  id,
  name,
  category,
  date,
  distanceMiles,
  paceSecondsPerMile,
  averageHeartRate,
  maxHeartRate,
  elevationFeet,
  averageCadence,
  averageWatts,
  speedMph
) {
  const movingTimeSeconds =
    category === 'run'
      ? Math.round(distanceMiles * paceSecondsPerMile)
      : Math.round((distanceMiles / speedMph) * 3600);
  return {
    id,
    name,
    category,
    date,
    localDate: date,
    distanceMiles,
    movingTimeSeconds,
    elapsedTimeSeconds: movingTimeSeconds + 90,
    paceSecondsPerMile,
    speedMph: category === 'ride' ? speedMph : distanceMiles / (movingTimeSeconds / 3600),
    elevationFeet,
    averageHeartRate,
    maxHeartRate,
    averageCadence,
    averageWatts,
    maxWatts: averageWatts ? Math.round(averageWatts * 1.7) : null,
    kilojoules: averageWatts ? Math.round((averageWatts * movingTimeSeconds) / 1000) : null,
    achievementCount: 0,
    kudosCount: 12,
    sportType: category === 'run' ? 'Run' : 'Ride',
    summaryPolyline: ''
  };
}

function getDemoActivityDetail(activityId) {
  const activities = [
    ...state.dashboard.sports.run.recentActivities,
    ...state.dashboard.sports.ride.recentActivities
  ];
  const activity = activities.find((item) => String(item.id) === String(activityId));
  if (!activity) {
    throw new Error('Demo activity not found.');
  }

  const route = activity.category === 'run' ? demoRunRoute() : demoRideRoute();
  const samples = buildDemoSamples(route, activity);
  const location =
    activity.category === 'run'
      ? 'Raleigh, North Carolina, United States'
      : 'Cary, North Carolina, United States';

  return {
    source: 'demo',
    warning: null,
    activity: {
      ...activity,
      description:
        activity.category === 'run'
          ? 'Easy aerobic work with a steady finish.'
          : 'Smooth endurance ride with a light tempo section.',
      calories: activity.category === 'run' ? 520 : 780,
      deviceName: activity.category === 'run' ? 'Garmin fenix 7x Pro' : 'Garmin Edge 840',
      gearName: activity.category === 'run' ? 'Demo daily trainer' : 'Demo road bike',
      location,
      startLatLng: route[0],
      endLatLng: route.at(-1),
      map: {
        summaryPolyline: '',
        polyline: ''
      }
    },
    zone2Range: state.dashboard.sports[activity.category].zone2Range,
    zone2: {
      sampleCount: samples.filter((sample) => sample.heartRate >= 126 && sample.heartRate <= 146)
        .length,
      timeSeconds: Math.round(activity.movingTimeSeconds * 0.74),
      percent: 74
    },
    route,
    samples
  };
}

function demoRunRoute() {
  return [
    [35.7797, -78.6382],
    [35.781, -78.6345],
    [35.7831, -78.6322],
    [35.7848, -78.6288],
    [35.7837, -78.6252],
    [35.7813, -78.6239],
    [35.779, -78.6264],
    [35.7778, -78.6308],
    [35.7786, -78.6351],
    [35.7797, -78.6382]
  ];
}

function demoRideRoute() {
  return [
    [35.7877, -78.7811],
    [35.8015, -78.7655],
    [35.8182, -78.7445],
    [35.8271, -78.7132],
    [35.8142, -78.6922],
    [35.7934, -78.6986],
    [35.7747, -78.7258],
    [35.7698, -78.758],
    [35.7877, -78.7811]
  ];
}

function buildDemoSamples(route, activity) {
  const sampleCount = 180;
  return Array.from({ length: sampleCount }, (_, index) => {
    const progress = index / (sampleCount - 1);
    const point = interpolateRoute(route, progress);
    const effortWave = Math.sin(progress * Math.PI * 5);
    const heartRate = activity.averageHeartRate - 8 + progress * 14 + effortWave * 4;
    const speedMph =
      activity.category === 'run'
        ? 3600 / activity.paceSecondsPerMile + effortWave * 0.15
        : activity.speedMph + effortWave * 1.2;

    return {
      timeSeconds: Math.round(activity.movingTimeSeconds * progress),
      distanceMiles: round(activity.distanceMiles * progress, 2),
      lat: round(point[0], 6),
      lng: round(point[1], 6),
      altitudeFeet: round(240 + progress * activity.elevationFeet + effortWave * 12, 0),
      speedMph: round(speedMph, 1),
      paceSecondsPerMile:
        activity.category === 'run' ? Math.round(3600 / Math.max(speedMph, 0.1)) : null,
      heartRate: Math.round(heartRate),
      cadence: activity.averageCadence ? round(activity.averageCadence + effortWave * 3, 1) : null,
      watts: activity.averageWatts ? Math.round(activity.averageWatts + effortWave * 28) : null,
      temp: 66,
      moving: true,
      grade: round(effortWave * 2.4, 1)
    };
  });
}

function interpolateRoute(route, progress) {
  const scaled = progress * (route.length - 1);
  const index = Math.min(Math.floor(scaled), route.length - 2);
  const local = scaled - index;
  const start = route[index];
  const end = route[index + 1];
  return [
    start[0] + (end[0] - start[0]) * local,
    start[1] + (end[1] - start[1]) * local
  ];
}

async function api(path, options = {}) {
  const { headers: optionHeaders, ...rest } = options;
  const response = await fetch(path, {
    ...rest,
    headers: {
      accept: 'application/json',
      ...(optionHeaders || {})
    }
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Expected JSON from ${path}, got ${text.slice(0, 120)}`);
  }
  if (!response.ok) {
    throw new Error(json?.error?.message || `Request failed: ${response.status}`);
  }
  return json;
}

function decodePolyline(polyline) {
  if (!polyline) {
    return [];
  }

  let index = 0;
  let lat = 0;
  let lng = 0;
  const points = [];

  while (index < polyline.length) {
    const latChange = decodePolylineValue(polyline, () => index++);
    const lngChange = decodePolylineValue(polyline, () => index++);
    lat += latChange;
    lng += lngChange;
    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

function decodePolylineValue(polyline, nextIndex) {
  let result = 0;
  let shift = 0;
  let byte = null;

  do {
    byte = polyline.charCodeAt(nextIndex()) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  return result & 1 ? ~(result >> 1) : result >> 1;
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

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '-';
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatNumber(value, places = 1) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return value.toLocaleString('en-US', {
    maximumFractionDigits: places,
    minimumFractionDigits: places === 0 ? 0 : 1
  });
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function percent(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value, 1)}%`;
}

function bpm(value) {
  return Number.isFinite(value) ? `${Math.round(value)} bpm` : '-';
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatDateTime(value) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatUnixDate(value) {
  if (!Number.isFinite(Number(value))) {
    return 'the end of the billing period';
  }
  return new Date(Number(value) * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function titleCase(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.append(toast);
  }
  toast.textContent = message;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    toast.remove();
  }, 4200);
}

window.addEventListener('resize', () => {
  if (state.dashboard) {
    drawWeeklyChart();
    const overlay = document.querySelector('.detail-overlay');
    if (overlay) {
      closeActivityDrawer();
    }
  }
});
