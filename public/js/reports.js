function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function handleLogout() {
  if (confirm('Apakah Anda yakin ingin keluar dari sesi admin?')) {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch (e) {}
    localStorage.removeItem('admin_token');
    window.location.href = '/login';
  }
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

let allTickets = [];
let filteredTickets = [];
let availableRooms = [];

// Chart.js instances
let chartTimeline = null;
let chartCategory = null;
let chartRoom = null;
let chartHourly = null;

// Palette Colors
const SBM_COLORS = [
  '#0F2C59', '#DDA74F', '#2563EB', '#10B981', 
  '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', 
  '#06B6D4', '#84CC16', '#64748B'
];

const SBM_CACHE_KEY = 'sbm_tickets_cache';

function getCachedTickets() {
  try {
    const raw = localStorage.getItem(SBM_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveCachedTickets(tickets) {
  try {
    if (Array.isArray(tickets)) {
      localStorage.setItem(SBM_CACHE_KEY, JSON.stringify(tickets));
    }
  } catch (e) {}
}

// SSE Real-time Events Listener for Reports
function setupRealtimeReportsEvents() {
  if (!window.EventSource) return;
  try {
    const es = new EventSource('/api/events');
    es.addEventListener('tickets_cleared', () => {
      allTickets = [];
      saveCachedTickets([]);
      populateCategories();
      applyFilters();
    });
    es.addEventListener('ticket_updated', () => {
      loadTickets();
    });
    es.addEventListener('new_ticket', () => {
      loadTickets();
    });
  } catch (e) {
    console.warn('Realtime SSE error on reports:', e);
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  setupRealtimeReportsEvents();
  fetch('/api/admin/check-auth', { headers: getAuthHeaders() })
    .then(r => r.json())
    .then(d => {
      if (d.authenticated) {
        updateRoleBadgeUI(d.role);
      }
    })
    .catch(() => {});
  await loadRooms();
  await loadTickets();
});

// 1. Setup Event Listeners
function setupEventListeners() {
  // Preset Period buttons
  const periodBtns = document.querySelectorAll('.btn-filter[data-period]');
  periodBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      periodBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyPeriodPreset(btn.getAttribute('data-period'));
    });
  });

  // Date and Select Filters
  const startDate = document.getElementById('startDate');
  const endDate = document.getElementById('endDate');
  const filterRoom = document.getElementById('filterRoom');
  const filterCategory = document.getElementById('filterCategory');
  const filterStatus = document.getElementById('filterStatus');
  const tableSearch = document.getElementById('tableSearch');
  const btnResetFilter = document.getElementById('btnResetFilter');
  const btnExportExcel = document.getElementById('btnExportExcel');
  const btnExportPDF = document.getElementById('btnExportPDF');
  const btnClearReports = document.getElementById('btnClearTicketsReports');

  if (startDate) {
    startDate.addEventListener('change', () => {
      clearActivePreset();
      applyFilters();
    });
  }
  if (endDate) {
    endDate.addEventListener('change', () => {
      clearActivePreset();
      applyFilters();
    });
  }
  if (filterRoom) filterRoom.addEventListener('change', applyFilters);
  if (filterCategory) filterCategory.addEventListener('change', applyFilters);
  if (filterStatus) filterStatus.addEventListener('change', applyFilters);
  if (tableSearch) tableSearch.addEventListener('input', applyFilters);
  if (btnResetFilter) btnResetFilter.addEventListener('click', resetFilters);
  if (btnExportExcel) btnExportExcel.addEventListener('click', exportToExcel);
  if (btnExportPDF) btnExportPDF.addEventListener('click', exportToPDF);

  if (btnClearReports) {
    btnClearReports.addEventListener('click', () => {
      window.ensureSuperAdmin({
        title: 'Konfirmasi Kosongkan Seluruh Riwayat Tiket',
        desc: 'Tindakan ini akan MENGHAPUS SEMUA DATA riwayat penanganan tiket secara permanen. Masukkan kata sandi Super Admin untuk menyetujui.',
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
              allTickets = [];
              saveCachedTickets([]);
              populateCategories();
              applyFilters();
              alert('✅ Seluruh riwayat tiket berhasil dikosongkan.');
              await loadTickets();
            } else {
              alert('Gagal mengosongkan riwayat: ' + (data.error || 'Terjadi kesalahan'));
            }
          } catch (e) {
            console.error(e);
            alert('Terjadi kesalahan saat mengosongkan riwayat tiket.');
          }
        }
      });
    });
  }
}

