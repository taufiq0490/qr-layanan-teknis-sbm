function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getAuthHeaders() {
  const token = localStorage.getItem('admin_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['x-admin-token'] = token;
  return headers;
}

// --- SUPER ADMIN AUTH MODAL HELPER ---
window.requestSuperAdminAuth = function(options = {}) {
  const { 
    title = 'Otorisasi Super Admin', 
    desc = 'Masukkan kata sandi Super Admin untuk melanjutkan tindakan ini.', 
    onSuccess 
  } = options;

  return new Promise((resolve) => {
    let modal = document.getElementById('superAdminAuthModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'superAdminAuthModal';
      modal.className = 'superadmin-modal-overlay';
      modal.innerHTML = `
        <div class="superadmin-modal-card">
          <div class="superadmin-modal-icon">🔒</div>
          <h3 class="superadmin-modal-title" id="saModalTitle">Otorisasi Super Admin</h3>
          <p class="superadmin-modal-desc" id="saModalDesc">Masukkan kata sandi Super Admin untuk melanjutkan.</p>
          
          <div id="saModalError" class="superadmin-modal-error"></div>

          <form id="saModalForm">
            <div class="superadmin-modal-input-group">
              <label class="superadmin-modal-label" for="saPasswordInput">Kata Sandi Super Admin:</label>
              <input type="password" id="saPasswordInput" class="superadmin-modal-input" placeholder="Masukkan kata sandi super admin..." required autocomplete="current-password">
            </div>
            
            <div class="superadmin-modal-actions">
              <button type="button" class="superadmin-modal-btn-cancel" id="saModalCancel">Batal</button>
              <button type="submit" class="superadmin-modal-btn-submit" id="saModalSubmit">Verifikasi ➔</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(modal);

      const cancelBtn = modal.querySelector('#saModalCancel');
      cancelBtn.addEventListener('click', () => {
        modal.classList.remove('active');
        resolve(false);
      });

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('active');
          resolve(false);
        }
      });
    }

    const titleEl = modal.querySelector('#saModalTitle');
    const descEl = modal.querySelector('#saModalDesc');
    const errorEl = modal.querySelector('#saModalError');
    const inputEl = modal.querySelector('#saPasswordInput');
    const formEl = modal.querySelector('#saModalForm');
    const submitBtn = modal.querySelector('#saModalSubmit');

    titleEl.textContent = title;
    descEl.textContent = desc;
    errorEl.style.display = 'none';
    errorEl.textContent = '';
    inputEl.value = '';

    modal.classList.add('active');
    setTimeout(() => inputEl.focus(), 50);

    formEl.onsubmit = async (e) => {
      e.preventDefault();
      const password = inputEl.value;
      if (!password) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Memverifikasi...';
      errorEl.style.display = 'none';

      try {
        const res = await fetch('/api/admin/verify-superadmin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (data.success) {
          if (data.token) {
            localStorage.setItem('admin_token', data.token);
            localStorage.setItem('admin_role', 'superadmin');
          }
          modal.classList.remove('active');
          updateRoleBadgeUI('superadmin');
          if (typeof onSuccess === 'function') onSuccess();
          resolve(true);
        } else {
          errorEl.textContent = '❌ ' + (data.error || 'Kata sandi Super Admin salah.');
          errorEl.style.display = 'block';
          inputEl.focus();
        }
      } catch (err) {
        errorEl.textContent = '❌ Terjadi kesalahan jaringan. Silakan coba lagi.';
        errorEl.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Verifikasi ➔';
      }
    };
  });
};

window.ensureSuperAdmin = async function(options = {}) {
  try {
    const res = await fetch('/api/admin/check-auth', {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (data.isSuperAdmin) {
      updateRoleBadgeUI('superadmin');
      if (typeof options.onSuccess === 'function') options.onSuccess();
      return true;
    } else {
      updateRoleBadgeUI('admin');
    }
  } catch (e) {}

  return await window.requestSuperAdminAuth(options);
};

function updateRoleBadgeUI(role) {
  const badgeContainer = document.getElementById('userRoleBadge');
  if (badgeContainer) {
    if (role === 'superadmin') {
      badgeContainer.className = 'role-badge superadmin';
      badgeContainer.innerHTML = '👑 Super Admin';
    } else {
      badgeContainer.className = 'role-badge admin';
      badgeContainer.innerHTML = '👤 Staf';
    }
  }
}

let currentFilter = 'all';
let previousTicketCount = null;
let lastRenderedKey = '';
let knownTicketIds = new Set();
let latestLoadedTickets = [];

// Helper untuk update tampilan status audio di UI
function updateAudioControlsUI() {
  if (!window.SoundNotifier) return;
  const sn = window.SoundNotifier;

  const select = document.getElementById('selectSoundType');
  if (select) select.value = sn.soundType;

  const slider = document.getElementById('sliderVolume');
  const volText = document.getElementById('volumePercentText');
  if (slider) slider.value = sn.volume;
  if (volText) volText.textContent = Math.round(sn.volume * 100) + '%';

  const chkLoop = document.getElementById('chkLoopAlarm');
  if (chkLoop) chkLoop.checked = sn.loopEnabled;

  const statusBadge = document.getElementById('audioStatusBadge');
  const statusText = document.getElementById('audioStatusText');
  const muteBtnIcon = document.getElementById('muteBtnIcon');
  const muteBtnText = document.getElementById('muteBtnText');

  if (sn.isMuted) {
    if (statusBadge) {
      statusBadge.className = 'audio-status-pill muted';
      statusBadge.innerHTML = '<span>🔇</span> <span id="audioStatusText">Suara: SENYAP (Mute)</span>';
    }
    if (muteBtnIcon) muteBtnIcon.textContent = '🔇';
    if (muteBtnText) muteBtnText.textContent = 'Unmute';
  } else {
    if (statusBadge) {
      statusBadge.className = 'audio-status-pill';
      statusBadge.innerHTML = `
        <span class="sound-wave-anim">
          <span class="sound-wave-bar"></span>
          <span class="sound-wave-bar"></span>
          <span class="sound-wave-bar"></span>
          <span class="sound-wave-bar"></span>
        </span>
        <span id="audioStatusText">Suara Panggilan: AKTIF</span>
      `;
    }
    if (muteBtnIcon) muteBtnIcon.textContent = '🔊';
    if (muteBtnText) muteBtnText.textContent = 'Mute';
  }

  const alarmInd = document.getElementById('activeAlarmIndicator');
  if (alarmInd) {
    alarmInd.style.display = sn.isLooping ? 'inline-block' : 'none';
  }
}

async function handleLogout() {
  if (confirm('Apakah Anda yakin ingin keluar dari sesi admin?')) {
    try {
      await fetch('/api/admin/logout', {
        method: 'POST',
        headers: getAuthHeaders()
      });
    } catch (e) {}
    localStorage.removeItem('admin_token');
    window.location.href = '/login';
  }
}

// SSE Real-time Events Listener (Instant 0ms push)
function setupRealtimeEvents() {
  if (!window.EventSource) return;
  try {
    const es = new EventSource('/api/events');
    es.addEventListener('new_ticket', (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload && payload.ticket) {
          const exists = latestLoadedTickets.some(t => t.id === payload.ticket.id);
          if (!exists) {
            latestLoadedTickets.unshift(payload.ticket);
            const waitingCount = latestLoadedTickets.filter(t => t.status === 'Menunggu').length;
            if (window.SoundNotifier && payload.ticket.status === 'Menunggu') {
              if (window.SoundNotifier.loopEnabled) {
                window.SoundNotifier.startContinuousAlert(waitingCount);
              } else {
                window.SoundNotifier.playIncomingCallSound();
              }
              window.SoundNotifier.showDesktopNotification(
                `🚨 Panggilan Baru: Ruang ${payload.ticket.room}`,
                `Kendala: ${payload.ticket.category || 'Dukungan Teknis'}\nCatatan: ${payload.ticket.notes || '-'}`
              );
              window.SoundNotifier.startTitleBlink(`🚨 (${waitingCount}) Panggilan Ruang ${payload.ticket.room}`);
            }
          }
        }
      } catch (err) {}
      loadTickets();
    });

    es.addEventListener('ticket_updated', (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload && payload.ticket) {
          const idx = latestLoadedTickets.findIndex(t => t.id === payload.ticket.id);
          if (idx !== -1) {
            latestLoadedTickets[idx] = payload.ticket;
          }
        }
      } catch (err) {}
      loadTickets();
    });

    es.addEventListener('tickets_cleared', () => {
      latestLoadedTickets = [];
      loadTickets();
    });
  } catch (e) {
    console.warn('Realtime SSE error:', e);
  }
}

let latestTicketRequestSeq = 0;

async function loadTickets() {
  const thisSeq = ++latestTicketRequestSeq;
  try {
    const res = await fetch(`/api/tickets?_t=${Date.now()}&_seq=${thisSeq}`, {
      cache: 'no-store',
      headers: getAuthHeaders()
    });
    if (res.status === 401) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }
    const data = await res.json();
    
    // Guard against out-of-order async responses (discard older requests)
    if (thisSeq < latestTicketRequestSeq) {
      return;
    }

    if (!data.success || !Array.isArray(data.tickets)) return;

    const tickets = data.tickets;
    latestLoadedTickets = tickets;
    const waitingTickets = tickets.filter(t => t.status === 'Menunggu');
    const waitingCount = waitingTickets.length;

    // Check for NEW tickets to trigger ringtone & desktop notification
    if (previousTicketCount !== null) {
      // Find newly added tickets
      const newWaiting = waitingTickets.filter(t => !knownTicketIds.has(t.id));

      if (newWaiting.length > 0) {
        // Mainkan nada notifikasi
        if (window.SoundNotifier) {
          if (window.SoundNotifier.loopEnabled) {
            window.SoundNotifier.startContinuousAlert(waitingCount);
          } else {
            window.SoundNotifier.playIncomingCallSound();
          }

          // Notifikasi Desktop Browser
          const newest = newWaiting[0];
          const notifTitle = `🚨 Panggilan Baru: Ruang ${newest.room}`;
          const notifBody = `Kendala: ${newest.category || 'Dukungan Teknis'}\nCatatan: ${newest.notes || '-'}`;
          window.SoundNotifier.showDesktopNotification(notifTitle, notifBody);

          // Berkedip di judul tab
          window.SoundNotifier.startTitleBlink(`🚨 (${waitingCount}) Panggilan Ruang ${newest.room}`);
        }
      } else if (waitingCount === 0 && window.SoundNotifier) {
        // Hentikan alarm jika tidak ada tiket menunggu lagi
        window.SoundNotifier.stopContinuousAlert();
      }
    }

    // Perbarui set ID tiket yang diketahui
    knownTicketIds = new Set(tickets.map(t => t.id));
    previousTicketCount = waitingCount;

    // Update alarm indicator di UI
    const alarmInd = document.getElementById('activeAlarmIndicator');
    if (alarmInd && window.SoundNotifier) {
      alarmInd.style.display = window.SoundNotifier.isLooping ? 'inline-block' : 'none';
    }

    // Update Stats
    document.getElementById('statMenunggu').textContent = waitingCount;
    document.getElementById('statDiproses').textContent = tickets.filter(t => t.status === 'Diproses').length;
    document.getElementById('statSelesai').textContent = tickets.filter(t => t.status === 'Selesai').length;
    document.getElementById('statTotal').textContent = tickets.length;

    // Filter tickets
    let displayTickets = tickets;
    if (currentFilter !== 'all') {
      displayTickets = tickets.filter(t => t.status.toLowerCase() === currentFilter.toLowerCase());
    }

    // Smart Render: only re-render if data has changed to keep UI ultra-smooth
    const currentKey = currentFilter + '_' + JSON.stringify(displayTickets.map(t => [t.id, t.status, t.handledBy, t.updatedAt]));
    if (currentKey !== lastRenderedKey) {
      lastRenderedKey = currentKey;
      renderTable(displayTickets);
    }
    
    const now = new Date();
    document.getElementById('lastUpdateTime').textContent = 'Terakhir diperbarui: ' + now.toLocaleTimeString('id-ID');
  } catch (err) {
    console.error('Error loading tickets:', err);
  }
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '< 1 mnt';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} dtk`;
  if (m < 60) return s > 0 ? `${m} mnt ${s} dtk` : `${m} mnt`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h} jam ${remM} mnt` : `${h} jam`;
}

function renderTable(tickets) {
  const tbody = document.getElementById('ticketsTableBody');
  
  if (tickets.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 30px; color: var(--text-muted);">
          Tidak ada panggilan tiket yang sesuai filter saat ini.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = tickets.map(ticket => {
    const dateObj = new Date(ticket.createdAt);
    const timeStr = dateObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
    const dateStr = dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

    let completedTimeInfo = '';
    if (ticket.completedAt) {
      const compObj = new Date(ticket.completedAt);
      const compTimeStr = compObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
      completedTimeInfo = `<div style="font-size: 0.72rem; color: #059669; margin-top: 2px;">Selesai: ${compTimeStr}</div>`;
    }

    let badgeClass = 'badge-menunggu';
    if (ticket.status === 'Diproses') badgeClass = 'badge-diproses';
    if (ticket.status === 'Selesai') badgeClass = 'badge-selesai';

    let actionButtons = '';
    if (ticket.status === 'Menunggu') {
      actionButtons = `
        <div class="action-btn-group">
          <button class="btn-xs btn-primary" onclick="promptProcess('${ticket.id}')">
            🛠️ Proses
          </button>
          <button class="btn-xs btn-success" onclick="updateStatus('${ticket.id}', 'Selesai')">
            ✓ Selesai
          </button>
        </div>
      `;
    } else if (ticket.status === 'Diproses') {
      actionButtons = `
        <div class="action-btn-group">
          <button class="btn-xs btn-success" onclick="updateStatus('${ticket.id}', 'Selesai')">
            ✓ Selesaikan
          </button>
        </div>
      `;
    } else {
      actionButtons = `
        <div style="font-size: 0.75rem; color: #059669; font-weight: 700;">
          ⏱️ Selesai (${formatDuration(ticket.resolutionTimeSeconds)})
        </div>
      `;
    }

    const safeRoom = escapeHTML(ticket.room);
    const safeCategory = escapeHTML(ticket.category || 'Umum');
    const safeNotes = escapeHTML(ticket.notes);
    const safeHandledBy = escapeHTML(ticket.handledBy || '-');

    return `
      <tr>
        <td style="white-space: nowrap;">
          <div style="font-weight: 700; color: var(--text-dark);">${timeStr}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${dateStr}</div>
          ${completedTimeInfo}
        </td>
        <td>
          <div style="font-weight: 800; font-size: 1rem; color: var(--primary);">📍 ${safeRoom}</div>
        </td>
        <td>
          <span style="font-weight: 600;">${safeCategory}</span>
        </td>
        <td>
          <span style="color: ${ticket.notes ? '#334155' : '#94A3B8'}; font-style: ${ticket.notes ? 'normal' : 'italic'};">
            ${safeNotes || '-'}
          </span>
        </td>
        <td>
          <span style="font-weight: 600; color: #1E40AF;">
            ${ticket.handledBy ? `👤 ${safeHandledBy}` : '<span style="color: #94A3B8;">-</span>'}
          </span>
        </td>
        <td>
          <span class="badge ${badgeClass}">${ticket.status}</span>
        </td>
        <td>
          ${actionButtons}
        </td>
      </tr>
    `;
  }).join('');
}

async function promptProcess(ticketId) {
  const staff = prompt('Masukkan nama staf support yang menangani tiket ini:', 'Bpk. Amir');
  if (staff === null) return; // user cancelled
  await updateStatus(ticketId, 'Diproses', staff.trim() || 'Tim Support');
}

async function updateStatus(ticketId, newStatus, handledBy = "") {
  try {
    const payload = { status: newStatus };
    if (handledBy) payload.handledBy = handledBy;

    const res = await fetch(`/api/tickets/${ticketId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    const data = await res.json();
    if (data.success) {
      loadTickets();
    } else {
      alert('Gagal update status: ' + data.error);
    }
  } catch (err) {
    console.error('Error updating status:', err);
    alert('Terjadi kesalahan jaringan.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Inisialisasi UI Audio Controls
  updateAudioControlsUI();

  // Inisialisasi Koneksi Realtime SSE (Instant Push Notification 0ms)
  setupRealtimeEvents();

  // Load Data Tiket
  loadTickets();

  // Fallback Polling interval (2 detik) dengan anti-cache
  setInterval(loadTickets, 2000);

  // Setup Listener Kontrol Audio
  const selectSound = document.getElementById('selectSoundType');
  if (selectSound) {
    selectSound.addEventListener('change', (e) => {
      if (window.SoundNotifier) {
        window.SoundNotifier.setSoundType(e.target.value);
        window.SoundNotifier.testSound(e.target.value);
      }
    });
  }

  const sliderVol = document.getElementById('sliderVolume');
  if (sliderVol) {
    sliderVol.addEventListener('input', (e) => {
      if (window.SoundNotifier) {
        window.SoundNotifier.setVolume(e.target.value);
        const volText = document.getElementById('volumePercentText');
        if (volText) volText.textContent = Math.round(e.target.value * 100) + '%';
      }
    });
    sliderVol.addEventListener('change', () => {
      if (window.SoundNotifier) {
        window.SoundNotifier.testSound();
      }
    });
  }

  const btnTest = document.getElementById('btnTestSound');
  if (btnTest) {
    btnTest.addEventListener('click', () => {
      if (window.SoundNotifier) {
        window.SoundNotifier.testSound();
      }
    });
  }

  const btnMute = document.getElementById('btnToggleMute');
  if (btnMute) {
    btnMute.addEventListener('click', () => {
      if (window.SoundNotifier) {
        window.SoundNotifier.setMuted(!window.SoundNotifier.isMuted);
        updateAudioControlsUI();
      }
    });
  }

  const chkLoop = document.getElementById('chkLoopAlarm');
  if (chkLoop) {
    chkLoop.addEventListener('change', (e) => {
      if (window.SoundNotifier) {
        window.SoundNotifier.setLoopEnabled(e.target.checked);
      }
    });
  }

  const btnDesktopNotif = document.getElementById('btnDesktopNotif');
  if (btnDesktopNotif) {
    btnDesktopNotif.addEventListener('click', async () => {
      if (window.SoundNotifier) {
        const granted = await window.SoundNotifier.requestNotificationPermission();
        if (granted) {
          alert('✅ Notifikasi Desktop Aktif!\nAnda akan menerima pemberitahuan otomatis saat ada panggilan kelas baru.');
          window.SoundNotifier.showDesktopNotification('🔔 Notifikasi Aktif', 'SBM ITB Layanan Teknis siap mengirimkan notifikasi panggilan.');
        } else {
          alert('⚠️ Izin notifikasi belum diberikan pada browser Anda. Silakan klik ikon gembok di sebelah alamat web browser untuk mengizinkan notifikasi.');
        }
      }
    });
  }

  // Filter Buttons
  const filterBtns = document.querySelectorAll('.btn-filter');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.getAttribute('data-filter');
      loadTickets();
    });
  });

  // Check Auth & Role Badge on Start
  fetch('/api/admin/check-auth', { headers: getAuthHeaders() })
    .then(r => r.json())
    .then(d => {
      if (d.authenticated) {
        updateRoleBadgeUI(d.role);
      }
    })
    .catch(() => {});

  // Export to Excel Button (Protected with Super Admin)
  const btnExport = document.getElementById('btnExportExcel');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      window.ensureSuperAdmin({
        title: 'Otorisasi Ekspor Data Excel',
        desc: 'Fitur ekspor rekapitulasi data ke Excel dilindungi. Masukkan kata sandi Super Admin untuk melanjutkan unduhan.',
        onSuccess: exportAdminTicketsToExcel
      });
    });
  }

  // Refresh Button
  document.getElementById('btnRefresh').addEventListener('click', loadTickets);

  // Clear Tickets Button (Protected with Super Admin)
  const clearBtn = document.getElementById('btnClearTickets');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      window.ensureSuperAdmin({
        title: 'Konfirmasi Kosongkan Seluruh Riwayat Tiket',
        desc: 'Tindakan ini akan MENGHAPUS SEMUA DATA panggilan dan riwayat penanganan secara permanen. Masukkan kata sandi Super Admin untuk menyetujui.',
        onSuccess: async () => {
          try {
            const res = await fetch('/api/admin/clear-tickets', {
              method: 'POST',
              headers: getAuthHeaders()
            });
            if (res.status === 401) {
              window.location.href = '/login';
              return;
            }
            if (res.status === 403) {
              alert('Akses ditolak. Memerlukan kata sandi Super Admin.');
              return;
            }
            const data = await res.json();
            if (data.success) {
              alert('✅ Seluruh riwayat tiket berhasil dikosongkan.');
              loadTickets();
            } else {
              alert('Gagal mengosongkan tiket: ' + data.error);
            }
          } catch (e) {
            console.error(e);
            alert('Terjadi kesalahan saat mengosongkan riwayat tiket.');
          }
        }
      });
    });
  }
});

