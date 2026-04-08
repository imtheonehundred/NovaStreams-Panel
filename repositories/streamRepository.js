'use strict';

const { query, queryOne, insert, remove, execute } = require('../lib/mariadb');

async function listOutputFormats() {
  return await query('SELECT * FROM output_formats ORDER BY id');
}

async function listStreamArguments(cat) {
  if (cat) return await query('SELECT * FROM stream_arguments WHERE argument_cat = ? ORDER BY id', [cat]);
  return await query('SELECT * FROM stream_arguments ORDER BY id');
}

async function listProfiles() {
  return await query('SELECT * FROM profiles ORDER BY id');
}

async function getProfileById(id) {
  return await queryOne('SELECT * FROM profiles WHERE id = ?', [id]);
}

async function createProfile(name, options) {
  return await insert('INSERT INTO profiles (profile_name, profile_options) VALUES (?, ?)', [name, JSON.stringify(options || {})]);
}

async function updateProfile(id, name, options) {
  const sets = [];
  const vals = [];
  if (name !== undefined) { sets.push('profile_name = ?'); vals.push(name); }
  if (options !== undefined) { sets.push('profile_options = ?'); vals.push(JSON.stringify(options)); }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deleteProfile(id) {
  return await remove('DELETE FROM profiles WHERE id = ?', [id]);
}

module.exports = {
  listOutputFormats,
  listStreamArguments,
  listProfiles,
  getProfileById,
  createProfile,
  updateProfile,
  deleteProfile,
};
