/**
 * Resilient host metrics for Linux/Ubuntu: systeminformation can throw on restricted
 * environments, missing /proc access, or single failing collectors — we fall back to os/fs.
 */
const os = require('os');
const fs = require('fs');
const si = require('systeminformation');

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

function diskFromStatfsRoot() {
  try {
    if (typeof fs.statfsSync !== 'function') return null;
    const s = fs.statfsSync('/');
    const bs = Number(s.bsize) || 4096;
    const blocks = Number(s.blocks) || 0;
    const bfree = Number(s.bfree) || 0;
    const total = blocks * bs;
    const free = bfree * bs;
    if (total <= 0) return null;
    const used = total - free;
    return {
      use: (used / total) * 100,
      used,
      size: total,
    };
  } catch {
    return null;
  }
}

function memFromOs() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    total,
    available: free,
    swaptotal: 0,
    swapused: 0,
  };
}

function cpuPctFromLoadavg(cores) {
  const load = os.loadavg()[0] || 0;
  const c = Math.max(1, cores);
  return clamp((load / c) * 100, 0, 100);
}

async function collectSystemMetrics() {
  const cores = Math.max(1, os.cpus().length);
  const loadAvg = os.loadavg();

  const [rLoad, rMem, rFs, rNet] = await Promise.allSettled([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.networkStats(),
  ]);

  const warnings = [];

  if (rLoad.status === 'rejected') {
    warnings.push(`currentLoad: ${rLoad.reason && rLoad.reason.message}`);
  }
  if (rMem.status === 'rejected') {
    warnings.push(`mem: ${rMem.reason && rMem.reason.message}`);
  }
  if (rFs.status === 'rejected') {
    warnings.push(`fsSize: ${rFs.reason && rFs.reason.message}`);
  }
  if (rNet.status === 'rejected') {
    warnings.push(`networkStats: ${rNet.reason && rNet.reason.message}`);
  }

  let load = rLoad.status === 'fulfilled' ? rLoad.value : null;
  let mem = rMem.status === 'fulfilled' ? rMem.value : null;
  let fsSize = rFs.status === 'fulfilled' ? rFs.value : null;
  let netStats = rNet.status === 'fulfilled' ? rNet.value : null;

  let cpuPct = 0;
  if (load && typeof load.currentLoad === 'number' && Number.isFinite(load.currentLoad)) {
    cpuPct = clamp(load.currentLoad, 0, 100);
  } else {
    cpuPct = cpuPctFromLoadavg(cores);
  }

  if (!mem) {
    mem = memFromOs();
  }

  const memTotal = mem.total || os.totalmem();
  let memAvail =
    mem.available != null
      ? mem.available
      : mem.free != null
        ? mem.free
        : os.freemem();

  if (memAvail == null || memAvail > memTotal) memAvail = os.freemem();

  const ramPct = memTotal ? clamp(((memTotal - memAvail) / memTotal) * 100, 0, 100) : 0;

  const swaptotal = mem.swaptotal || 0;
  const swapused = mem.swapused || 0;
  const swapPct = swaptotal > 0 ? clamp((swapused / swaptotal) * 100, 0, 100) : 0;

  let diskMain = null;
  if (Array.isArray(fsSize) && fsSize.length) {
    diskMain = [...fsSize].sort((a, b) => (b.size || 0) - (a.size || 0))[0];
  }
  if (!diskMain || diskMain.use == null) {
    diskMain = diskFromStatfsRoot();
  }
  if (!diskMain) {
    diskMain = { use: 0, used: 0, size: 0 };
  }

  const net = Array.isArray(netStats)
    ? netStats.reduce(
        (acc, n) => {
          acc.rxSec += n.rx_sec || 0;
          acc.txSec += n.tx_sec || 0;
          return acc;
        },
        { rxSec: 0, txSec: 0 }
      )
    : { rxSec: 0, txSec: 0 };

  return {
    loadAvg,
    cores,
    cpuPct,
    mem: {
      total: memTotal,
      available: memAvail,
      swapused,
      swaptotal,
    },
    ramPct,
    swapPct,
    diskMain,
    net,
    warnings,
    source: {
      cpu: load ? 'systeminformation' : 'loadavg',
      mem: rMem.status === 'fulfilled' ? 'systeminformation' : 'os',
      disk: rFs.status === 'fulfilled' && Array.isArray(fsSize) && fsSize.length ? 'systeminformation' : 'statfs',
      net: rNet.status === 'fulfilled' ? 'systeminformation' : 'none',
    },
  };
}

module.exports = { collectSystemMetrics };
