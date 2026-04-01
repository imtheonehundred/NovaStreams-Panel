'use strict';

const fs = require('fs');
const path = require('path');

describe('dashboard visual rebuild', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/js/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/premium.css'), 'utf8');
  const adminJs = fs.readFileSync(path.join(__dirname, '../../routes/admin.js'), 'utf8');
  const wsJs = fs.readFileSync(path.join(__dirname, '../../services/wsServer.js'), 'utf8');

  it('renders the rebuilt dashboard structure with dedicated hero, analytics, insights, and fleet areas', () => {
    expect(html).toContain('id="dashHeroMeta"');
    expect(html).toContain('id="dashFeatured"');
    expect(html).toContain('id="dashOpsPanel"');
    expect(html).toContain('id="dashAnalyticsGrid"');
    expect(html).toContain('id="dashGeoStats"');
    expect(html).toContain('id="dashGeoList"');
    expect(html).toContain('id="dashActivityChart"');
    expect(html).toContain('id="dashTopStreams"');
    expect(html).toContain('id="dashServerDistribution"');
    expect(html).toContain('Node Fleet');
  });

  it('uses richer dashboard rendering logic and live-connections summary data', () => {
    expect(appJs).toContain('function renderDashboardHeroMeta(');
    expect(appJs).toContain('function renderDashboardFeatured(');
    expect(appJs).toContain('function renderDashboardAnalyticsGrid(');
    expect(appJs).toContain('function renderDashboardGeoInsights(');
    expect(appJs).toContain('function renderDashboardActivityInsights(');
    expect(appJs).toContain("apiFetch('/live-connections/summary')");
    expect(appJs).toContain('let _dashActivityChart = null;');
    expect(appJs).toContain('let _dashboardState = {');
  });

  it('keeps unknown startup health truth aligned across websocket and frontend rendering', () => {
    expect(wsJs).toContain("health: { status: hasHealthSample ? (panelUp ? 'up' : 'down') : 'unknown', lastResponseMs: lastRespMs }");
    expect(appJs).toContain("const localStatusText = healthData && healthData.status === 'unknown'");
    expect(appJs).toContain("? 'Pending'");
    expect(appJs).toContain("? 'Awaiting first check'");
  });

  it('extends dashboard stats backend with additional real count metrics', () => {
    expect(adminJs).toContain('episodeCount');
    expect(adminJs).toContain('bouquetCount');
    expect(adminJs).toContain('packageCount');
    expect(adminJs).toContain('resellerCount');
  });

  it('adds dashboard-scoped premium layout styles without relying on generic global overrides', () => {
    expect(css).toContain('.dash-hero-panel');
    expect(css).toContain('.dash-main-grid');
    expect(css).toContain('.dash-feature-card');
    expect(css).toContain('.dash-analytics-grid');
    expect(css).toContain('.dash-insight-grid');
    expect(css).toContain('.dash-activity-layout');
    expect(css).toContain('.dash-server-card-facts');
    expect(css).toContain('.dash-empty-panel');
  });
});
