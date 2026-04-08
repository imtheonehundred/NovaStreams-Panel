// WebSocket - ES6 exports converted from factory pattern
// Source: public/js/modules/websocket.js

let ws = null;
let reconnectTimer = null;

function getWsPath() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export function disconnectWS() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}

export function connectDashboardWS(handlers = {}) {
  const { onDashboardData = () => {}, onEventData = () => {}, getCurrentPage = () => '', reconnectDelayMs = 5000 } = handlers;

  disconnectWS();

  try {
    ws = new WebSocket(getWsPath());
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
      reconnectTimer = setTimeout(() => connectDashboardWS(handlers), reconnectDelayMs);
    }
  };

  ws.onerror = () => {
    if (ws) ws.close();
  };
}

export default { connectDashboardWS, disconnectWS };