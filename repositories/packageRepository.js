'use strict';

const { query, queryOne, insert, update, remove, execute } = require('../lib/mariadb');

async function listPackages() {
  return await query('SELECT * FROM packages ORDER BY id');
}

async function getPackageById(id) {
  return await queryOne('SELECT * FROM packages WHERE id = ?', [id]);
}

async function createPackage(data) {
  return await insert(
    `INSERT INTO packages (package_name, is_trial, is_official, trial_credits, official_credits, trial_duration, trial_duration_in, official_duration, official_duration_in, groups_json, bouquets_json, output_formats_json, options_json, max_connections, forced_country, is_line, is_mag, is_e2, is_restreamer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.package_name || 'New Package',
      data.is_trial || 0, data.is_official || 1,
      data.trial_credits || 0, data.official_credits || 0,
      data.trial_duration || 0, data.trial_duration_in || 'day',
      data.official_duration || 30, data.official_duration_in || 'month',
      JSON.stringify(data.groups || []),
      JSON.stringify(data.bouquets || []),
      JSON.stringify(data.output_formats || []),
      JSON.stringify(data.options != null ? data.options : {}),
      data.max_connections || 1,
      data.forced_country || '',
      data.is_line !== undefined ? data.is_line : 1,
      data.is_mag || 0, data.is_e2 || 0, data.is_restreamer || 0
    ]
  );
}

async function updatePackage(id, data) {
  const simple = ['package_name', 'is_trial', 'is_official', 'trial_credits', 'official_credits', 'trial_duration', 'trial_duration_in', 'official_duration', 'official_duration_in', 'max_connections', 'forced_country', 'is_line', 'is_mag', 'is_e2', 'is_restreamer'];
  const json = ['groups', 'bouquets', 'output_formats'];
  const sets = [];
  const vals = [];
  for (const k of simple) {
    if (data[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(data[k]); }
  }
  for (const k of json) {
    if (data[k] !== undefined) { sets.push(`${k}_json = ?`); vals.push(JSON.stringify(data[k])); }
  }
  if (data.options !== undefined) {
    sets.push('options_json = ?');
    vals.push(JSON.stringify(data.options));
  }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE packages SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deletePackage(id) {
  return await remove('DELETE FROM packages WHERE id = ?', [id]);
}

module.exports = {
  listPackages,
  getPackageById,
  createPackage,
  updatePackage,
  deletePackage,
};
