'use strict';

const state = require('../../../lib/state');

describe('State Library', () => {
  afterEach(() => {
    // Clean up test entries
    state.deleteChannel('test_ch1');
    state.deleteChannel('test_ch2');
    state.deleteProcess('test_proc1');
    state.deleteProcess('test_proc2');
    state.deleteUserActivity('test_user1');
    state.deleteUserActivity('test_user2');
    state.deleteQoeRate('test_ch1');
    state.deleteQoeRate('test_ch2');
  });

  describe('channels (Map export - backward compat)', () => {
    it('should be a Map', () => {
      expect(state.channels).toBeInstanceOf(Map);
    });

    it('should be empty initially', () => {
      state.deleteChannel('test_ch1');
      expect(state.channels.size).toBe(0);
    });
  });

  describe('channels getter/setter API', () => {
    it('should set and get values via getter/setter', () => {
      const ch = { id: 'test_ch1', name: 'Test Channel' };
      state.setChannel('test_ch1', ch);
      expect(state.getChannel('test_ch1')).toEqual(ch);
    });

    it('should check existence via hasChannel', () => {
      state.setChannel('test_ch1', { id: 'test_ch1' });
      expect(state.hasChannel('test_ch1')).toBe(true);
      expect(state.hasChannel('nonexistent')).toBe(false);
    });

    it('should delete via deleteChannel', () => {
      state.setChannel('test_ch1', { id: 'test_ch1' });
      state.deleteChannel('test_ch1');
      expect(state.hasChannel('test_ch1')).toBe(false);
    });

    it('should return count via getChannelCount', () => {
      state.setChannel('test_ch1', { id: 'test_ch1' });
      state.setChannel('test_ch2', { id: 'test_ch2' });
      expect(state.getChannelCount()).toBe(2);
    });

    it('should return all channels via getAllChannels', () => {
      state.setChannel('test_ch1', { id: 'test_ch1', name: 'Channel 1' });
      state.setChannel('test_ch2', { id: 'test_ch2', name: 'Channel 2' });
      const all = state.getAllChannels();
      expect(all).toHaveLength(2);
      expect(all.map(c => c.id)).toContain('test_ch1');
      expect(all.map(c => c.id)).toContain('test_ch2');
    });

    it('should return all channel ids via getAllChannelIds', () => {
      state.setChannel('test_ch1', { id: 'test_ch1' });
      state.setChannel('test_ch2', { id: 'test_ch2' });
      const ids = state.getAllChannelIds();
      expect(ids).toContain('test_ch1');
      expect(ids).toContain('test_ch2');
    });

    it('should iterate via forEachChannel', () => {
      const results = [];
      state.setChannel('test_ch1', { id: 'test_ch1' });
      state.setChannel('test_ch2', { id: 'test_ch2' });
      state.forEachChannel((ch, id) => results.push(id));
      expect(results).toContain('test_ch1');
      expect(results).toContain('test_ch2');
    });
  });

  describe('processes (Map export - backward compat)', () => {
    it('should be a Map', () => {
      expect(state.processes).toBeInstanceOf(Map);
    });
  });

  describe('processes getter/setter API', () => {
    it('should store process info via getter/setter', () => {
      const proc = { pid: 1234, startTime: Date.now() };
      state.setProcess('test_proc1', proc);
      expect(state.getProcess('test_proc1')).toEqual(proc);
    });

    it('should check existence via hasProcess', () => {
      state.setProcess('test_proc1', { pid: 1234 });
      expect(state.hasProcess('test_proc1')).toBe(true);
    });

    it('should delete via deleteProcess', () => {
      state.setProcess('test_proc1', { pid: 1234 });
      state.deleteProcess('test_proc1');
      expect(state.hasProcess('test_proc1')).toBe(false);
    });

    it('should return count via getProcessCount', () => {
      state.setProcess('test_proc1', { pid: 1234 });
      state.setProcess('test_proc2', { pid: 5678 });
      expect(state.getProcessCount()).toBe(2);
    });

    it('should return all processes via getAllProcesses', () => {
      state.setProcess('test_proc1', { pid: 1234 });
      state.setProcess('test_proc2', { pid: 5678 });
      const all = state.getAllProcesses();
      expect(all).toHaveLength(2);
    });
  });

  describe('runControllers', () => {
    it('should be a Map', () => {
      expect(state.runControllers).toBeInstanceOf(Map);
    });
  });

  describe('shadowProcesses', () => {
    it('should be a Map', () => {
      expect(state.shadowProcesses).toBeInstanceOf(Map);
    });
  });

  describe('tsBroadcasts', () => {
    it('should be a Map', () => {
      expect(state.tsBroadcasts).toBeInstanceOf(Map);
    });
  });

  describe('userActivity getter/setter API', () => {
    it('should track user activity', () => {
      const now = Date.now();
      state.setUserActivity('test_user1', now);
      expect(state.hasUserActivity('test_user1')).toBe(true);
    });

    it('should delete user activity', () => {
      state.setUserActivity('test_user1', Date.now());
      state.deleteUserActivity('test_user1');
      expect(state.hasUserActivity('test_user1')).toBe(false);
    });

    it('should return all user activities via getAllUserActivities', () => {
      state.setUserActivity('test_user1', Date.now());
      state.setUserActivity('test_user2', Date.now());
      const all = state.getAllUserActivities();
      expect(all).toHaveLength(2);
    });
  });

  describe('qoeRate getter/setter API', () => {
    it('should store QoE rates', () => {
      state.setQoeRate('test_ch1', 95.5);
      expect(state.getQoeRate('test_ch1')).toBe(95.5);
    });

    it('should check existence via hasQoeRate', () => {
      state.setQoeRate('test_ch1', 95.5);
      expect(state.hasQoeRate('test_ch1')).toBe(true);
    });

    it('should delete via deleteQoeRate', () => {
      state.setQoeRate('test_ch1', 95.5);
      state.deleteQoeRate('test_ch1');
      expect(state.hasQoeRate('test_ch1')).toBe(false);
    });

    it('should return all QoE rates via getAllQoeRates', () => {
      state.setQoeRate('test_ch1', 95.5);
      state.setQoeRate('test_ch2', 88.0);
      const all = state.getAllQoeRates();
      expect(all).toHaveLength(2);
    });
  });

  describe('stabilityMonitor', () => {
    it('should have getter and setter', () => {
      expect(state).toHaveProperty('stabilityMonitor');
    });

    it('should be settable', () => {
      const mockMonitor = { isRunning: true };
      state.stabilityMonitor = mockMonitor;
      expect(state.stabilityMonitor).toBe(mockMonitor);
      state.stabilityMonitor = null;
    });
  });
});
