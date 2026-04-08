'use strict';

const shared = require('./serverService.shared');

module.exports = {
  listServers: shared.listServers,
  getServer: shared.getServer,
  createServer: shared.createServer,
  updateServer: shared.updateServer,
  deleteServer: shared.deleteServer,
  reorderServers: shared.reorderServers,
  recordPlacementSelection: shared.recordPlacementSelection,
  demoteOtherMains: shared.demoteOtherMains,
  replaceDomains: shared.replaceDomains,
  buildServerPublicBaseUrl: shared.buildServerPublicBaseUrl,
  getDefaultStreamServerId: shared.getDefaultStreamServerId,
  getMovieStreamServerId: shared.getMovieStreamServerId,
  getLiveChannelStreamServerId: shared.getLiveChannelStreamServerId,
  getServerHealthStatus: shared.getServerHealthStatus,
  getServerWithRelationships: shared.getServerWithRelationships,
  STALE_HEARTBEAT_THRESHOLD_MS: shared.STALE_HEARTBEAT_THRESHOLD_MS,
  getRuntimeCapableServers: shared.getRuntimeCapableServers,
  getProxyCapableServers: shared.getProxyCapableServers,
  getRuntimePlacementsForAsset: shared.getRuntimePlacementsForAsset,
  getRuntimePlacementsForServer: shared.getRuntimePlacementsForServer,
  getOriginProxyRelationships: shared.getOriginProxyRelationships,
  applyHeartbeat: shared.applyHeartbeat,
  updateServerCapabilities: shared.updateServerCapabilities,
  canIssueCommandToServer: shared.canIssueCommandToServer,
  isRuntimeReady: shared.isRuntimeReady,
};
