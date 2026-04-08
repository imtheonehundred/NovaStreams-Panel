'use strict';

jest.mock('../../../lib/redis', () => ({
  cacheGet: jest.fn(),
  cacheSet: jest.fn(),
}));

const redis = require('../../../lib/redis');
const { createPanelAccess } = require('../../../lib/panel-access');

describe('panel-access middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redis.cacheGet.mockResolvedValue(null);
    redis.cacheSet.mockResolvedValue(undefined);
  });

  it('forwards requireAuth access code lookup failures to next', async () => {
    const dbError = new Error('db down');
    const { requireAuth } = createPanelAccess({
      dbApi: {
        getAccessCodeById: jest.fn().mockRejectedValue(dbError),
      },
      userActivity: new Map(),
      apiKeyLimiter: null,
    });
    const req = {
      session: {
        userId: 7,
        accessCodeId: 3,
        portalRole: 'admin',
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    requireAuth(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('uses Redis cache before hitting the database', async () => {
    const cachedRow = { id: 3, code: 'ADMIN', role: 'admin', enabled: 1 };
    redis.cacheGet.mockResolvedValue(cachedRow);
    const dbApi = {
      getAccessCodeById: jest.fn(),
    };
    const { validatePanelAccessCodeSession } = createPanelAccess({
      dbApi,
      userActivity: new Map(),
      apiKeyLimiter: null,
    });
    const req = {
      session: {
        accessCodeId: 3,
        portalRole: 'admin',
        accessCode: 'ADMIN',
      },
    };

    const result = await validatePanelAccessCodeSession(req, 'admin');

    expect(result).toEqual(cachedRow);
    expect(dbApi.getAccessCodeById).not.toHaveBeenCalled();
  });

  it('memoizes validation result on req for reuse within the same request', async () => {
    const row = { id: 3, code: 'ADMIN', role: 'admin', enabled: 1 };
    const dbApi = {
      getAccessCodeById: jest.fn().mockResolvedValue(row),
    };
    const { validatePanelAccessCodeSession } = createPanelAccess({
      dbApi,
      userActivity: new Map(),
      apiKeyLimiter: null,
    });
    const req = {
      session: {
        accessCodeId: 3,
        portalRole: 'admin',
        accessCode: 'ADMIN',
      },
    };

    await validatePanelAccessCodeSession(req, 'admin');
    await validatePanelAccessCodeSession(req, 'admin');

    expect(dbApi.getAccessCodeById).toHaveBeenCalledTimes(1);
    expect(req._accessCodeValidated).toEqual({ accessCodeId: 3, row });
  });

  it('forwards requireAdminAuth database failures to next', async () => {
    const dbError = new Error('db down');
    const { requireAdminAuth } = createPanelAccess({
      dbApi: {
        getAccessCodeById: jest.fn().mockRejectedValue(dbError),
        isAdmin: jest.fn(),
      },
      userActivity: new Map(),
      apiKeyLimiter: null,
    });
    const req = {
      session: {
        userId: 7,
        accessCodeId: 3,
        portalRole: 'admin',
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    await requireAdminAuth(req, res, next);

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('stores a missing access code lookup in cache', async () => {
    const dbApi = {
      getAccessCodeById: jest.fn().mockResolvedValue(null),
    };
    const { validatePanelAccessCodeSession } = createPanelAccess({
      dbApi,
      userActivity: new Map(),
      apiKeyLimiter: null,
    });
    const req = {
      session: {
        accessCodeId: 9,
        portalRole: 'admin',
      },
    };

    const result = await validatePanelAccessCodeSession(req, 'admin');

    expect(result).toBeNull();
    expect(redis.cacheSet).toHaveBeenCalledWith(
      'panel:access-code:9',
      { __missing: true },
      60
    );
  });
});
