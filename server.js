const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve HLS streams
app.use('/streams', express.static(path.join(__dirname, 'streams'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// In-memory channel store
const channels = new Map();
const processes = new Map();

// ========================
// API Routes
// ========================

// Get all channels
app.get('/api/channels', (req, res) => {
  const list = [];
  channels.forEach((ch, id) => {
    list.push({ id, ...ch, pid: processes.has(id) ? processes.get(id).pid : null });
  });
  res.json(list);
});

// Add new channel
app.post('/api/channels', (req, res) => {
  const { name, mpdUrl, headers, kid, key, pssh, type, qualities } = req.body;
  
  if (!name || !mpdUrl || !kid || !key) {
    return res.status(400).json({ error: 'name, mpdUrl, kid, key are required' });
  }

  const id = uuidv4().substring(0, 8);
  const channel = {
    name,
    mpdUrl,
    headers: headers || {},
    kid,
    key,
    pssh: pssh || '',
    type: type || 'WIDEVINE',
    qualities: qualities || 'best',
    status: 'stopped',
    createdAt: new Date().toISOString(),
    hlsUrl: null,
    error: null,
    viewers: 0
  };

  channels.set(id, channel);
  
  // Create stream directory
  const streamDir = path.join(__dirname, 'streams', id);
  if (!fs.existsSync(streamDir)) {
    fs.mkdirSync(streamDir, { recursive: true });
  }

  res.json({ id, ...channel });
});

// Update channel
app.put('/api/channels/:id', (req, res) => {
  const { id } = req.params;
  if (!channels.has(id)) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  const channel = channels.get(id);
  const updates = req.body;
  
  // Don't allow updating while running
  if (channel.status === 'running') {
    return res.status(400).json({ error: 'Stop the channel first before editing' });
  }

  Object.assign(channel, {
    name: updates.name || channel.name,
    mpdUrl: updates.mpdUrl || channel.mpdUrl,
    headers: updates.headers || channel.headers,
    kid: updates.kid || channel.kid,
    key: updates.key || channel.key,
    pssh: updates.pssh || channel.pssh,
    type: updates.type || channel.type,
    qualities: updates.qualities || channel.qualities,
  });

  channels.set(id, channel);
  res.json({ id, ...channel });
});

// Delete channel
app.delete('/api/channels/:id', (req, res) => {
  const { id } = req.params;
  if (!channels.has(id)) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  // Stop if running
  stopChannel(id);
  channels.delete(id);

  // Clean up stream directory
  const streamDir = path.join(__dirname, 'streams', id);
  if (fs.existsSync(streamDir)) {
    fs.rmSync(streamDir, { recursive: true, force: true });
  }

  res.json({ success: true });
});

// Start channel
app.post('/api/channels/:id/start', async (req, res) => {
  const { id } = req.params;
  if (!channels.has(id)) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  const channel = channels.get(id);
  
  if (channel.status === 'running') {
    return res.json({ message: 'Already running', hlsUrl: channel.hlsUrl });
  }

  try {
    await startChannel(id, channel);
    res.json({ id, status: channel.status, hlsUrl: channel.hlsUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop channel
app.post('/api/channels/:id/stop', (req, res) => {
  const { id } = req.params;
  if (!channels.has(id)) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  stopChannel(id);
  res.json({ id, status: 'stopped' });
});

// Restart channel
app.post('/api/channels/:id/restart', async (req, res) => {
  const { id } = req.params;
  if (!channels.has(id)) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  stopChannel(id);
  const channel = channels.get(id);
  
  // Wait a bit for cleanup
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  try {
    await startChannel(id, channel);
    res.json({ id, status: channel.status, hlsUrl: channel.hlsUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get channel logs
app.get('/api/channels/:id/logs', (req, res) => {
  const { id } = req.params;
  const logFile = path.join(__dirname, 'logs', `${id}.log`);
  
  if (fs.existsSync(logFile)) {
    const logs = fs.readFileSync(logFile, 'utf-8');
    // Return last 100 lines
    const lines = logs.split('\n').slice(-100).join('\n');
    res.json({ logs: lines });
  } else {
    res.json({ logs: '' });
  }
});

// ========================
// Restream Engine
// ========================

async function startChannel(id, channel) {
  const streamDir = path.join(__dirname, 'streams', id);
  const logFile = path.join(__dirname, 'logs', `${id}.log`);
  
  // Clean old segments
  if (fs.existsSync(streamDir)) {
    const files = fs.readdirSync(streamDir);
    files.forEach(f => fs.unlinkSync(path.join(streamDir, f)));
  } else {
    fs.mkdirSync(streamDir, { recursive: true });
  }

  // Build FFmpeg command
  const decryptionKey = `${channel.kid}:${channel.key}`;
  
  // Build custom headers for FFmpeg
  let headerArgs = [];
  if (channel.headers && Object.keys(channel.headers).length > 0) {
    const headerString = Object.entries(channel.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    headerArgs = ['-headers', headerString + '\r\n'];
  }

  const ffmpegArgs = [
    // Input options
    '-re',
    ...headerArgs,
    '-decryption_key', channel.key,
    '-i', channel.mpdUrl,
    
    // Output options
    '-c', 'copy',
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', path.join(streamDir, 'seg_%05d.ts'),
    path.join(streamDir, 'index.m3u8')
  ];

  console.log(`[${id}] Starting FFmpeg with args:`, ffmpegArgs.join(' '));
  
  // Log to file
  const logStream = fs.createWriteStream(logFile, { flags: 'w' });
  logStream.write(`[${new Date().toISOString()}] Starting channel: ${channel.name}\n`);
  logStream.write(`[${new Date().toISOString()}] MPD URL: ${channel.mpdUrl}\n`);
  logStream.write(`[${new Date().toISOString()}] Decryption Key: ${decryptionKey}\n`);
  logStream.write(`[${new Date().toISOString()}] FFmpeg args: ffmpeg ${ffmpegArgs.join(' ')}\n\n`);

  const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  processes.set(id, ffmpeg);
  channel.status = 'starting';
  channel.error = null;
  channel.hlsUrl = `/streams/${id}/index.m3u8`;

  ffmpeg.stdout.on('data', (data) => {
    logStream.write(data);
  });

  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    logStream.write(msg);
    
    // Detect when stream is actually running
    if (msg.includes('Opening') || msg.includes('Output #0')) {
      channel.status = 'running';
    }
  });

  ffmpeg.on('error', (err) => {
    console.error(`[${id}] FFmpeg error:`, err.message);
    logStream.write(`\n[ERROR] ${err.message}\n`);
    channel.status = 'error';
    channel.error = err.message;
    processes.delete(id);
    logStream.end();
  });

  ffmpeg.on('close', (code) => {
    console.log(`[${id}] FFmpeg exited with code ${code}`);
    logStream.write(`\n[EXIT] FFmpeg exited with code ${code}\n`);
    if (channel.status !== 'stopped') {
      channel.status = code === 0 ? 'stopped' : 'error';
      if (code !== 0) {
        channel.error = `FFmpeg exited with code ${code}`;
      }
    }
    processes.delete(id);
    logStream.end();
  });

  // Wait for m3u8 to appear (up to 30 seconds)
  return new Promise((resolve, reject) => {
    const m3u8Path = path.join(streamDir, 'index.m3u8');
    let attempts = 0;
    const maxAttempts = 60;
    
    const check = setInterval(() => {
      attempts++;
      if (fs.existsSync(m3u8Path)) {
        clearInterval(check);
        channel.status = 'running';
        resolve();
      } else if (attempts >= maxAttempts) {
        clearInterval(check);
        // Don't reject - FFmpeg might still be buffering
        channel.status = 'running';
        resolve();
      } else if (channel.status === 'error') {
        clearInterval(check);
        reject(new Error(channel.error || 'FFmpeg failed to start'));
      }
    }, 500);
  });
}

function stopChannel(id) {
  const channel = channels.get(id);
  if (channel) {
    channel.status = 'stopped';
    channel.error = null;
  }

  if (processes.has(id)) {
    const proc = processes.get(id);
    try {
      proc.kill('SIGTERM');
      // Force kill after 5 seconds
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch(e) {}
      }, 5000);
    } catch (e) {
      console.error(`Error stopping ${id}:`, e.message);
    }
    processes.delete(id);
  }
}

// ========================
// Cleanup on exit
// ========================
process.on('SIGINT', () => {
  console.log('Shutting down...');
  processes.forEach((proc, id) => {
    try { proc.kill('SIGTERM'); } catch(e) {}
  });
  process.exit(0);
});

process.on('SIGTERM', () => {
  processes.forEach((proc, id) => {
    try { proc.kill('SIGTERM'); } catch(e) {}
  });
  process.exit(0);
});

// ========================
// Start server
// ========================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ========================================
   MPD to HLS Restream Panel
   Running on http://0.0.0.0:${PORT}
  ========================================
  `);
});
