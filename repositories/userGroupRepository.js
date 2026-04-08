'use strict';

const { query, queryOne, insert, execute, remove } = require('../lib/mariadb');

async function listUserGroups() {
  return await query('SELECT * FROM user_groups ORDER BY group_id');
}

async function getUserGroupById(id) {
  return await queryOne('SELECT * FROM user_groups WHERE group_id = ?', [id]);
}

async function createUserGroup(data) {
  return await insert(
    'INSERT INTO user_groups (group_name, is_admin, is_reseller, allowed_pages) VALUES (?, ?, ?, ?)',
    [data.group_name || 'New Group', data.is_admin || 0, data.is_reseller || 0, data.allowed_pages || '[]']
  );
}

async function updateUserGroup(id, data) {
  const allowed = [
    'group_name', 'is_admin', 'is_reseller', 'total_allowed_gen_trials', 'total_allowed_gen_in',
    'delete_users', 'allowed_pages', 'can_delete', 'create_sub_resellers', 'create_sub_resellers_price',
    'allow_change_bouquets', 'allow_download', 'allow_restrictions', 'allow_change_username',
    'allow_change_password', 'minimum_trial_credits', 'notice_html', 'manage_expiry_media',
  ];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (data[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(data[k]); }
  }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE user_groups SET ${sets.join(', ')} WHERE group_id = ?`, vals);
}

async function deleteUserGroup(id) {
  return await remove('DELETE FROM user_groups WHERE group_id = ?', [id]);
}

module.exports = {
  listUserGroups,
  getUserGroupById,
  createUserGroup,
  updateUserGroup,
  deleteUserGroup,
};