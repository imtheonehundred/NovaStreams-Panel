#!/usr/bin/env node
'use strict';

/**
 * SQLite → MariaDB migration script
 * Reads all data from SQLite, creates MariaDB schema, batch-inserts data, verifies row counts.
 *
 * Usage: node scripts/migrate-to-mariadb.js [--sqlite path/to/app.db]
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const mysql = require('mysql2/promise');

const BATCH_SIZE = 1000;

const SQLITE_PATH = process.argv.includes('--sqlite')
  ? process.argv[process.argv.indexOf('--sqlite') + 1]
  : path.join(__dirname, '..', 'data', 'app.db');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const TABLE_ORDER = [
  'users',
  'user_groups',
  'credits_logs',
  'api_keys',
  'lines',
  'lines_activity',
  'channels',
  'channel_health',
  'qoe_metrics',
  'qoe_agg',
  'stream_categories',
  'bouquets',
  'packages',
  'movies',
  'series',
  'episodes',
  'epg_sources',
  'epg_data',
  'settings',
  'blocked_ips',
  'blocked_uas',
  'blocked_isps',
  'output_formats',
  'panel_logs',
  'stream_arguments',
  'profiles',
  'auth_flood',
];

async function main() {
  console.log('=== SQLite → MariaDB Migration ===\n');

  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`SQLite database not found: ${SQLITE_PATH}`);
    process.exit(1);
  }

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  console.log(`[SQLite] Opened: ${SQLITE_PATH}`);

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'iptv',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'iptv_panel',
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4',
    multipleStatements: true,
  });

  console.log('[MariaDB] Connected');

  // Run schema
  console.log('\n[1/3] Creating MariaDB schema...');
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const conn = await pool.getConnection();
  try {
    await conn.query(schemaSql);
    console.log('  Schema created successfully');
  } finally {
    conn.release();
  }

  // Migrate tables
  console.log('\n[2/3] Migrating data...');
  const report = {};

  for (const table of TABLE_ORDER) {
    // Skip lines_live - connections move to Redis
    if (table === 'lines_live') continue;

    let sqliteRows;
    try {
      sqliteRows = sqlite.prepare(`SELECT * FROM ${table}`).all();
    } catch {
      console.log(`  ${table}: table not found in SQLite, skipping`);
      report[table] = { sqlite: 0, mariadb: 0, status: 'skipped' };
      continue;
    }

    if (sqliteRows.length === 0) {
      console.log(`  ${table}: empty, skipping`);
      report[table] = { sqlite: 0, mariadb: 0, status: 'empty' };
      continue;
    }

    const columns = Object.keys(sqliteRows[0]);
    const placeholders = columns.map(() => '?').join(', ');
    const colList = columns.map(c => `\`${c}\``).join(', ');
    const insertSql = `INSERT INTO \`${table}\` (${colList}) VALUES (${placeholders})`;

    let inserted = 0;
    const migConn = await pool.getConnection();
    try {
      await migConn.query(`SET FOREIGN_KEY_CHECKS = 0`);
      await migConn.query(`DELETE FROM \`${table}\``);

      for (let i = 0; i < sqliteRows.length; i += BATCH_SIZE) {
        const batch = sqliteRows.slice(i, i + BATCH_SIZE);
        await migConn.beginTransaction();
        try {
          for (const row of batch) {
            const values = columns.map(c => {
              const v = row[c];
              if (v === undefined) return null;
              return v;
            });
            await migConn.execute(insertSql, values);
          }
          await migConn.commit();
          inserted += batch.length;
        } catch (e) {
          await migConn.rollback();
          console.error(`  ${table}: batch error at offset ${i}: ${e.message}`);
          throw e;
        }
      }
      await migConn.query(`SET FOREIGN_KEY_CHECKS = 1`);
    } finally {
      migConn.release();
    }

    const [countResult] = await pool.execute(`SELECT COUNT(*) AS c FROM \`${table}\``);
    const mariaCount = countResult[0].c;

    const status = mariaCount === sqliteRows.length ? 'OK' : 'MISMATCH';
    report[table] = { sqlite: sqliteRows.length, mariadb: mariaCount, status };
    console.log(`  ${table}: ${sqliteRows.length} → ${mariaCount} [${status}]`);
  }

  // Verify
  console.log('\n[3/3] Verification Report:');
  console.log('─'.repeat(55));
  console.log(String('Table').padEnd(25) + String('SQLite').padStart(10) + String('MariaDB').padStart(10) + String('Status').padStart(10));
  console.log('─'.repeat(55));

  let allOk = true;
  for (const [table, r] of Object.entries(report)) {
    const mark = r.status === 'OK' ? '✓' : r.status === 'skipped' || r.status === 'empty' ? '–' : '✗';
    console.log(
      String(table).padEnd(25) +
      String(r.sqlite).padStart(10) +
      String(r.mariadb).padStart(10) +
      String(`${mark} ${r.status}`).padStart(10)
    );
    if (r.status === 'MISMATCH') allOk = false;
  }
  console.log('─'.repeat(55));

  if (allOk) {
    console.log('\nMigration completed successfully!');
  } else {
    console.log('\nWARNING: Some tables have mismatched row counts.');
  }

  sqlite.close();
  await pool.end();
  process.exit(allOk ? 0 : 1);
}

main().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});
