'use strict';

const fs = require('fs');
const path = require('path');

describe('channels manage page and logo workflow phase 3', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/js/app.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
  const channelRoutesJs = fs.readFileSync(path.join(__dirname, '../../routes/channels.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/premium.css'), 'utf8');

  it('upgrades the streams page into the screenshot-style operational surface', () => {
    expect(html).toContain('>Streams<');
    expect(html).toContain('id="streamsServerFilter"');
    expect(html).toContain('id="streamsAutoRefreshBtn"');
    expect(html).toContain('id="repairAllBtn"');
    expect(html).toContain('Search Streams');
    expect(html).toContain('Auto-Refresh');
    expect(html).toContain('Add Stream');
    expect(html).toContain('Mass Review');
  });

  it('removes dead stream-type tab drift from the channels page logic', () => {
    expect(appJs).not.toContain('data-stream-type');
    expect(appJs).not.toContain("localStorage.setItem('streamsTab'");
    expect(appJs).toContain('function renderStreamsPagination(');
    expect(appJs).toContain('function buildStreamRowMarkup(');
    expect(appJs).toContain('function toggleStreamsAutoRefresh(');
  });

  it('adds a working channel logo modal workflow in the admin UI', () => {
    expect(html).toContain('id="channelLogoModal"');
    expect(html).toContain('id="channelLogoCurrentPreview"');
    expect(html).toContain('id="channelLogoCustomUrl"');
    expect(html).toContain('id="channelLogoSearchQuery"');
    expect(html).toContain('id="channelLogoSearchResults"');
    expect(appJs).toContain('function openChannelLogoModal(');
    expect(appJs).toContain('function searchChannelLogos(');
    expect(appJs).toContain('function saveChannelLogoFromCustomUrl(');
    expect(appJs).toContain('function applyChannelLogoResult(');
    expect(appJs).toContain('updateStreamLogoCache');
  });

  it('adds real backend support for logo search and running-channel logo updates', () => {
    expect(serverJs).toContain("app.use('/api', channelRoutes(");
    expect(channelRoutesJs).toContain("router.get('/channels/logo-search'");
    expect(channelRoutesJs).toContain('logoOnlyUpdate');
    expect(channelRoutesJs).toContain('channel.logoUrl = String(updates.logoUrl ||');
  });

  it('adds scoped styles for channels row logo and logo modal UX', () => {
    expect(css).toContain('.channels-table-logo-btn');
    expect(css).toContain('.channels-logo-modal-box');
    expect(css).toContain('.channels-logo-results');
    expect(css).toContain('.streams-xc-status-cell');
    expect(css).toContain('.streams-xc-uptime-card');
    expect(css).toContain('.streams-xc-page-pill');
  });
});
