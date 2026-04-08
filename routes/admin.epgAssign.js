'use strict';
const express = require('express');
const router = express.Router();

router.post('/epg/assign', async (req, res) => {
  return res.status(410).json({
    error: 'Mass EPG assignment is not available in the current admin UI.',
    code: 'EPG_MASS_ASSIGNMENT_REMOVED',
  });
});

router.post('/epg/auto-match', async (req, res) => {
  return res.status(410).json({
    error: 'EPG auto-match is not available in the current admin UI.',
    code: 'EPG_AUTO_MATCH_REMOVED',
  });
});

module.exports = router;
