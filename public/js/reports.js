let allTickets = [];
let filteredTickets = [];
let availableRooms = [];

// Chart.js instances
let chartTimeline = null;
let chartCategory = null;
let chartRoom = null;
let chartStatus = null;

// Palette Colors
const SBM_COLORS = [
  '#0F2C59', '#DDA74F', '#2563EB', '#10B981', 
  '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', 
  '#06B6D4', '#84CC16', '#64748B'
];

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
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
  document.getElementById('startDate').addEventListener('change', () => {
    clearActivePreset();
    applyFilters();
  });
  document.getElementById('endDate').addEventListener('change', () => {
    clearActivePreset();
    applyFilters();
  });
  document.getElementById('filterRoom').addEventListener('change', applyFilters);
  document.getElementById('filterCategory').addEventListener('change', applyFilters);
  document.getElementById('filterStatus').addEventListener('change', applyFilters);

  // Search input
  document.getElementById('tableSearch').addEventListener('input', applyFilters);

  // Reset Filter Button
  document.getElementById('btnResetFilter').addEventListener('click', resetFilters);

  // Export Buttons
  document.getElementById('btnExportExcel').addEventListener('click', exportToExcel);
  document.getElementById('btnExportPDF').addEventListener('click', exportToPDF);
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
      roomSelect.innerHTML = '<option value="all">Semua Ruangan</option>' + 
        availableRooms.map(r => `<option value="${r}">${r}</option>`).join('');
    }
  } catch (err) {
    console.error('Error loading rooms:', err);
  }
}

