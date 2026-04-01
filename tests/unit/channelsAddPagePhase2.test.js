'use strict';

const fs = require('fs');
const path = require('path');

describe('channels add page phase 2', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/js/app.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

  it('uses a dedicated add-channels page workflow instead of the old stream modal', () => {
    expect(html).toContain('id="page-add-channels"');
    expect(html).toContain('id="channelFormTitle"');
    expect(html).toContain('data-tab="channel-details"');
    expect(html).toContain('data-tab="channel-advanced"');
    expect(html).toContain('data-tab="channel-map"');
    expect(html).toContain('data-tab="channel-restart"');
    expect(html).toContain('data-tab="channel-epg"');
    expect(html).toContain('data-tab="channel-servers"');
    expect(html).not.toContain('id="streamModal"');
    expect(html).not.toContain('id="streamModalTabs"');
  });

  it('matches the screenshot-oriented stream editor fields and actions', () => {
    expect(html).toContain('Join Sub-Categories');
    expect(html).toContain('Goto bouquets page to subscribe channels in bouquets by categories selection.');
    expect(html).toContain('Test All Sources');
    expect(html).toContain('id="streamDirectSource"');
    expect(html).toContain('id="streamProtect"');
    expect(html).toContain('id="streamCookie"');
    expect(html).toContain('id="streamHeaders"');
    expect(html).toContain('id="streamRestartDays"');
    expect(html).toContain('id="streamRestartTime"');
    expect(html).toContain('id="streamEpgSource"');
    expect(html).toContain('id="streamEpgLanguage"');
    expect(html).toContain('id="streamTimeshiftServer"');
    expect(html).toContain('id="streamTimeshiftDays"');
  });

  it('drives add/edit through the page workflow with screenshot-style editor helpers and persisted metadata fields', () => {
    expect(appJs).toContain("navigateTo('add-channels')");
    expect(appJs).toContain('function switchChannelFormTab(');
    expect(appJs).toContain('function probeSingleChannelSource(');
    expect(appJs).toContain('function addChannelCustomMapEntry(');
    expect(appJs).toContain('join_sub_category_ids');
    expect(appJs).toContain('timeshift_server_id');
    expect(serverJs).toContain('join_sub_category_ids');
    expect(serverJs).toContain('direct_source');
    expect(serverJs).toContain('timeshift_server_id');
  });
});
