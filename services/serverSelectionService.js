'use strict';

const { queryOne } = require('../lib/mariadb');
const dbApi = require('../lib/db');
const { publicStreamOrigin } = require('../lib/public-stream-origin');
const shared = require('./serverService.shared');

function warnServerCandidate(reason, serverId, extra) {
  const detail = extra ? ` ${extra}` : '';
  console.warn(
    `[serverService.selectServer] ${reason} server_id=${serverId}${detail}`
  );
}

async function selectServerRowById(serverId, opts = {}) {
  const normalizedServerId = parseInt(serverId, 10);
  if (!Number.isFinite(normalizedServerId) || normalizedServerId <= 0)
    return null;
  const server = await shared.getServer(normalizedServerId);
  if (!server) return null;
  const health = await shared.getServerHealthStatus(normalizedServerId);
  if (!server.enabled) {
    warnServerCandidate(
      'rejecting disabled',
      normalizedServerId,
      opts.reason ? `reason=${opts.reason}` : ''
    );
    return null;
  }
  if (!health.fresh) {
    warnServerCandidate(
      'rejecting stale',
      normalizedServerId,
      opts.reason ? `reason=${opts.reason}` : ''
    );
    return null;
  }
  return {
    serverId: normalizedServerId,
    server,
    health,
    isOverride: !!opts.isOverride,
  };
}

async function buildSelectorResult({
  assetType,
  assetId,
  selectionSource,
  isOverride,
  serverRow,
  warnings = [],
}) {
  const serverId = serverRow ? serverRow.serverId : 0;
  const server = serverRow ? serverRow.server : null;
  const health = serverRow ? serverRow.health : null;
  const role = server && server.role ? server.role : 'edge';
  const publicHost =
    server && server.public_host ? String(server.public_host).trim() : '';
  const publicBaseUrl = server
    ? shared.buildServerPublicBaseUrl(server) || ''
    : '';
  const enabled = server ? !!server.enabled : false;

  return {
    assetType: String(assetType || '').toLowerCase(),
    assetId: String(assetId || ''),
    selectedServerId: serverId,
    selectedServerRole: role,
    selectionSource: selectionSource || 'enabled_fallback',
    publicBaseUrl,
    publicHost,
    isOverride: !!isOverride,
    enabled,
    heartbeat: health || {
      fresh: false,
      lastHeartbeatAt: null,
      staleMs: Infinity,
    },
    warnings,
    debug: {
      requestedLineId: 0,
      requestedForceServerId: 0,
      requestedLiveAssignmentServerId: 0,
      defaultServerId: 0,
    },
  };
}

async function resolvePlaylistBaseUrl(
  line,
  reqFallbackUrl,
  assetStreamServerId
) {
  const fallback = shared.stripTrailingSlash(reqFallbackUrl);
  const assetServerId =
    assetStreamServerId != null && assetStreamServerId !== ''
      ? parseInt(assetStreamServerId, 10)
      : 0;
  if (Number.isFinite(assetServerId) && assetServerId > 0) {
    const server = await shared.getServer(assetServerId);
    if (server && server.enabled) {
      const baseUrl = shared.buildServerPublicBaseUrl(server);
      if (baseUrl) return baseUrl;
    }
  }
  let serverId =
    line && line.force_server_id != null
      ? parseInt(line.force_server_id, 10)
      : 0;
  if (!serverId || serverId <= 0) {
    serverId =
      parseInt(
        String((await dbApi.getSetting('default_stream_server_id')) || '0'),
        10
      ) || 0;
  }
  if (serverId > 0) {
    const server = await shared.getServer(serverId);
    if (server && server.enabled) {
      const baseUrl = shared.buildServerPublicBaseUrl(server);
      if (baseUrl) return baseUrl;
    }
  }
  const lb = await queryOne(
    "SELECT * FROM streaming_servers WHERE enabled = 1 AND role = 'lb' ORDER BY sort_order ASC, id ASC LIMIT 1"
  );
  if (lb) {
    const baseUrl = shared.buildServerPublicBaseUrl(lb);
    if (baseUrl) return baseUrl;
  }
  const main = await queryOne(
    "SELECT * FROM streaming_servers WHERE enabled = 1 AND role = 'main' ORDER BY sort_order ASC, id ASC LIMIT 1"
  );
  if (main) {
    const baseUrl = shared.buildServerPublicBaseUrl(main);
    if (baseUrl) return baseUrl;
  }
  return fallback;
}

