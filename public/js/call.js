function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room') || 'Henk Uno';
  
  const displayRoomName = document.getElementById('displayRoomName');
  const trackingRoomName = document.getElementById('trackingRoomName');
  const trackingTicketId = document.getElementById('trackingTicketId');
  const btnCallNow = document.getElementById('btnCallNow');
  const categoryChips = document.querySelectorAll('.chip-option');
  const inputNotes = document.getElementById('inputNotes');
  const callCard = document.getElementById('callCard');
  const trackingBox = document.getElementById('trackingBox');
  const btnCallAgain = document.getElementById('btnCallAgain');

  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');

  const liveStatusCard = document.getElementById('liveStatusCard');
  const statusEmoji = document.getElementById('statusEmoji');
  const statusTitle = document.getElementById('statusTitle');
  const statusDesc = document.getElementById('statusDesc');

  let selectedCategory = 'Umum';
  let activeTicketId = null;
  let pollInterval = null;

  // Set room name display safely
  displayRoomName.textContent = roomParam;
  if (trackingRoomName) trackingRoomName.textContent = roomParam;

  // Category selection handler
  categoryChips.forEach(chip => {
    chip.addEventListener('click', () => {
      categoryChips.forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedCategory = chip.getAttribute('data-category');
    });
  });

  // Call Button Click
  btnCallNow.addEventListener('click', async () => {
    // Disable button & show spinner
    btnCallNow.disabled = true;
    btnCallNow.innerHTML = '<span class="spinner"></span> <span>Mengirim Notifikasi...</span>';

    const payload = {
      room: roomParam,
      category: selectedCategory,
      notes: inputNotes.value ? inputNotes.value.trim() : ''
    };

    try {
      const response = await fetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (response.status === 429) {
        alert('⏱️ ' + (data.error || 'Batas panggilan tercapai. Mohon tunggu sejenak.'));
        resetButton();
        return;
      }

      if (data.success && data.ticket) {
        activeTicketId = data.ticket.id;
        showTrackingView(data.ticket);
      } else {
        alert('Gagal mengirim panggilan: ' + (data.error || 'Terjadi kesalahan'));
        resetButton();
      }
    } catch (err) {
      console.error('Call error:', err);
      alert('Koneksi bermasalah. Pastikan jaringan internet/Wi-Fi Anda aktif.');
      resetButton();
    }
  });

  function showTrackingView(ticket) {
    callCard.style.display = 'none';
    trackingBox.style.display = 'block';
    trackingTicketId.textContent = '#' + ticket.id.slice(-6);

    updateTrackingUI(ticket);

    // Start Live Polling every 3 seconds
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(pollTicketStatus, 3000);
  }

  async function pollTicketStatus() {
    if (!activeTicketId) return;

    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(activeTicketId)}`);
      const data = await res.json();
      if (data.success && data.ticket) {
        updateTrackingUI(data.ticket);
        if (data.ticket.status === 'Selesai' && pollInterval) {
          // Slow down polling once finished
          clearInterval(pollInterval);
          pollInterval = setInterval(pollTicketStatus, 10000);
        }
      }
    } catch (e) {
      console.warn('Poll ticket error:', e);
    }
  }

  function updateTrackingUI(ticket) {
    const status = ticket.status;
    const handler = ticket.handledBy || '';

    // Reset classes
    liveStatusCard.className = 'live-status-card';
    step1.className = 'step-item';
    step2.className = 'step-item';
    step3.className = 'step-item';

    if (status === 'Menunggu') {
      liveStatusCard.classList.add('state-menunggu');
      statusEmoji.textContent = '🟡';
      statusTitle.textContent = 'Menunggu Support...';
      statusDesc.textContent = 'Panggilan bantuan telah terkirim ke WhatsApp tim teknis. Menunggu staf mengambil tiket.';

      step1.classList.add('active');
    } else if (status === 'Diproses') {
      liveStatusCard.classList.add('state-diproses');
      statusEmoji.textContent = '🔵';
      
      const staffDisplay = handler ? `Support (${handler})` : 'Tim Support';
      statusTitle.textContent = `${staffDisplay} sedang menuju lokasi`;
      statusDesc.textContent = `Staf ${staffDisplay} telah menerima panggilan Anda dan sedang dalam perjalanan menuju ruang ${ticket.room}.`;

      step1.classList.add('completed');
      step2.classList.add('active');
    } else if (status === 'Selesai') {
      liveStatusCard.classList.add('state-selesai');
      statusEmoji.textContent = '🟢';
      statusTitle.textContent = 'Kendala telah selesai ditangani';
      statusDesc.textContent = handler 
        ? `Bantuan teknis telah diselesaikan oleh ${handler}. Terima kasih telah menggunakan layanan teknis SBM ITB.`
        : 'Bantuan teknis telah selesai dilaksanakan. Terima kasih.';

      step1.classList.add('completed');
      step2.classList.add('completed');
      step3.classList.add('completed');
    }
  }

  function resetButton() {
    btnCallNow.disabled = false;
    btnCallNow.innerHTML = '<span>🚨 PANGGIL BANTUAN SEGERA</span>';
  }

  // Call again button
  btnCallAgain.addEventListener('click', () => {
    if (pollInterval) clearInterval(pollInterval);
    activeTicketId = null;
    trackingBox.style.display = 'none';
    callCard.style.display = 'block';
    resetButton();
    inputNotes.value = '';
  });
});

