function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setStaffName(name) {
  const input = document.getElementById('staffNameInput');
  if (input) input.value = name;
}

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const ticketId = urlParams.get('ticket');

  const ticketLoading = document.getElementById('ticketLoading');
  const ticketDetails = document.getElementById('ticketDetails');
  const ticketNotFound = document.getElementById('ticketNotFound');
  const ticketIdText = document.getElementById('ticketIdText');

  const roomVal = document.getElementById('roomVal');
  const catVal = document.getElementById('catVal');
  const notesVal = document.getElementById('notesVal');
  const timeVal = document.getElementById('timeVal');
  const statusVal = document.getElementById('statusVal');

  const claimActionSection = document.getElementById('claimActionSection');
  const inProgressSection = document.getElementById('inProgressSection');
  const completedSection = document.getElementById('completedSection');
  const currentHandlerText = document.getElementById('currentHandlerText');
  const completedHandlerText = document.getElementById('completedHandlerText');

  const claimForm = document.getElementById('claimForm');
  const staffNameInput = document.getElementById('staffNameInput');
  const btnClaimSubmit = document.getElementById('btnClaimSubmit');
  const btnCompleteSubmit = document.getElementById('btnCompleteSubmit');

  // Check saved staff name in localStorage
  const savedStaff = localStorage.getItem('last_support_staff_name');
  if (savedStaff && staffNameInput) {
    staffNameInput.value = savedStaff;
  }

  if (!ticketId) {
    ticketLoading.style.display = 'none';
    ticketNotFound.style.display = 'block';
    ticketIdText.textContent = 'Parameter tiket tidak ditemukan.';
    return;
  }

  ticketIdText.textContent = `ID Tiket: #${ticketId.slice(-6)}`;

  async function fetchTicketData() {
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}`);
      const data = await res.json();

      if (!data.success || !data.ticket) {
        ticketLoading.style.display = 'none';
        ticketNotFound.style.display = 'block';
        return;
      }

      const t = data.ticket;
      renderTicketInfo(t);
    } catch (err) {
      console.error(err);
      ticketLoading.style.display = 'none';
      ticketNotFound.style.display = 'block';
    }
  }

  function renderTicketInfo(ticket) {
    ticketLoading.style.display = 'none';
    ticketDetails.style.display = 'block';

    roomVal.textContent = ticket.room || '-';
    catVal.textContent = ticket.category || 'Umum';
    notesVal.textContent = ticket.notes || '-';

    const dateObj = new Date(ticket.createdAt);
    timeVal.textContent = dateObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB (' + dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) + ')';

    let badgeHtml = '';
    if (ticket.status === 'Menunggu') {
      badgeHtml = '<span class="status-badge status-menunggu">🟡 Menunggu Support</span>';
      claimActionSection.style.display = 'block';
      inProgressSection.style.display = 'none';
      completedSection.style.display = 'none';
    } else if (ticket.status === 'Diproses') {
      const handler = ticket.handledBy || 'Tim Support';
      badgeHtml = `<span class="status-badge status-diproses">🔵 Diproses (${escapeHTML(handler)})</span>`;
      claimActionSection.style.display = 'none';
      inProgressSection.style.display = 'block';
      completedSection.style.display = 'none';
      currentHandlerText.textContent = handler;
    } else if (ticket.status === 'Selesai') {
      badgeHtml = '<span class="status-badge status-selesai">🟢 Selesai Ditangani</span>';
      claimActionSection.style.display = 'none';
      inProgressSection.style.display = 'none';
      completedSection.style.display = 'block';
      if (ticket.handledBy) {
        completedHandlerText.textContent = `Ditangani oleh: ${ticket.handledBy}`;
      }
    }
    statusVal.innerHTML = badgeHtml;
  }

  // Handle Claim
  if (claimForm) {
    claimForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const staffName = staffNameInput.value.trim();
      if (!staffName) return;

      localStorage.setItem('last_support_staff_name', staffName);
      btnClaimSubmit.disabled = true;
      btnClaimSubmit.textContent = '⏳ Memproses Klaim...';

      try {
        const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ staffName })
        });
        const data = await res.json();
        if (data.success) {
          alert(`✅ Sukses! Anda telah mengambil tiket ruang ${data.ticket.room}. Layar pemanggil di kelas telah terupdate.`);
          renderTicketInfo(data.ticket);
        } else {
          alert('❌ Gagal: ' + (data.error || 'Terjadi kesalahan'));
        }
      } catch (err) {
        console.error(err);
        alert('Terjadi kesalahan jaringan.');
      } finally {
        btnClaimSubmit.disabled = false;
        btnClaimSubmit.textContent = '🚀 Ambil & Tangani Tiket Sekarang';
      }
    });
  }

  // Handle Complete
  if (btnCompleteSubmit) {
    btnCompleteSubmit.addEventListener('click', async () => {
      if (!confirm('Apakah penanganan kendala di ruangan ini sudah benar-benar selesai?')) return;

      btnCompleteSubmit.disabled = true;
      btnCompleteSubmit.textContent = '⏳ Memperbarui Status...';

      const staffName = localStorage.getItem('last_support_staff_name') || '';

      try {
        const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ staffName })
        });
        const data = await res.json();
        if (data.success) {
          alert('✅ Sukses! Tiket telah ditandai selesai.');
          renderTicketInfo(data.ticket);
        } else {
          alert('❌ Gagal: ' + (data.error || 'Terjadi kesalahan'));
        }
      } catch (err) {
        console.error(err);
        alert('Terjadi kesalahan jaringan.');
      } finally {
        btnCompleteSubmit.disabled = false;
        btnCompleteSubmit.textContent = '✓ Tandai Masalah Telah Selesai Ditangani';
      }
    });
  }

  await fetchTicketData();
});
