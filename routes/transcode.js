'use strict';

const express = require('express');
const { csrfProtection } = require('../middleware/csrf');

module.exports = function transcodeRoutes({ requireAuth, dbApi, channels }) {
  const router = express.Router();

  router.get('/transcode-profiles', requireAuth, async (_req, res) => {
    try {
      const rows = await dbApi.listTranscodeProfiles();
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/transcode-profiles', requireAuth, csrfProtection, async (req, res) => {
    try {
      const {
        name,
        output_mode,
        video_encoder,
        x264_preset,
        rendition_mode,
        renditions,
        audio_bitrate_k,
        hls_segment_seconds,
        hls_playlist_size,
      } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
      const result = await dbApi.createTranscodeProfile({
        name: name.trim(),
        output_mode,
        video_encoder,
        x264_preset,
        rendition_mode,
        renditions,
        audio_bitrate_k,
        hls_segment_seconds,
        hls_playlist_size,
      });
      res.json({ id: result.insertId, message: 'Profile created' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/transcode-profiles/:id', requireAuth, csrfProtection, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await dbApi.getTranscodeProfile(id);
      if (!existing) return res.status(404).json({ error: 'Profile not found' });
      await dbApi.updateTranscodeProfile(id, req.body);
      res.json({ message: 'Profile updated' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/transcode-profiles/:id', requireAuth, csrfProtection, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await dbApi.getTranscodeProfile(id);
      if (!existing) return res.status(404).json({ error: 'Profile not found' });
      let inUse = false;
      channels.forEach((ch) => {
        if (ch.transcode_profile_id === id) inUse = true;
      });
      if (inUse) return res.status(409).json({ error: 'Profile is in use by one or more channels' });
      await dbApi.deleteTranscodeProfile(id);
      res.json({ message: 'Profile deleted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
