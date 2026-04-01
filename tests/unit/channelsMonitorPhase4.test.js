'use strict';

const fs = require('fs');
const path = require('path');

describe('channels monitor top channels phase 4', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/js/app.js'), 'utf8');
  const adminJs = fs.readFileSync(path.join(__dirname, '../../routes/admin.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/premium.css'), 'utf8');

  it('adds a real Monitor Top Channels page surface', () => {
    expect(html).toContain('id="page-monitor-top-channels"');
    expect(html).toContain('id="topChannelsSummaryCards"');
    expect(html).toContain('id="topChannelsTable"');
    expect(html).toContain('id="topChannelsLastUpdated"');
  });

  it('loads top channels monitor data through a dedicated admin route and auto-refreshes while active', () => {
    expect(appJs).toContain("apiFetch('/channels/top-monitor')");
    expect(appJs).toContain('function renderTopChannelsMonitor(');
    expect(appJs).toContain('stopTopChannelsMonitorAutoRefresh');
    expect(adminJs).toContain("router.get('/channels/top-monitor'");
  });

  it('adds scoped styling for the top channels monitor cards', () => {
    expect(css).toContain('.channels-top-monitor-stats');
    expect(css).toContain('.channels-top-stat-card');
    expect(css).toContain('.channels-top-monitor-footnote');
  });
});
