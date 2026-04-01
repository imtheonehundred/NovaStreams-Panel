'use strict';

const fs = require('fs');
const path = require('path');

describe('server area slice 1 repair', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/js/app.js'), 'utf8');
  const adminJs = fs.readFileSync(path.join(__dirname, '../../routes/admin.js'), 'utf8');
  const agentJs = fs.readFileSync(path.join(__dirname, '../../agent/index.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/premium.css'), 'utf8');

  it('renders richer manage servers surface', () => {
    expect(html).toContain('id="serversLatencyBanner"');
    expect(html).toContain('id="serversFaqRow"');
    expect(html).toContain('id="serversPerPage"');
    expect(html).toContain('id="serversSearch"');
    expect(html).toContain('ID</th>');
    expect(html).toContain('Server Name</th>');
    expect(html).toContain('Bandwidth</th>');
    expect(html).toContain('id="serverAdvancedModal"');
    expect(html).toContain('class="server-table-scroll"');
  });

  it('renders the repaired edit server parity surface instead of the old generic modal form', () => {
    expect(html).toContain('id="page-server-edit"');
    expect(html).toContain('Back To Servers');
    expect(html).toContain('Server IP - Primary');
    expect(html).toContain('Users CDN - LB');
    expect(html).toContain('Private Users CDN - LB');
    expect(html).toContain('Proxy IP - Default DNS');
    expect(html).toContain('Root Password');
    expect(html).toContain('Use HTTPS M3U Lines');
    expect(html).toContain('Time Difference - Seconds');
    expect(html).toContain('Insert Port for conx limit');
    expect(html).toContain('[ Check FAQs: How to install SSL ]');
    expect(html).toContain('Lower/Uper Case Applied*');

    expect(html).not.toContain('id="srvRole"');
    expect(html).not.toContain('id="srvBaseUrl"');
    expect(html).not.toContain('id="srvPublicHost"');
    expect(html).not.toContain('id="srvDns1"');
    expect(html).not.toContain('id="srvDns2"');
    expect(html).not.toContain('id="srvAdminPasswordConfirm"');
  });

  it('renders dedicated install pages instead of placeholder open-modal cards', () => {
    expect(html).toContain('Load Balancer Installation');
    expect(html).toContain('id="installLbName"');
    expect(html).toContain('id="installLbHost"');
    expect(html).toContain('id="installLbPassword"');
    expect(html).toContain('id="installLbHttpPort"');
    expect(html).toContain('id="installLbHttpsPort"');

    expect(html).toContain('Proxy balancer installation');
    expect(html).toContain('id="installProxyProtectServer"');
    expect(html).toContain('id="installProxyPorts"');
    expect(html).toContain('id="installProxyApiHttpPort"');
    expect(html).toContain('id="installProxyApiHttpsPort"');
  });

  it('keeps the affected server-area tables on canonical responsive table shells', () => {
    expect(html).toContain('<table class="data-table" id="serverOrderTable">');
    expect(html).toContain('<table class="data-table" id="lcTopStreamsTable">');
    expect(html).toContain('<table class="data-table" id="lcServerDistTable">');
    expect(html).toContain('<table class="data-table" id="lcCountryTable">');
  });

  it('wires slice actions and dedicated install submit handlers in app.js', () => {
    expect(appJs).toContain('async function submitInstallLbPage()');
    expect(appJs).toContain('async function submitInstallProxyPage()');
    expect(appJs).toContain('function toggleServerActionMenu');
    expect(appJs).toContain('async function serverActionKillConnections');
    expect(appJs).toContain('async function serverRestartServices()');
    expect(appJs).toContain('async function serverReboot()');
    expect(appJs).toContain("navigateTo('server-edit')");
    expect(appJs).toContain("$('#srvServerIpPrimary')?.focus()");
    expect(appJs).toContain('function addIspName()');
    expect(appJs).toContain('function clearToasts()');
    expect(appJs).toContain('new URLSearchParams()');
  });

  it('adds real admin routes for restart/reboot/kill-connections', () => {
    expect(adminJs).toContain("router.post('/servers/:id/actions/restart-services'");
    expect(adminJs).toContain("router.post('/servers/:id/actions/reboot-server'");
    expect(adminJs).toContain("router.post('/servers/:id/actions/kill-connections'");
  });

  it('keeps monitor-summary route ahead of numeric server id handling', () => {
    expect(adminJs.indexOf("router.get('/servers/monitor-summary'")).toBeGreaterThan(-1);
    expect(adminJs.indexOf("router.get('/servers/:id(\\\\d+)'")).toBeGreaterThan(-1);
    expect(adminJs.indexOf("router.get('/servers/monitor-summary'")).toBeLessThan(adminJs.indexOf("router.get('/servers/:id(\\\\d+)'") );
  });

  it('extends agent command handling for restart and reboot tools', () => {
    expect(agentJs).toContain("case 'restart_services'");
    expect(agentJs).toContain("case 'reboot_server'");
    expect(agentJs).toContain('handleRestartServices');
    expect(agentJs).toContain('handleRebootServer');
  });

  it('contains the layout repair hooks for width containment and unclipped dropdowns', () => {
    expect(css).toContain('width: calc(100% - var(--sidebar-layout-w));');
    expect(css).toContain('.server-table-scroll');
    expect(css).toContain('position: fixed;');
    expect(css).toContain('.server-install-card .form-row');
    expect(appJs).toContain('positionServerActionMenu');
  });
});
