'use strict';

const { error: logError } = require('../../services/logger');

function startBootJobs({
  startCrons,
  createWsServer,
  sessionMiddleware,
  eventBus,
  createIdleKillService,
  server,
  wsDeps,
  idleKillDeps,
}) {
  startCrons();

  setTimeout(() => {
    const { initBot } = require('../../services/telegramBot');
    initBot().catch((error) =>
      logError('[TELEGRAM] Init error', { error: error.message })
    );
  }, 5000);

  const wsServer = createWsServer({
    sessionMiddleware,
    eventBus,
    deps: wsDeps,
  });
  wsServer.init();
  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws' || req.url.startsWith('/ws?')) {
      wsServer.handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  const { init: initWebhooks } = require('../../services/webhookService');
  initWebhooks({ eventBus });

  const idleKillService = createIdleKillService(idleKillDeps);
  idleKillService.start();
}

module.exports = {
  startBootJobs,
};
