(function () {
  'use strict';

  const root = window.AdminCoreModules = window.AdminCoreModules || {};

  function createDashboardWebSocket(options = {}) {
    let ws = null;
    let reconnectTimer = null;
    const wsPath = options.wsPath || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const reconnectDelayMs = Number(options.reconnectDelayMs) || 5000;
    const getCurrentPage = typeof options.getCurrentPage === 'function' ? options.getCurrentPage : function () { return ''; };
    const onDashboardData = typeof options.onDashboardData === 'function' ? options.onDashboardData : function () {};
    const onEventData = typeof options.onEventData === 'function' ? options.onEventData : function () {};

    function disconnectWS() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
    }

    function connectDashboardWS() {
      disconnectWS();
      try {
        ws = new WebSocket(wsPath);
      } catch (_) {
        return;
      }

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (_) {
          return;
        }
        if (msg.channel === 'dashboard') onDashboardData(msg.data);
        else if (msg.channel === 'events') onEventData(msg.data);
      };

      ws.onclose = () => {
        if (getCurrentPage() === 'dashboard') {
          reconnectTimer = setTimeout(connectDashboardWS, reconnectDelayMs);
        }
      };

      ws.onerror = () => {
        if (ws) ws.close();
      };
    }

    return {
      connectDashboardWS,
      disconnectWS,
    };
  }

  root.websocket = {
    createDashboardWebSocket,
  };
}());