async function resolvePublicStreamOrigin(req, line) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('host') || 'localhost';
  const fallback = `${proto}://${host}`;
  const resolved = await resolvePlaylistBaseUrl(line || {}, fallback);
  if (resolved === fallback) return publicStreamOrigin(req);
  return publicStreamOrigin(req, { preferredBaseUrl: resolved });
}

async function selectServer({ assetType, assetId, line = null }) {
  const type = String(assetType || '').toLowerCase();
  const parsedAssetId = parseInt(assetId, 10);
  const placementStreamId =
    Number.isFinite(parsedAssetId) && parsedAssetId > 0
      ? String(parsedAssetId)
      : String(assetId || '');
  const warnings = [];
  const debug = {
    requestedLineId: line && line.id ? line.id : 0,
    requestedForceServerId: 0,
    requestedLiveAssignmentServerId: 0,
    defaultServerId: 0,
  };

  if (line && line.force_server_id) {
    const forceServerId = parseInt(line.force_server_id, 10);
    if (forceServerId > 0) {
      debug.requestedForceServerId = forceServerId;
      const picked = await selectServerRowById(forceServerId, {
        reason: 'line_override',
        isOverride: true,
      });
      if (picked) {
        if (!picked.server.enabled) warnings.push('assigned_server_disabled');
        else if (!picked.health.fresh) warnings.push('assigned_server_stale');
        await shared.recordPlacementSelection(
          type,
          placementStreamId,
          picked.serverId
        );
        return await buildSelectorResult({
          assetType: type,
          assetId: placementStreamId,
          selectionSource: 'line_override',
          isOverride: true,
          serverRow: picked,
          warnings,
        });
      }
    }
  }

  if (
    type === 'episode' &&
    Number.isFinite(parsedAssetId) &&
    parsedAssetId > 0
  ) {
    const effective = await dbApi.getEffectiveEpisodeServerId(parsedAssetId);
    if (effective > 0) {
      const picked = await selectServerRowById(effective, {
        reason: 'episode_assignment',
      });
      if (picked) {
        if (!picked.server.enabled) warnings.push('assigned_server_disabled');
        else if (!picked.health.fresh) warnings.push('assigned_server_stale');
        await shared.recordPlacementSelection(
          type,
          placementStreamId,
          picked.serverId
        );
        return await buildSelectorResult({
          assetType: type,
          assetId: placementStreamId,
          selectionSource: 'episode_assignment',
          isOverride: false,
          serverRow: picked,
          warnings,
        });
      }
    }
  } else if (
    type === 'movie' &&
    Number.isFinite(parsedAssetId) &&
    parsedAssetId > 0
  ) {
    const serverId = await shared.getMovieStreamServerId(parsedAssetId);
    if (serverId > 0) {
      const picked = await selectServerRowById(serverId, {
        reason: 'movie_assignment',
      });
      if (picked) {
        if (!picked.server.enabled) warnings.push('assigned_server_disabled');
        else if (!picked.health.fresh) warnings.push('assigned_server_stale');
        await shared.recordPlacementSelection(
          type,
          placementStreamId,
          picked.serverId
        );
        return await buildSelectorResult({
          assetType: type,
          assetId: placementStreamId,
          selectionSource: 'movie_assignment',
          isOverride: false,
          serverRow: picked,
          warnings,
        });
      }
    }
  } else if (type === 'live' && Number.isFinite(parsedAssetId)) {
    const serverId = await shared.getLiveChannelStreamServerId(parsedAssetId);
    debug.requestedLiveAssignmentServerId = serverId || 0;
    if (serverId > 0) {
      const picked = await selectServerRowById(serverId, {
        reason: 'live_assignment',
      });
      if (picked) {
        if (!picked.server.enabled) warnings.push('assigned_server_disabled');
        else if (!picked.health.fresh) warnings.push('assigned_server_stale');
        await shared.recordPlacementSelection(
          type,
          placementStreamId,
          picked.serverId
        );
        return await buildSelectorResult({
          assetType: type,
          assetId: placementStreamId,
          selectionSource: 'live_assignment',
          isOverride: false,
          serverRow: picked,
          warnings,
        });
      }
    }
  }

  const defaultServerId = await shared.getDefaultStreamServerId();
  debug.defaultServerId = defaultServerId || 0;
  if (defaultServerId > 0) {
    const picked = await selectServerRowById(defaultServerId, {
      reason: 'default_setting',
    });
    if (picked) {
      if (!picked.server.enabled) warnings.push('default_server_disabled');
      else if (!picked.health.fresh) warnings.push('default_server_stale');
      await shared.recordPlacementSelection(
        type,
        placementStreamId,
        picked.serverId
      );
      return await buildSelectorResult({
        assetType: type,
        assetId: placementStreamId,
        selectionSource: 'default_server',
        isOverride: false,
        serverRow: picked,
        warnings,
      });
    }
  }

  const fallback = await queryOne(
    "SELECT * FROM streaming_servers WHERE enabled = 1 ORDER BY FIELD(role,'lb','main','edge'), sort_order ASC, id ASC LIMIT 1"
  );
  if (fallback) {
    const picked = {
      serverId: fallback.id,
      server: {
        ...fallback,
        meta_json: shared.parseMeta(fallback.meta_json),
        domains: [],
      },
      health: await shared.getServerHealthStatus(fallback.id),
      isOverride: false,
    };
    await shared.recordPlacementSelection(
      type,
      placementStreamId,
      picked.serverId
    );
    return await buildSelectorResult({
      assetType: type,
      assetId: placementStreamId,
      selectionSource: 'enabled_fallback',
      isOverride: false,
      serverRow: picked,
      warnings: [],
    });
  }

  const domain = String((await dbApi.getSetting('domain_name')) || '').trim();
  const port = String((await dbApi.getSetting('server_port')) || '80').trim();
  const proto = String((await dbApi.getSetting('server_protocol')) || 'http')
    .trim()
    .toLowerCase();
  if (domain) {
    return {
      assetType: type,
      assetId: placementStreamId,
      selectedServerId: 0,
      selectedServerRole: 'main',
      selectionSource: 'panel_fallback',
      publicBaseUrl: `${proto}://${domain}:${port}`,
      publicHost: domain,
      isOverride: false,
      enabled: true,
      heartbeat: { fresh: false, lastHeartbeatAt: null, staleMs: Infinity },
      warnings: [],
      debug,
    };
  }

  const error = new Error('No server available for selection');
  error.code = 'NO_PUBLIC_ORIGIN_AVAILABLE';
  throw error;
}

