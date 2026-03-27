'use strict';

const { query, queryOne, getPool } = require('../lib/mariadb');

const TABLES_TO_MAINTAIN = ['streams', 'streams_series', 'streams_episodes', 'bouquets'];
const TASK_TIMEOUT_MS = 90_000;
let runningTask = null;

function withTimeout(promise, ms, label) {
  let timer = null;
  return Promise.race([
    promise.finally(() => { if (timer) clearTimeout(timer); }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]);
}

async function getDatabaseStatus() {
  const rows = await query(
    `SELECT table_name, ROUND((data_length + index_length) / 1024 / 1024, 2) AS size_mb
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
      ORDER BY (data_length + index_length) DESC`
  );
  const tables = rows.map((r) => ({ table_name: r.table_name, size_mb: Number(r.size_mb) || 0 }));
  const totalSizeMb = tables.reduce((sum, t) => sum + t.size_mb, 0);
  return {
    total_tables: tables.length,
    total_size_mb: Number(totalSizeMb.toFixed(2)),
    tables,
  };
}

async function getDatabasePerformance() {
  const rows = await query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Slow_queries','Queries','Uptime')");
  const map = {};
  for (const r of rows) map[r.Variable_name] = Number(r.Value) || 0;
  return {
    Threads_connected: map.Threads_connected || 0,
    Slow_queries: map.Slow_queries || 0,
    Queries: map.Queries || 0,
    Uptime: map.Uptime || 0,
  };
}

async function getDatabaseLive() {
  const perf = await getDatabasePerformance();
  const uptime = perf.Uptime > 0 ? perf.Uptime : 1;
  const qps = Number((perf.Queries / uptime).toFixed(2));
  const memRows = await query(
    "SHOW GLOBAL STATUS WHERE Variable_name IN ('Innodb_buffer_pool_bytes_data','Innodb_buffer_pool_bytes_dirty')"
  );
  const mem = {};
  for (const r of memRows) mem[r.Variable_name] = Number(r.Value) || 0;
  return {
    current_connections: perf.Threads_connected,
    queries_per_second: qps,
    memory: {
      innodb_buffer_pool_bytes_data: mem.Innodb_buffer_pool_bytes_data || 0,
      innodb_buffer_pool_bytes_dirty: mem.Innodb_buffer_pool_bytes_dirty || 0,
    },
  };
}

async function runMaintenanceTask(type, source = 'manual') {
  if (runningTask) throw new Error(`database maintenance already running (${runningTask})`);
  runningTask = type;
  const conn = await getPool().getConnection();
  try {
    await conn.query('SET SESSION max_statement_time = 60');
    const sqlVerb = type === 'repair' ? 'REPAIR' : 'OPTIMIZE';
    const results = [];
    await withTimeout((async () => {
      for (const tableName of TABLES_TO_MAINTAIN) {
        // table names are fixed from internal allowlist
        const [rows] = await conn.query(`${sqlVerb} TABLE \`${tableName}\``);
        results.push({ table: tableName, result: rows });
      }
    })(), TASK_TIMEOUT_MS, `${type} database`);
    return {
      ok: true,
      action: type,
      source,
      tables: TABLES_TO_MAINTAIN.slice(),
      results,
      message: `${sqlVerb} completed`,
    };
  } finally {
    runningTask = null;
    conn.release();
  }
}

async function optimizeDatabase(opts = {}) {
  return await runMaintenanceTask('optimize', opts.source || 'manual');
}

async function repairDatabase(opts = {}) {
  return await runMaintenanceTask('repair', opts.source || 'manual');
}

function getRunningTask() {
  return runningTask;
}

module.exports = {
  TABLES_TO_MAINTAIN,
  getRunningTask,
  getDatabaseStatus,
  getDatabasePerformance,
  getDatabaseLive,
  optimizeDatabase,
  repairDatabase,
};