function clearActivePreset() {
  document.querySelectorAll('.btn-filter[data-period]').forEach(b => b.classList.remove('active'));
}

// 2. Fetch Room Configuration & Populate Dropdown
async function loadRooms() {
  try {
    const res = await fetch('/api/info');
    const data = await res.json();
    if (data.rooms) {
      availableRooms = data.rooms;
      const roomSelect = document.getElementById('filterRoom');
      if (roomSelect) {
        roomSelect.innerHTML = '<option value="all">Semua Ruangan</option>' + 
          availableRooms.map(r => `<option value="${escapeHTML(r)}">${escapeHTML(r)}</option>`).join('');
      }
    }
  } catch (err) {
    console.error('Error loading rooms:', err);
  }
}

// 3. Fetch Tickets
async function loadTickets() {
  // First load from local cache so reports immediately populate
  const cached = getCachedTickets();
  if (cached.length > 0 && allTickets.length === 0) {
    allTickets = cached;
    populateCategories();
    applyFilters();
  }

  try {
    const res = await fetch('/api/tickets?_t=' + Date.now(), {
      cache: 'no-store',
      headers: getAuthHeaders()
    });
    if (res.status === 401) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }
    const data = await res.json();
    if (data.success && Array.isArray(data.tickets)) {
      allTickets = data.tickets;
      saveCachedTickets(allTickets);

      // Populate Category filter options from real data
      populateCategories();

      // Apply filter
      applyFilters();
    }
  } catch (err) {
    console.error('Error loading tickets for reports:', err);
  }
}

function populateCategories() {
  const categorySelect = document.getElementById('filterCategory');
  if (!categorySelect) return;
  const currentVal = categorySelect.value || 'all';
  const categories = Array.from(new Set(allTickets.map(t => t.category || 'Umum'))).sort();
  categorySelect.innerHTML = '<option value="all">Semua Kategori</option>' +
    categories.map(c => `<option value="${escapeHTML(c)}" ${c === currentVal ? 'selected' : ''}>${escapeHTML(c)}</option>`).join('');
}

// 4. Period Preset Logic
function applyPeriodPreset(preset) {
  const startInput = document.getElementById('startDate');
  const endInput = document.getElementById('endDate');
  const now = new Date();

  if (preset === 'all') {
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
  } else if (preset === 'today') {
    const todayStr = toDateInputValue(now);
    if (startInput) startInput.value = todayStr;
    if (endInput) endInput.value = todayStr;
  } else if (preset === '7days') {
    const past7 = new Date();
    past7.setDate(now.getDate() - 6);
    if (startInput) startInput.value = toDateInputValue(past7);
    if (endInput) endInput.value = toDateInputValue(now);
  } else if (preset === '30days') {
    const past30 = new Date();
    past30.setDate(now.getDate() - 29);
    if (startInput) startInput.value = toDateInputValue(past30);
    if (endInput) endInput.value = toDateInputValue(now);
  } else if (preset === 'thismonth') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    if (startInput) startInput.value = toDateInputValue(firstDay);
    if (endInput) endInput.value = toDateInputValue(now);
  }

  applyFilters();
}

function toDateInputValue(date) {
  const local = new Date(date);
  local.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return local.toJSON().slice(0, 10);
}

function resetFilters() {
  const startInput = document.getElementById('startDate');
  const endInput = document.getElementById('endDate');
  const filterRoom = document.getElementById('filterRoom');
  const filterCategory = document.getElementById('filterCategory');
  const filterStatus = document.getElementById('filterStatus');
  const tableSearch = document.getElementById('tableSearch');

  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';
  if (filterRoom) filterRoom.value = 'all';
  if (filterCategory) filterCategory.value = 'all';
  if (filterStatus) filterStatus.value = 'all';
  if (tableSearch) tableSearch.value = '';

  const periodBtns = document.querySelectorAll('.btn-filter[data-period]');
  periodBtns.forEach(b => b.classList.remove('active'));
  const allBtn = document.querySelector('.btn-filter[data-period="all"]');
  if (allBtn) allBtn.classList.add('active');

  applyFilters();
}