// 3. Fetch Tickets
async function loadTickets() {
  try {
    const res = await fetch('/api/tickets');
    const data = await res.json();
    if (data.success && data.tickets) {
      allTickets = data.tickets;

      // Populate Category filter options from real data
      populateCategories();

      // Apply default filter (Semua)
      applyFilters();
    }
  } catch (err) {
    console.error('Error loading tickets for reports:', err);
    document.getElementById('reportTableBody').innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 24px; color: var(--danger);">
          Gagal memuat data laporan dari server.
        </td>
      </tr>
    `;
  }
}

function populateCategories() {
  const categories = Array.from(new Set(allTickets.map(t => t.category || 'Umum'))).sort();
  const categorySelect = document.getElementById('filterCategory');
  categorySelect.innerHTML = '<option value="all">Semua Kategori</option>' +
    categories.map(c => `<option value="${c}">${c}</option>`).join('');
}

// 4. Period Preset Logic
function applyPeriodPreset(preset) {
  const startInput = document.getElementById('startDate');
  const endInput = document.getElementById('endDate');
  const now = new Date();

  if (preset === 'all') {
    startInput.value = '';
    endInput.value = '';
  } else if (preset === 'today') {
    const todayStr = toDateInputValue(now);
    startInput.value = todayStr;
    endInput.value = todayStr;
  } else if (preset === '7days') {
    const past7 = new Date();
    past7.setDate(now.getDate() - 6);
    startInput.value = toDateInputValue(past7);
    endInput.value = toDateInputValue(now);
  } else if (preset === '30days') {
    const past30 = new Date();
    past30.setDate(now.getDate() - 29);
    startInput.value = toDateInputValue(past30);
    endInput.value = toDateInputValue(now);
  } else if (preset === 'thismonth') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    startInput.value = toDateInputValue(firstDay);
    endInput.value = toDateInputValue(now);
  }

  applyFilters();
}

function toDateInputValue(date) {
  const local = new Date(date);
  local.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return local.toJSON().slice(0, 10);
}

function resetFilters() {
  document.getElementById('startDate').value = '';
  document.getElementById('endDate').value = '';
  document.getElementById('filterRoom').value = 'all';
  document.getElementById('filterCategory').value = 'all';
  document.getElementById('filterStatus').value = 'all';
  document.getElementById('tableSearch').value = '';

  const periodBtns = document.querySelectorAll('.btn-filter[data-period]');
  periodBtns.forEach(b => b.classList.remove('active'));
  const allBtn = document.querySelector('.btn-filter[data-period="all"]');
  if (allBtn) allBtn.classList.add('active');

  applyFilters();
}

// 5. Main Filter Engine
function applyFilters() {
  const startDateVal = document.getElementById('startDate').value;
  const endDateVal = document.getElementById('endDate').value;
  const selectedRoom = document.getElementById('filterRoom').value;
  const selectedCategory = document.getElementById('filterCategory').value;
  const selectedStatus = document.getElementById('filterStatus').value;
  const searchVal = document.getElementById('tableSearch').value.toLowerCase().trim();

  let startDateTime = startDateVal ? new Date(startDateVal + 'T00:00:00') : null;
  let endDateTime = endDateVal ? new Date(endDateVal + 'T23:59:59.999') : null;

  filteredTickets = allTickets.filter(ticket => {
    const ticketDate = new Date(ticket.createdAt);

    // Date Range Filter
    if (startDateTime && ticketDate < startDateTime) return false;
    if (endDateTime && ticketDate > endDateTime) return false;

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
      if (!roomMatch && !catMatch && !notesMatch && !idMatch) return false;
    }

    return true;
  });

  // Update UI Components
  updateKPIs();
  updateCharts();
  renderTable();
  updatePrintHeaderInfo();
}

// 6. Update KPI Metrics
function updateKPIs() {
  const total = filteredTickets.length;
  const selesai = filteredTickets.filter(t => t.status === 'Selesai').length;
  const rate = total > 0 ? Math.round((selesai / total) * 100) : 0;

  document.getElementById('kpiTotal').textContent = total;
  document.getElementById('kpiSelesai').textContent = selesai;
  document.getElementById('kpiRate').textContent = `${rate}% rasio selesai`;

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
  document.getElementById('kpiTopRoom').textContent = topRoom;
  document.getElementById('kpiTopRoomCount').textContent = maxRoomCount > 0 ? `${maxRoomCount} panggilan` : '0 panggilan';

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
  document.getElementById('kpiTopCategory').textContent = topCategory;
  document.getElementById('kpiTopCategoryCount').textContent = maxCatCount > 0 ? `${maxCatCount} laporan` : '0 laporan';
}

// 7. Update Charts (Chart.js)
function updateCharts() {
  renderTimelineChart();
  renderCategoryChart();
  renderRoomChart();
  renderStatusChart();
}

function renderTimelineChart() {
  const ctx = document.getElementById('chartTimeline').getContext('2d');
  
  // Group tickets by date
  const dateMap = {};
  filteredTickets.forEach(t => {
    const d = new Date(t.createdAt);
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
  const ctx = document.getElementById('chartCategory').getContext('2d');
  
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
  const ctx = document.getElementById('chartRoom').getContext('2d');
  
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

function renderStatusChart() {
  const ctx = document.getElementById('chartStatus').getContext('2d');
  
  const statusCounts = {
    'Selesai': 0,
    'Diproses': 0,
    'Menunggu': 0
  };

  filteredTickets.forEach(t => {
    if (statusCounts[t.status] !== undefined) {
      statusCounts[t.status]++;
    }
  });

  if (chartStatus) chartStatus.destroy();

  chartStatus = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['Selesai', 'Diproses', 'Menunggu'],
      datasets: [{
        data: [statusCounts['Selesai'], statusCounts['Diproses'], statusCounts['Menunggu']],
        backgroundColor: ['#10B981', '#2563EB', '#F59E0B'],
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

// 8. Render Data Table
function renderTable() {
  const tbody = document.getElementById('reportTableBody');
  const summaryText = document.getElementById('tableSummaryText');

  summaryText.textContent = `Menampilkan ${filteredTickets.length} data tiket`;

  if (filteredTickets.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 30px; color: var(--text-muted);">
          Tidak ada data tiket yang cocok dengan filter yang dipilih.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filteredTickets.map((t, index) => {
    const d = new Date(t.createdAt);
    const dateStr = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

    let badgeClass = 'badge-menunggu';
    if (t.status === 'Diproses') badgeClass = 'badge-diproses';
    if (t.status === 'Selesai') badgeClass = 'badge-selesai';

    let waText = '<span style="color: #64748B;">-</span>';
    if (t.waStatus && t.waStatus.sent) {
      waText = `<span style="color: #059669; font-weight: 600; font-size: 0.8rem;">✓ Terkirim (${t.waStatus.provider || 'WA'})</span>`;
    } else if (t.waStatus && t.waStatus.sent === false) {
      waText = `<span style="color: #DC2626; font-size: 0.8rem;">✕ Gagal</span>`;
    }

    return `
      <tr>
        <td style="text-align: center; font-weight: 600; color: var(--text-muted);">${index + 1}</td>
        <td>
          <div style="font-weight: 700; color: var(--text-dark);">${timeStr}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${dateStr}</div>
        </td>
        <td>
          <strong style="color: var(--primary);">📍 ${t.room}</strong>
        </td>
        <td>
          <span style="font-weight: 600;">${t.category || 'Umum'}</span>
        </td>
        <td>
          <span style="color: ${t.notes ? '#334155' : '#94A3B8'}; font-style: ${t.notes ? 'normal' : 'italic'}; font-size: 0.85rem;">
            ${t.notes || '-'}
          </span>
        </td>
        <td>
          <span class="badge ${badgeClass}">${t.status}</span>
        </td>
        <td>
          ${waText}
        </td>
      </tr>
    `;
  }).join('');
}

// 9. Update Official Print Header Metadata
function updatePrintHeaderInfo() {
  const startDateVal = document.getElementById('startDate').value;
  const endDateVal = document.getElementById('endDate').value;
  const periodText = (startDateVal || endDateVal) 
    ? `Periode: ${startDateVal || 'Awal'} s/d ${endDateVal || 'Sekarang'}`
    : 'Periode: Seluruh Data Tercatat';

  document.getElementById('printReportPeriod').textContent = periodText;

  const now = new Date();
  const dateGenerated = now.toLocaleDateString('id-ID', { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long', 
    year: 'numeric' 
  }) + ' pukul ' + now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

  document.getElementById('printGeneratedDate').textContent = `Dicetak pada: ${dateGenerated}`;
}

// 10. Export to Excel / CSV (UTF-8 BOM for Excel Windows Compatibility)
function exportToExcel() {
  if (filteredTickets.length === 0) {
    alert('Tidak ada data tiket untuk diekspor.');
    return;
  }

  const headers = ['No', 'ID Tiket', 'Tanggal', 'Jam', 'Ruangan', 'Kategori Kendala', 'Catatan Tambahan', 'Status Tiket', 'Notifikasi WhatsApp'];
  
  const rows = filteredTickets.map((t, idx) => {
    const d = new Date(t.createdAt);
    const dateStr = d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    
    let waStr = 'Tidak';
    if (t.waStatus && t.waStatus.sent) waStr = `Terkirim (${t.waStatus.provider || 'WA'})`;
    else if (t.waStatus && t.waStatus.sent === false) waStr = 'Gagal';

    return [
      idx + 1,
      `"${t.id || ''}"`,
      `"${dateStr}"`,
      `"${timeStr}"`,
      `"${(t.room || '').replace(/"/g, '""')}"`,
      `"${(t.category || 'Umum').replace(/"/g, '""')}"`,
      `"${(t.notes || '').replace(/"/g, '""')}"`,
      `"${t.status || ''}"`,
      `"${waStr}"`
    ];
  });

  const csvContent = '\uFEFF' + [
    headers.join(','),
    ...rows.map(r => r.join(','))
  ].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10);
  link.setAttribute('href', url);
  link.setAttribute('download', `Laporan_Layanan_Teknis_SBM_ITB_${dateStamp}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 11. Export to PDF via Browser Print Dialog
function exportToPDF() {
  updatePrintHeaderInfo();
  window.print();
}