async function selectFailoverServer(primaryServerId, assetType, assetId) {
  const candidates = await dbApi.getFailoverRelationships(primaryServerId);
  if (!candidates || !candidates.length) return null;

  for (const row of candidates) {
    const health = await shared.getServerHealthStatus(row.server_id);
    if (!health.fresh) continue;

    if (assetType === 'live') {
      const placements = await dbApi.getPlacementByAsset(
        'live',
        String(assetId)
      );
      const placement = placements.find(
        (entry) => Number(entry.server_id) === Number(row.server_id)
      );
      if (!placement) continue;
      if (String(placement.status) !== 'running') continue;
      if (!placement.runtime_instance_id) continue;
      if (!placement.ready_at) continue;
      return {
        serverId: row.server_id,
        server: {
          ...row,
          meta_json: shared.parseMeta(row.meta_json),
          domains: [],
        },
        health,
        isFailover: true,
        placement,
      };
    }

    return {
      serverId: row.server_id,
      server: {
        ...row,
        meta_json: shared.parseMeta(row.meta_json),
        domains: [],
      },
      health,
      isFailover: true,
      placement: null,
    };
  }

  return null;
}

module.exports = {
  resolvePlaylistBaseUrl,
  resolvePublicStreamOrigin,
  selectServer,
  selectFailoverServer,
};