// 5. Main Filter Engine
function applyFilters() {
  const startDateVal = document.getElementById('startDate')?.value;
  const endDateVal = document.getElementById('endDate')?.value;
  const selectedRoom = document.getElementById('filterRoom')?.value || 'all';
  const selectedCategory = document.getElementById('filterCategory')?.value || 'all';
  const selectedStatus = document.getElementById('filterStatus')?.value || 'all';
  const searchVal = document.getElementById('tableSearch')?.value?.toLowerCase().trim() || '';

  let startDateTime = startDateVal ? new Date(startDateVal + 'T00:00:00') : null;
  let endDateTime = endDateVal ? new Date(endDateVal + 'T23:59:59.999') : null;

  filteredTickets = allTickets.filter(ticket => {
    const ticketDate = new Date(ticket.createdAt);

    // Date Range Filter
    if (startDateTime && !isNaN(ticketDate) && ticketDate < startDateTime) return false;
    if (endDateTime && !isNaN(ticketDate) && ticketDate > endDateTime) return false;

    // Room Filter
    if (selectedRoom !== 'all' && ticket.room !== selectedRoom) return false;

    // Category Filter
    if (selectedCategory !== 'all' && (ticket.category || 'Umum') !== selectedCategory) return false;

    // Status Filter
    if (selectedStatus !== 'all' && ticket.status !== selectedStatus) return false;

    // Search query Filter
    if (searchVal) {
      const roomMatch = (ticket.room || '').toLowerCase().includes(searchVal);
      const catMatch = (ticket.category || '').toLowerCase().includes(searchVal);
      const notesMatch = (ticket.notes || '').toLowerCase().includes(searchVal);
      const idMatch = (ticket.id || '').toLowerCase().includes(searchVal);
      const handlerMatch = (ticket.handledBy || '').toLowerCase().includes(searchVal);
      if (!roomMatch && !catMatch && !notesMatch && !idMatch && !handlerMatch) return false;
    }

    return true;
  });

  // Update UI Components safely
  try {
    updateKPIs();
  } catch (e) {
    console.error('KPI error:', e);
  }

  try {
    updateCharts();
  } catch (e) {
    console.error('Chart error:', e);
  }

  try {
    renderTable();
  } catch (e) {
    console.error('Table error:', e);
  }

  try {
    updatePrintHeaderInfo();
  } catch (e) {
    console.error('Print header error:', e);
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

// 6. Update KPI Metrics
function updateKPIs() {
  const total = filteredTickets.length;
  const completedTickets = filteredTickets.filter(t => t.status === 'Selesai');
  const selesai = completedTickets.length;
  const rate = total > 0 ? Math.round((selesai / total) * 100) : 0;

  const kpiTotal = document.getElementById('kpiTotal');
  const kpiSelesai = document.getElementById('kpiSelesai');
  const kpiRate = document.getElementById('kpiRate');
  const kpiAvgDuration = document.getElementById('kpiAvgDuration');
  const kpiAvgDurationSubtitle = document.getElementById('kpiAvgDurationSubtitle');
  const kpiTopRoom = document.getElementById('kpiTopRoom');
  const kpiTopRoomCount = document.getElementById('kpiTopRoomCount');
  const kpiTopCategory = document.getElementById('kpiTopCategory');
  const kpiTopCategoryCount = document.getElementById('kpiTopCategoryCount');

  if (kpiTotal) kpiTotal.textContent = total;
  if (kpiSelesai) kpiSelesai.textContent = selesai;
  if (kpiRate) kpiRate.textContent = `${rate}% rasio selesai`;

  // Average Resolution Duration
  const ticketsWithDuration = completedTickets.filter(t => typeof t.resolutionTimeSeconds === 'number' && t.resolutionTimeSeconds > 0);
  if (ticketsWithDuration.length > 0) {
    const totalSecs = ticketsWithDuration.reduce((acc, t) => acc + t.resolutionTimeSeconds, 0);
    const avgSecs = Math.round(totalSecs / ticketsWithDuration.length);
    if (kpiAvgDuration) kpiAvgDuration.textContent = `~ ${formatDuration(avgSecs)}`;
    if (kpiAvgDurationSubtitle) kpiAvgDurationSubtitle.textContent = `dari ${ticketsWithDuration.length} tiket selesai`;
  } else {
    if (kpiAvgDuration) kpiAvgDuration.textContent = '-';
    if (kpiAvgDurationSubtitle) kpiAvgDurationSubtitle.textContent = 'belum ada data selesai';
  }

  // Top Room
  const roomCounts = {};
  filteredTickets.forEach(t => {
    roomCounts[t.room] = (roomCounts[t.room] || 0) + 1;
  });
  let topRoom = '-';
  let maxRoomCount = 0;
  for (const [r, count] of Object.entries(roomCounts)) {
    if (count > maxRoomCount) {
      maxRoomCount = count;
      topRoom = r;
    }
  }
  if (kpiTopRoom) kpiTopRoom.textContent = topRoom;
  if (kpiTopRoomCount) kpiTopRoomCount.textContent = maxRoomCount > 0 ? `${maxRoomCount} panggilan` : '0 panggilan';

  // Top Category
  const catCounts = {};
  filteredTickets.forEach(t => {
    const c = t.category || 'Umum';
    catCounts[c] = (catCounts[c] || 0) + 1;
  });
  let topCategory = '-';
  let maxCatCount = 0;
  for (const [c, count] of Object.entries(catCounts)) {
    if (count > maxCatCount) {
      maxCatCount = count;
      topCategory = c;
    }
  }
  if (kpiTopCategory) kpiTopCategory.textContent = topCategory;
  if (kpiTopCategoryCount) kpiTopCategoryCount.textContent = maxCatCount > 0 ? `${maxCatCount} laporan` : '0 laporan';
}

// 7. Update Charts (Chart.js)
function updateCharts() {
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js library is not available');
    return;
  }
  renderTimelineChart();
  renderCategoryChart();
  renderRoomChart();
  renderHourlyChart();
}

function renderTimelineChart() {
  const canvas = document.getElementById('chartTimeline');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  // Group tickets by date
  const dateMap = {};
  filteredTickets.forEach(t => {
    const d = new Date(t.createdAt);
    if (isNaN(d)) return;
    const dateKey = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
    dateMap[dateKey] = (dateMap[dateKey] || 0) + 1;
  });

  const labels = Object.keys(dateMap);
  const data = Object.values(dateMap);

  if (chartTimeline) chartTimeline.destroy();

  chartTimeline = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length > 0 ? labels : ['Tidak Ada Data'],
      datasets: [{
        label: 'Jumlah Panggilan',
        data: data.length > 0 ? data : [0],
        backgroundColor: '#0F2C59',
        borderColor: '#091D3E',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 }
        }
      }
    }
  });
}

