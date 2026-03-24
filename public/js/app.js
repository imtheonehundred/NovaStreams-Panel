// ========================
// State
// ========================
let channels = [];
let refreshInterval = null;
let currentHlsInstance = null;
let currentBaseUrl = '';

// ========================
// Init
// ========================
document.addEventListener('DOMContentLoaded', () => {
  currentBaseUrl = window.location.origin;
  loadChannels();
  refreshInterval = setInterval(loadChannels, 3000);
});

// ========================
// API Calls
// ========================
async function apiCall(method, endpoint, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  
  const res = await fetch(`/api${endpoint}`, opts);
  return res.json();
}

async function loadChannels() {
  try {
    channels = await apiCall('GET', '/channels');
    renderChannels();
  } catch (err) {
    console.error('Failed to load channels:', err);
  }
}

// ========================
// Render
// ========================
function renderChannels() {
  const grid = document.getElementById('channelsGrid');
  const empty = document.getElementById('emptyState');

  // Stats
  document.getElementById('totalChannels').textContent = channels.length;
  document.getElementById('activeChannels').textContent = channels.filter(c => c.status === 'running').length;

  if (channels.length === 0) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.classList.remove('hidden');

  grid.innerHTML = channels.map(ch => `
    <div class="channel-card bg-dark-900 border border-dark-700 rounded-xl overflow-hidden animate-slideUp">
      <!-- Header -->
      <div class="p-4 border-b border-dark-800">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold text-lg truncate">${escHtml(ch.name)}</h3>
          ${getStatusBadge(ch.status)}
        </div>
        <div class="flex items-center gap-2 text-xs text-dark-400">
          <span class="bg-dark-800 px-2 py-1 rounded">${ch.type}</span>
          <span class="truncate">${ch.id}</span>
        </div>
      </div>

      <!-- Info -->
      <div class="p-4 space-y-2 text-sm">
        <div class="flex items-start gap-2">
          <i class="fas fa-link text-dark-500 mt-1 text-xs"></i>
          <span class="text-dark-400 truncate text-xs font-mono" title="${escHtml(ch.mpdUrl)}">${escHtml(ch.mpdUrl)}</span>
        </div>
        <div class="flex items-center gap-2">
          <i class="fas fa-fingerprint text-dark-500 text-xs"></i>
          <span class="text-dark-400 font-mono text-xs">KID: ${ch.kid ? ch.kid.substring(0, 16) + '...' : 'N/A'}</span>
        </div>
        ${ch.status === 'running' && ch.hlsUrl ? `
          <div class="mt-2 p-2 bg-dark-800 rounded-lg flex items-center justify-between">
            <code class="text-xs text-accent-400 font-mono truncate">${currentBaseUrl}${ch.hlsUrl}</code>
            <button onclick="copyToClipboard('${currentBaseUrl}${ch.hlsUrl}')" class="text-dark-400 hover:text-accent-400 mr-2 text-xs">
              <i class="fas fa-copy"></i>
            </button>
          </div>
        ` : ''}
        ${ch.error ? `
          <div class="mt-2 p-2 bg-red-900/20 border border-red-800/30 rounded-lg">
            <p class="text-xs text-red-400"><i class="fas fa-exclamation-triangle ml-1"></i> ${escHtml(ch.error)}</p>
          </div>
        ` : ''}
      </div>

      <!-- Actions -->
      <div class="p-3 border-t border-dark-800 flex items-center justify-between">
        <div class="flex gap-2">
          ${ch.status === 'running' ? `
            <button onclick="stopChannel('${ch.id}')" class="action-btn bg-red-900/30 text-red-400 hover:bg-red-900/50" title="ايقاف">
              <i class="fas fa-stop"></i>
            </button>
            <button onclick="restartChannel('${ch.id}')" class="action-btn bg-yellow-900/30 text-yellow-400 hover:bg-yellow-900/50" title="اعادة تشغيل">
              <i class="fas fa-redo"></i>
            </button>
            <button onclick="openPlayer('${ch.id}')" class="action-btn bg-accent-900/30 text-accent-400 hover:bg-accent-900/50" title="مشاهدة">
              <i class="fas fa-play"></i>
            </button>
          ` : `
            <button onclick="startChannel('${ch.id}')" class="action-btn bg-green-900/30 text-green-400 hover:bg-green-900/50" title="تشغيل">
              <i class="fas fa-play"></i>
            </button>
          `}
          <button onclick="viewLogs('${ch.id}')" class="action-btn bg-dark-800 text-dark-400 hover:bg-dark-700 hover:text-white" title="السجلات">
            <i class="fas fa-terminal"></i>
          </button>
        </div>
        <div class="flex gap-2">
          <button onclick="editChannel('${ch.id}')" class="action-btn bg-dark-800 text-dark-400 hover:bg-dark-700 hover:text-white" title="تعديل">
            <i class="fas fa-edit"></i>
          </button>
          <button onclick="deleteChannel('${ch.id}')" class="action-btn bg-dark-800 text-red-400/60 hover:bg-red-900/30 hover:text-red-400" title="حذف">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function getStatusBadge(status) {
  const map = {
    running:  { text: 'يعمل',    icon: 'circle', cls: 'status-running',  dot: 'pulse-dot' },
    stopped:  { text: 'متوقف',   icon: 'circle', cls: 'status-stopped',  dot: '' },
    starting: { text: 'يبدأ...', icon: 'spinner fa-spin', cls: 'status-starting', dot: '' },
    error:    { text: 'خطأ',     icon: 'exclamation-triangle', cls: 'status-error', dot: '' },
  };
  const s = map[status] || map.stopped;
  return `<span class="status-badge ${s.cls}"><i class="fas fa-${s.icon} text-[8px] ${s.dot}"></i> ${s.text}</span>`;
}

// ========================
// Channel Actions
// ========================
async function startChannel(id) {
  showToast('جاري تشغيل القناة...', 'info');
  try {
    const result = await apiCall('POST', `/channels/${id}/start`);
    if (result.error) {
      showToast(result.error, 'error');
    } else {
      showToast('تم تشغيل القناة بنجاح!', 'success');
    }
    loadChannels();
  } catch (err) {
    showToast('فشل تشغيل القناة', 'error');
  }
}

async function stopChannel(id) {
  try {
    await apiCall('POST', `/channels/${id}/stop`);
    showToast('تم ايقاف القناة', 'success');
    loadChannels();
  } catch (err) {
    showToast('فشل ايقاف القناة', 'error');
  }
}

async function restartChannel(id) {
  showToast('جاري اعادة تشغيل القناة...', 'info');
  try {
    await apiCall('POST', `/channels/${id}/restart`);
    showToast('تم اعادة التشغيل بنجاح!', 'success');
    loadChannels();
  } catch (err) {
    showToast('فشل اعادة التشغيل', 'error');
  }
}

async function deleteChannel(id) {
  const ch = channels.find(c => c.id === id);
  if (!confirm(`هل تريد حذف القناة "${ch?.name || id}"؟`)) return;
  
  try {
    await apiCall('DELETE', `/channels/${id}`);
    showToast('تم حذف القناة', 'success');
    loadChannels();
  } catch (err) {
    showToast('فشل حذف القناة', 'error');
  }
}

// ========================
// Modal: Add/Edit Channel
// ========================
function openAddModal() {
  document.getElementById('editId').value = '';
  document.getElementById('modalTitle').innerHTML = '<i class="fas fa-plus-circle text-accent-500 ml-2"></i> اضافة قناة جديدة';
  document.getElementById('saveBtn').textContent = 'حفظ القناة';
  document.getElementById('channelForm').reset();
  document.getElementById('channelModal').classList.remove('hidden');
}

function editChannel(id) {
  const ch = channels.find(c => c.id === id);
  if (!ch) return;

  if (ch.status === 'running') {
    showToast('اوقف القناة اولا قبل التعديل', 'warning');
    return;
  }

  document.getElementById('editId').value = id;
  document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit text-accent-500 ml-2"></i> تعديل القناة';
  document.getElementById('saveBtn').textContent = 'تحديث القناة';
  
  document.getElementById('channelName').value = ch.name;
  document.getElementById('channelType').value = ch.type;
  document.getElementById('mpdUrl').value = ch.mpdUrl;
  document.getElementById('psshData').value = ch.pssh || '';
  document.getElementById('channelKid').value = ch.kid;
  document.getElementById('channelKey').value = ch.key;
  document.getElementById('customHeaders').value = ch.headers ? JSON.stringify(ch.headers, null, 2) : '';
  
  document.getElementById('channelModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('channelModal').classList.add('hidden');
}

async function saveChannel(e) {
  e.preventDefault();
  
  let headers = {};
  const headersStr = document.getElementById('customHeaders').value.trim();
  if (headersStr) {
    try {
      headers = JSON.parse(headersStr);
    } catch (err) {
      showToast('صيغة Headers غير صحيحة (JSON)', 'error');
      return;
    }
  }

  const data = {
    name: document.getElementById('channelName').value.trim(),
    type: document.getElementById('channelType').value,
    mpdUrl: document.getElementById('mpdUrl').value.trim(),
    pssh: document.getElementById('psshData').value.trim(),
    kid: document.getElementById('channelKid').value.trim(),
    key: document.getElementById('channelKey').value.trim(),
    headers
  };

  const editId = document.getElementById('editId').value;

  try {
    if (editId) {
      await apiCall('PUT', `/channels/${editId}`, data);
      showToast('تم تحديث القناة بنجاح!', 'success');
    } else {
      await apiCall('POST', '/channels', data);
      showToast('تم اضافة القناة بنجاح!', 'success');
    }
    closeModal();
    loadChannels();
  } catch (err) {
    showToast('حدث خطأ اثناء الحفظ', 'error');
  }
}

// ========================
// Player Modal
// ========================
function openPlayer(id) {
  const ch = channels.find(c => c.id === id);
  if (!ch || !ch.hlsUrl) return;

  const fullUrl = `${currentBaseUrl}${ch.hlsUrl}`;
  
  document.getElementById('playerTitle').innerHTML = `<i class="fas fa-play-circle text-accent-500 ml-2"></i> ${escHtml(ch.name)}`;
  document.getElementById('playerUrlText').textContent = fullUrl;
  document.getElementById('playerModal').classList.remove('hidden');

  const video = document.getElementById('hlsPlayer');
  
  // Destroy previous instance
  if (currentHlsInstance) {
    currentHlsInstance.destroy();
    currentHlsInstance = null;
  }

  if (Hls.isSupported()) {
    const hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: true,
    });
    hls.loadSource(fullUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
    });
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.error('HLS Fatal Error:', data);
      }
    });
    currentHlsInstance = hls;
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = fullUrl;
    video.play().catch(() => {});
  }
}

function closePlayer() {
  document.getElementById('playerModal').classList.add('hidden');
  const video = document.getElementById('hlsPlayer');
  video.pause();
  video.src = '';
  if (currentHlsInstance) {
    currentHlsInstance.destroy();
    currentHlsInstance = null;
  }
}

function copyHlsUrl() {
  const url = document.getElementById('playerUrlText').textContent;
  copyToClipboard(url);
}

// ========================
// Logs Modal
// ========================
async function viewLogs(id) {
  const ch = channels.find(c => c.id === id);
  document.getElementById('logsTitle').innerHTML = `<i class="fas fa-terminal text-accent-500 ml-2"></i> سجلات: ${escHtml(ch?.name || id)}`;
  document.getElementById('logsContent').textContent = 'جاري التحميل...';
  document.getElementById('logsModal').classList.remove('hidden');

  try {
    const result = await apiCall('GET', `/channels/${id}/logs`);
    document.getElementById('logsContent').textContent = result.logs || 'لا توجد سجلات بعد';
  } catch (err) {
    document.getElementById('logsContent').textContent = 'فشل تحميل السجلات';
  }
}

function closeLogsModal() {
  document.getElementById('logsModal').classList.add('hidden');
}

// ========================
// Utilities
// ========================
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('تم النسخ!', 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('تم النسخ!', 'success');
  });
}

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toastIcon');
  const msgEl = document.getElementById('toastMsg');

  const icons = {
    success: 'fa-check-circle text-success',
    error: 'fa-times-circle text-danger',
    warning: 'fa-exclamation-triangle text-warning',
    info: 'fa-info-circle text-accent-400'
  };

  icon.className = `fas ${icons[type] || icons.success}`;
  msgEl.textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.add('animate-fadeIn');

  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}
