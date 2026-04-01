'use strict';

const fs = require('fs');
const path = require('path');

describe('channels sidebar phase 1', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/js/app.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

  it('restructures Content > Channels into a subgroup with the requested child pages', () => {
    expect(html).toContain('Channels');
    expect(html).toContain('data-page="add-channels"');
    expect(html).toContain('data-page="manage-channels"');
    expect(html).toContain('data-page="monitor-top-channels"');
    expect(html).toContain('data-page="stream-import-tools"');
    expect(html).not.toContain('Advance Stream Tools');
    expect(html).not.toContain('Channels Statistics');
    expect(html).not.toContain('data-page="streams"><span class="nav-icon"');
  });

  it('keeps clean-path aliases for old streams routes while adding new channel routes', () => {
    expect(appJs).toContain("streams: 'manage-channels'");
    expect(appJs).toContain("'stream-import': 'stream-import-tools'");
    expect(appJs).toContain("'manage-channels': 'streams'");
    expect(appJs).toContain("'stream-import-tools': 'stream-import'");
    expect(serverJs).toContain("'add-channels'");
    expect(serverJs).toContain("'manage-channels'");
    expect(serverJs).toContain("'monitor-top-channels'");
    expect(serverJs).toContain("'stream-import-tools'");
  });

  it('adds routeable page owners for add and monitor channels pages', () => {
    expect(html).toContain('id="page-add-channels"');
    expect(html).toContain('id="page-monitor-top-channels"');
    expect(appJs).toContain('loadAddChannelsPage');
    expect(appJs).toContain('loadMonitorTopChannelsPage');
  });
});