function renderCategoryChart() {
  const canvas = document.getElementById('chartCategory');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const catMap = {};
  filteredTickets.forEach(t => {
    const c = t.category || 'Umum';
    catMap[c] = (catMap[c] || 0) + 1;
  });

  const labels = Object.keys(catMap);
  const data = Object.values(catMap);

  if (chartCategory) chartCategory.destroy();

  chartCategory = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels.length > 0 ? labels : ['Tidak Ada Data'],
      datasets: [{
        data: data.length > 0 ? data : [1],
        backgroundColor: labels.length > 0 ? SBM_COLORS.slice(0, labels.length) : ['#E2E8F0'],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
      }
    }
  });
}

function renderRoomChart() {
  const canvas = document.getElementById('chartRoom');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const roomMap = {};
  filteredTickets.forEach(t => {
    roomMap[t.room] = (roomMap[t.room] || 0) + 1;
  });

  // Sort rooms descending by count
  const sortedRooms = Object.entries(roomMap).sort((a, b) => b[1] - a[1]);
  const labels = sortedRooms.map(r => r[0]);
  const data = sortedRooms.map(r => r[1]);

  if (chartRoom) chartRoom.destroy();

  chartRoom = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length > 0 ? labels : ['Tidak Ada Data'],
      datasets: [{
        label: 'Frekuensi Panggilan',
        data: data.length > 0 ? data : [0],
        backgroundColor: '#DDA74F',
        borderColor: '#C6923C',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { stepSize: 1 }
        }
      }
    }
  });
}

function renderHourlyChart() {
  const canvas = document.getElementById('chartHourly') || document.getElementById('chartStatus');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  // Hours from 07:00 to 21:00
  const hourBuckets = {};
  for (let h = 7; h <= 21; h++) {
    const key = String(h).padStart(2, '0') + ':00';
    hourBuckets[key] = 0;
  }

  filteredTickets.forEach(t => {
    const d = new Date(t.createdAt);
    if (!isNaN(d)) {
      const h = d.getHours();
      const key = String(h).padStart(2, '0') + ':00';
      if (hourBuckets[key] !== undefined) {
        hourBuckets[key]++;
      } else {
        hourBuckets[key] = 1;
      }
    }
  });

  const labels = Object.keys(hourBuckets);
  const data = Object.values(hourBuckets);

  if (chartHourly) chartHourly.destroy();

  chartHourly = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Panggilan per Jam',
        data,
        backgroundColor: 'rgba(37, 99, 235, 0.15)',
        borderColor: '#2563EB',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#1D4ED8'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 }
        }
      }
    }
  });
}

