let currentFilter = 'all';
let previousTicketCount = null;

// Sound notification using Web Audio API (no external asset needed)
function playBeep() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
  } catch (e) {
    // Audio might be blocked until user interacts
  }
}

async function loadTickets() {
  try {
    const res = await fetch('/api/tickets');
    const data = await res.json();
    
    if (!data.success) return;

    const tickets = data.tickets || [];

    // Check for new tickets to play sound
    const waitingCount = tickets.filter(t => t.status === 'Menunggu').length;
    if (previousTicketCount !== null && waitingCount > previousTicketCount) {
      playBeep();
    }
    previousTicketCount = waitingCount;

    // Update Stats
    document.getElementById('statMenunggu').textContent = tickets.filter(t => t.status === 'Menunggu').length;
    document.getElementById('statDiproses').textContent = tickets.filter(t => t.status === 'Diproses').length;
    document.getElementById('statSelesai').textContent = tickets.filter(t => t.status === 'Selesai').length;
    document.getElementById('statTotal').textContent = tickets.length;

    // Filter tickets
    let displayTickets = tickets;
    if (currentFilter !== 'all') {
      displayTickets = tickets.filter(t => t.status.toLowerCase() === currentFilter.toLowerCase());
    }

    renderTable(displayTickets);
    
    const now = new Date();
    document.getElementById('lastUpdateTime').textContent = 'Terakhir diperbarui: ' + now.toLocaleTimeString('id-ID');
  } catch (err) {
    console.error('Error loading tickets:', err);
  }
}

function renderTable(tickets) {
  const tbody = document.getElementById('ticketsTableBody');
  
  if (tickets.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 30px; color: var(--text-muted);">
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

    let badgeClass = 'badge-menunggu';
    if (ticket.status === 'Diproses') badgeClass = 'badge-diproses';
    if (ticket.status === 'Selesai') badgeClass = 'badge-selesai';

    let actionButtons = '';
    if (ticket.status === 'Menunggu') {
      actionButtons = `
        <div class="action-btn-group">
          <button class="btn-xs btn-primary" onclick="updateStatus('${ticket.id}', 'Diproses')">
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
      actionButtons = `<span style="font-size: 0.75rem; color: var(--text-muted);">Tiket Selesai</span>`;
    }

    return `
      <tr>
        <td style="white-space: nowrap;">
          <div style="font-weight: 700; color: var(--text-dark);">${timeStr}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${dateStr}</div>
        </td>
        <td>
          <div style="font-weight: 800; font-size: 1rem; color: var(--primary);">📍 ${ticket.room}</div>
        </td>
        <td>
          <span style="font-weight: 600;">${ticket.category || 'Umum'}</span>
        </td>
        <td>
          <span style="color: ${ticket.notes ? '#334155' : '#94A3B8'}; font-style: ${ticket.notes ? 'normal' : 'italic'};">
            ${ticket.notes || '-'}
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

async function updateStatus(ticketId, newStatus) {
  try {
    const res = await fetch(`/api/tickets/${ticketId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
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
  loadTickets();

  // Polling interval 5 detik
  setInterval(loadTickets, 5000);

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

  // Refresh Button
  document.getElementById('btnRefresh').addEventListener('click', loadTickets);

  // Clear Tickets Button
  const clearBtn = document.getElementById('btnClearTickets');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (!confirm('Apakah Anda yakin ingin mengosongkan SELURUH data riwayat tiket? Tindakan ini tidak dapat dibatalkan.')) {
        return;
      }
      try {
        const res = await fetch('/api/admin/clear-tickets', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          alert('Riwayat tiket berhasil dikosongkan.');
          loadTickets();
        } else {
          alert('Gagal mengosongkan tiket: ' + data.error);
        }
      } catch (e) {
        console.error(e);
        alert('Terjadi kesalahan saat mengosongkan riwayat tiket.');
      }
    });
  }
});