// Fungsi Ekspor Excel dari Dashboard Admin
function exportAdminTicketsToExcel() {
  const ticketsToExport = latestLoadedTickets || [];
  if (ticketsToExport.length === 0) {
    alert('Belum ada data tiket untuk diekspor ke Excel.');
    return;
  }

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10);
  const timeStampFormatted = now.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }) + ' pukul ' + now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

  // Format baris data
  const dataRows = ticketsToExport.map((t, idx) => {
    const d = new Date(t.createdAt);
    const dateStr = !isNaN(d) ? d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
    const timeStr = !isNaN(d) ? d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB' : '-';

    let claimedTimeStr = '-';
    if (t.claimedAt) {
      const claimD = new Date(t.claimedAt);
      claimedTimeStr = !isNaN(claimD) ? claimD.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB' : '-';
    }

    let compTimeStr = '-';
    let durationStr = '-';
    if (t.completedAt) {
      const compD = new Date(t.completedAt);
      compTimeStr = !isNaN(compD) ? compD.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB' : '-';
      durationStr = formatDuration(t.resolutionTimeSeconds);
    } else if (t.status === 'Diproses') {
      durationStr = 'Sedang dikerjakan';
    } else if (t.status === 'Menunggu') {
      durationStr = 'Menunggu penanganan';
    }

    return [
      idx + 1,
      t.id ? '#' + t.id.slice(-6).toUpperCase() : '-',
      dateStr,
      timeStr,
      t.room || '-',
      t.category || 'Umum',
      t.notes || '-',
      t.handledBy || 'Tim Support',
      claimedTimeStr,
      compTimeStr,
      durationStr,
      t.status || 'Menunggu'
    ];
  });

  const columnHeaders = [
    'No',
    'ID Tiket',
    'Tanggal Panggilan',
    'Jam Panggilan',
    'Lokasi Ruang Kelas',
    'Kategori Kendala Teknis',
    'Detail Catatan / Masalah',
    'Petugas Support (Staf)',
    'Waktu Mulai Diproses',
    'Waktu Selesai Ditangani',
    'Durasi Penanganan',
    'Status Pekerjaan'
  ];

  // 1. Jika SheetJS (XLSX) tersedia, unduh .xlsx asli
  if (typeof XLSX !== 'undefined') {
    try {
      const wb = XLSX.utils.book_new();
      const wsData = [
        ['LAPORAN REKAPITULASI & RIWAYAT PEKERJAAN LAYANAN TEKNIS KELAS'],
        ['SEKOLAH BISNIS DAN MANAJEMEN - INSTITUT TEKNOLOGI BANDUNG (KAMPUS JAKARTA)'],
        [`Waktu Ekspor: ${timeStampFormatted}`, '', `Total Tiket: ${ticketsToExport.length}`],
        [],
        columnHeaders,
        ...dataRows
      ];

      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws['!cols'] = [
        { wch: 6 },
        { wch: 12 },
        { wch: 18 },
        { wch: 15 },
        { wch: 22 },
        { wch: 28 },
        { wch: 36 },
        { wch: 24 },
        { wch: 20 },
        { wch: 22 },
        { wch: 20 },
        { wch: 16 }
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'History Pekerjaan');
      XLSX.writeFile(wb, `History_Pekerjaan_Layanan_Teknis_SBM_ITB_${dateStamp}.xlsx`);
      return;
    } catch (e) {
      console.warn('SheetJS export fallback triggered:', e);
    }
  }

  // 2. Fallback: Format Dokumen Excel (.xls)
  let excelHtml = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8">
      <style>
        .title { font-size: 14pt; font-weight: bold; color: #0F2C59; }
        .sub-title { font-size: 11pt; font-weight: bold; color: #334155; }
        .meta { font-size: 9pt; color: #64748B; font-style: italic; }
        th { background-color: #0F2C59; color: #FFFFFF; font-weight: bold; text-align: center; border: 1px solid #CBD5E1; padding: 8px; }
        td { border: 1px solid #E2E8F0; padding: 6px 8px; font-size: 10pt; }
        .center { text-align: center; }
        .status-selesai { background-color: #D1FAE5; color: #065F46; font-weight: bold; text-align: center; }
        .status-diproses { background-color: #DBEAFE; color: #1E40AF; font-weight: bold; text-align: center; }
        .status-menunggu { background-color: #FEF3C7; color: #92400E; font-weight: bold; text-align: center; }
      </style>
    </head>
    <body>
      <table>
        <tr><td colspan="12" class="title">LAPORAN REKAPITULASI & RIWAYAT PEKERJAAN LAYANAN TEKNIS KELAS</td></tr>
        <tr><td colspan="12" class="sub-title">SEKOLAH BISNIS DAN MANAJEMEN - INSTITUT TEKNOLOGI BANDUNG (KAMPUS JAKARTA)</td></tr>
        <tr><td colspan="12" class="meta">Diunduh pada: ${timeStampFormatted} | Total: ${ticketsToExport.length} Tiket</td></tr>
        <tr><td colspan="12"></td></tr>
        <thead>
          <tr>
            ${columnHeaders.map(h => `<th>${escapeHTML(h)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${dataRows.map(row => `
            <tr>
              <td class="center">${row[0]}</td>
              <td class="center"><b>${escapeHTML(row[1])}</b></td>
              <td class="center">${escapeHTML(row[2])}</td>
              <td class="center">${escapeHTML(row[3])}</td>
              <td><b>${escapeHTML(row[4])}</b></td>
              <td>${escapeHTML(row[5])}</td>
              <td>${escapeHTML(row[6])}</td>
              <td>${escapeHTML(row[7])}</td>
              <td class="center">${escapeHTML(row[8])}</td>
              <td class="center">${escapeHTML(row[9])}</td>
              <td class="center">${escapeHTML(row[10])}</td>
              <td class="status-${(row[11] || '').toLowerCase()}">${escapeHTML(row[11])}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </body>
    </html>
  `;

  const blob = new Blob([excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `History_Pekerjaan_Layanan_Teknis_SBM_ITB_${dateStamp}.xls`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}