// 8. Render Data Table
function renderTable() {
  const tbody = document.getElementById('reportTableBody');
  const summaryText = document.getElementById('tableSummaryText');

  if (summaryText) {
    summaryText.textContent = `Menampilkan ${filteredTickets.length} data tiket`;
  }

  if (!tbody) return;

  if (filteredTickets.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 30px; color: var(--text-muted);">
          Tidak ada data tiket yang cocok dengan filter yang dipilih.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filteredTickets.map((t, index) => {
    const d = new Date(t.createdAt);
    const dateStr = !isNaN(d) ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
    const timeStr = !isNaN(d) ? d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB' : '-';

    let completedInfo = '<span style="color: #94A3B8; font-size: 0.8rem;">-</span>';
    if (t.completedAt) {
      const compD = new Date(t.completedAt);
      const compTimeStr = !isNaN(compD) ? compD.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB' : '-';
      completedInfo = `
        <div style="font-weight: 700; color: #059669; font-size: 0.85rem;">${compTimeStr}</div>
        <div style="font-size: 0.75rem; color: #2563EB; font-weight: 600;">⏱️ ${formatDuration(t.resolutionTimeSeconds)}</div>
      `;
    }

    let badgeClass = 'badge-menunggu';
    if (t.status === 'Diproses') badgeClass = 'badge-diproses';
    if (t.status === 'Selesai') badgeClass = 'badge-selesai';

    const safeRoom = escapeHTML(t.room || '-');
    const safeCategory = escapeHTML(t.category || 'Umum');
    const safeNotes = escapeHTML(t.notes);
    const safeHandledBy = escapeHTML(t.handledBy || '-');

    return `
      <tr>
        <td style="text-align: center; font-weight: 600; color: var(--text-muted);">${index + 1}</td>
        <td>
          <div style="font-weight: 700; color: var(--text-dark);">${timeStr}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${dateStr}</div>
        </td>
        <td>
          ${completedInfo}
        </td>
        <td>
          <strong style="color: var(--primary);">📍 ${safeRoom}</strong>
        </td>
        <td>
          <span style="font-weight: 600;">${safeCategory}</span>
        </td>
        <td>
          <span style="font-weight: 600; color: #1E40AF;">
            ${t.handledBy ? `👤 ${safeHandledBy}` : '<span style="color: #94A3B8;">-</span>'}
          </span>
        </td>
        <td>
          <span class="badge ${badgeClass}">${escapeHTML(t.status || 'Menunggu')}</span>
        </td>
        <td>
          <span style="color: ${t.notes ? '#334155' : '#94A3B8'}; font-style: ${t.notes ? 'normal' : 'italic'}; font-size: 0.85rem;">
            ${safeNotes || '-'}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

// 9. Update Official Print Header Metadata
function updatePrintHeaderInfo() {
  const startDateVal = document.getElementById('startDate')?.value;
  const endDateVal = document.getElementById('endDate')?.value;
  const periodText = (startDateVal || endDateVal) 
    ? `Periode: ${startDateVal || 'Awal'} s/d ${endDateVal || 'Sekarang'}`
    : 'Periode: Seluruh Data Tercatat';

  const periodEl = document.getElementById('printReportPeriod');
  if (periodEl) periodEl.textContent = periodText;

  const now = new Date();
  const dateGenerated = now.toLocaleDateString('id-ID', { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long', 
    year: 'numeric' 
  }) + ' pukul ' + now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

  const genEl = document.getElementById('printGeneratedDate');
  if (genEl) genEl.textContent = `Dicetak pada: ${dateGenerated}`;
}

// 10. Export to Genuine Excel (.xlsx / Job History Table) - Super Admin Protected
function exportToExcel() {
  window.ensureSuperAdmin({
    title: 'Otorisasi Ekspor Laporan Excel',
    desc: 'Fitur ekspor rekapitulasi laporan ke format Excel (.xlsx) dilindungi. Masukkan kata sandi Super Admin untuk melanjutkan unduhan.',
    onSuccess: () => {
      proceedExportToExcel();
    }
  });
}

function proceedExportToExcel() {
  if (!filteredTickets || filteredTickets.length === 0) {
    alert('Tidak ada data tiket untuk diekspor ke Excel.');
    return;
  }

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10);
  const timeStampFormatted = now.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }) + ' pukul ' + now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

  const startDateVal = document.getElementById('startDate')?.value;
  const endDateVal = document.getElementById('endDate')?.value;
  const periodText = (startDateVal || endDateVal)
    ? `${startDateVal || 'Awal'} s/d ${endDateVal || 'Sekarang'}`
    : 'Semua Data Riwayat Tercatat';

  // Siapkan baris data riwayat pekerjaan
  const dataRows = filteredTickets.map((t, idx) => {
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

  // 1. Jika SheetJS (XLSX) tersedia, buat file .xlsx asli
  if (typeof XLSX !== 'undefined') {
    try {
      const wb = XLSX.utils.book_new();

      // Buat struktur worksheet lengkap dengan header judul
      const wsData = [
        ['LAPORAN REKAPITULASI & RIWAYAT PEKERJAAN LAYANAN TEKNIS KELAS'],
        ['SEKOLAH BISNIS DAN MANAJEMEN - INSTITUT TEKNOLOGI BANDUNG (KAMPUS JAKARTA)'],
        [`Periode: ${periodText}`, '', `Waktu Ekspor: ${timeStampFormatted}`, '', `Total Tiket: ${filteredTickets.length}`],
        [], // Baris kosong pemisah
        columnHeaders,
        ...dataRows
      ];

      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Tentukan lebar kolom otomatis agar rapi di Excel
      const colWidths = [
        { wch: 6 },  // No
        { wch: 12 }, // ID Tiket
        { wch: 18 }, // Tanggal Panggilan
        { wch: 15 }, // Jam Panggilan
        { wch: 22 }, // Lokasi Ruang
        { wch: 28 }, // Kategori Kendala
        { wch: 36 }, // Detail Catatan
        { wch: 24 }, // Petugas Support
        { wch: 20 }, // Waktu Diproses
        { wch: 22 }, // Waktu Selesai
        { wch: 20 }, // Durasi
        { wch: 16 }  // Status
      ];
      ws['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, 'History Pekerjaan');
      XLSX.writeFile(wb, `History_Pekerjaan_Layanan_Teknis_SBM_ITB_${dateStamp}.xlsx`);
      return;
    } catch (e) {
      console.warn('SheetJS export fallback triggered:', e);
    }
  }

  // 2. Fallback: Format Dokumen Excel (.xls HTML Spreadsheet dengan styling tabel penuh)
  let excelHtml = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8">
      <!--[if gte mso 9]>
      <xml>
        <x:ExcelWorkbook>
          <x:ExcelWorksheets>
            <x:ExcelWorksheet>
              <x:Name>History Pekerjaan</x:Name>
              <x:WorksheetOptions>
                <x:DisplayGridlines/>
              </x:WorksheetOptions>
            </x:ExcelWorksheet>
          </x:ExcelWorksheets>
        </x:ExcelWorkbook>
      </xml>
      <![endif]-->
      <style>
        .title { font-size: 14pt; font-weight: bold; color: #0F2C59; text-align: left; }
        .sub-title { font-size: 11pt; font-weight: bold; color: #334155; }
        .meta { font-size: 9pt; color: #64748B; font-style: italic; }
        th { background-color: #0F2C59; color: #FFFFFF; font-weight: bold; text-align: center; border: 1px solid #CBD5E1; padding: 8px; }
        td { border: 1px solid #E2E8F0; padding: 6px 8px; font-size: 10pt; vertical-align: middle; }
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
        <tr><td colspan="12" class="meta">Periode: ${periodText} | Diunduh pada: ${timeStampFormatted} | Total: ${filteredTickets.length} Tiket</td></tr>
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

// 11. Export to PDF via Browser Print Dialog - Super Admin Protected
function exportToPDF() {
  window.ensureSuperAdmin({
    title: 'Otorisasi Cetak / Ekspor PDF',
    desc: 'Fitur cetak dan ekspor laporan ke dokumen PDF dilindungi. Masukkan kata sandi Super Admin untuk melanjutkan pencetakan.',
    onSuccess: () => {
      updatePrintHeaderInfo();
      window.print();
    }
  });
}

window.exportToExcel = exportToExcel;
window.exportToPDF = exportToPDF;

