'use strict';

const fs = require('fs');
const path = require('path');

describe('reseller portal expiry media and announcement support', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/reseller.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../../public/js/reseller-app.js'), 'utf8');

  it('adds reseller portal surfaces for announcement and expiry media self-service', () => {
    expect(html).toContain('id="expiryMediaNav"');
    expect(html).toContain('id="dashAnnouncement"');
    expect(html).toContain('id="page-expiry-media"');
    expect(html).toContain('id="rslExpiryExpiringRows"');
    expect(html).toContain('id="rslExpiryExpiredRows"');
  });

  it('hydrates reseller profile state to drive announcement and expiry media permissions', () => {
    expect(js).toContain('function applyResellerProfileState(');
    expect(js).toContain('notice_html');
    expect(js).toContain('manage_expiry_media');
    expect(js).toContain('function loadExpiryMedia(');
    expect(js).toContain('function saveExpiryMedia(');
  });
});
