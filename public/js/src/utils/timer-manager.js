// Timer manager for centralized timer lifecycle management
// Used by Agent 5 (Timer Cleanup) to fix memory leaks from uncleared timers on page navigation

const _namedTimers = new Map();
const _pageTimers = new Map();

/**
 * Register a named timer for centralized cleanup
 * @param {string} name - Unique identifier for this timer
 * @param {number} timerRef - The setInterval or setTimeout reference
 * @param {'interval'|'timeout'} type - Type of timer
 * @param {string|null} pageKey - Page identifier for page-scoped timer cleanup
 */
export function registerTimer(name, timerRef, type = 'interval', pageKey = null) {
  _namedTimers.set(name, { ref: timerRef, type });
  if (pageKey) {
    if (!_pageTimers.has(pageKey)) _pageTimers.set(pageKey, new Set());
    _pageTimers.get(pageKey).add(name);
  }
}

/**
 * Clear a specific named timer
 * @param {string} name - Timer name to clear
 */
export function clearNamedTimer(name) {
  const entry = _namedTimers.get(name);
  if (entry) {
    if (entry.type === 'interval') clearInterval(entry.ref);
    else clearTimeout(entry.ref);
    _namedTimers.delete(name);
  }
}

/**
 * Clear all timers associated with a specific page
 * @param {string} pageKey - Page identifier
 */
export function clearPageTimers(pageKey) {
  const timers = _pageTimers.get(pageKey);
  if (timers) {
    for (const name of timers) clearNamedTimer(name);
    _pageTimers.delete(pageKey);
  }
}

/**
 * Clear all registered timers (global cleanup)
 */
export function clearAllTimers() {
  for (const [name, entry] of _namedTimers) {
    if (entry.type === 'interval') clearInterval(entry.ref);
    else clearTimeout(entry.ref);
  }
  _namedTimers.clear();
  _pageTimers.clear();
}

export default { registerTimer, clearNamedTimer, clearPageTimers, clearAllTimers };