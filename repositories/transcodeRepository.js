'use strict';

const { query, queryOne, insert, execute, remove } = require('../lib/mariadb');

async function listTranscodeProfiles() {
  return await query('SELECT id, name, output_mode, video_encoder, x264_preset, rendition_mode, renditions, audio_bitrate_k, hls_segment_seconds, hls_playlist_size, created_at, updated_at FROM transcode_profiles ORDER BY id');
}

async function getTranscodeProfile(id) {
  return await queryOne('SELECT * FROM transcode_profiles WHERE id = ?', [id]);
}

async function createTranscodeProfile(data) {
  return await insert(
    'INSERT INTO transcode_profiles (name, output_mode, video_encoder, x264_preset, rendition_mode, renditions, audio_bitrate_k, hls_segment_seconds, hls_playlist_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      data.name || 'Untitled',
      data.output_mode || 'copy',
      data.video_encoder || 'cpu_x264',
      data.x264_preset || 'veryfast',
      data.rendition_mode || 'single',
      JSON.stringify(data.renditions || ['1080p']),
      parseInt(data.audio_bitrate_k, 10) || 128,
      parseInt(data.hls_segment_seconds, 10) || 4,
      parseInt(data.hls_playlist_size, 10) || 10,
    ]
  );
}

async function updateTranscodeProfile(id, data) {
  const allowed = ['name', 'output_mode', 'video_encoder', 'x264_preset', 'rendition_mode', 'audio_bitrate_k', 'hls_segment_seconds', 'hls_playlist_size'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (data[k] !== undefined) { sets.push(`\`${k}\` = ?`); vals.push(data[k]); }
  }
  if (data.renditions !== undefined) { sets.push('`renditions` = ?'); vals.push(JSON.stringify(data.renditions)); }
  if (sets.length === 0) return;
  vals.push(id);
  await execute(`UPDATE transcode_profiles SET ${sets.join(', ')} WHERE id = ?`, vals);
}

async function deleteTranscodeProfile(id) {
  return await remove('DELETE FROM transcode_profiles WHERE id = ?', [id]);
}

module.exports = {
  listTranscodeProfiles,
  getTranscodeProfile,
  createTranscodeProfile,
  updateTranscodeProfile,
  deleteTranscodeProfile,
};
