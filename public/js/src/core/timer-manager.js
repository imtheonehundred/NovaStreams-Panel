// Timer manager for centralized timer lifecycle management
// Source: public/js/src/utils/timer-manager.js

const _pageTimers = new Map(); // pageKey → Set of { id, type }

export const timerManager = {
  setInterval(pageKey, fn, ms) {
    const id = window.setInterval(fn, ms);
    if (!_pageTimers.has(pageKey)) _pageTimers.set(pageKey, new Set());
    _pageTimers.get(pageKey).add({ id, type: 'interval' });
    return id;
  },

  setTimeout(pageKey, fn, ms) {
    const id = window.setTimeout(() => {
      fn();
      this.remove(pageKey, id);
    }, ms);
    if (!_pageTimers.has(pageKey)) _pageTimers.set(pageKey, new Set());
    _pageTimers.get(pageKey).add({ id, type: 'timeout' });
    return id;
  },

  clear(pageKey, timerId) {
    const set = _pageTimers.get(pageKey);
    if (!set) return;
    for (const entry of set) {
      if (entry.id === timerId) {
        if (entry.type === 'interval') clearInterval(entry.id);
        else clearTimeout(entry.id);
        set.delete(entry);
        break;
      }
    }
  },

  clearPageTimers(pageKey) {
    const set = _pageTimers.get(pageKey);
    if (!set) return;
    for (const { id, type } of set) {
      if (type === 'interval') clearInterval(id);
      else clearTimeout(id);
    }
    _pageTimers.delete(pageKey);
  },

  clearAll() {
    for (const key of _pageTimers.keys()) this.clearPageTimers(key);
  },

  // Register a named timer (for backward compatibility with existing code)
  register(name, timerRef, type = 'interval', pageKey = null) {
    if (!_pageTimers.has(pageKey)) _pageTimers.set(pageKey, new Set());
    _pageTimers.get(pageKey).add({ id: timerRef, type, name });
  }
};

export default timerManager;