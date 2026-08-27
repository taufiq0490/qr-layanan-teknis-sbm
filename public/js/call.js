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
  const callCard = document.getElementById('callCard');
  const trackingBox = document.getElementById('trackingBox');
  const btnCallAgain = document.getElementById('btnCallAgain');

  // Modal Elements
  const categoryModal = document.getElementById('categoryModal');
  const btnModalClose = document.getElementById('btnModalClose');
  const btnCancelModal = document.getElementById('btnCancelModal');
  const btnConfirmSend = document.getElementById('btnConfirmSend');
  const modalRoomName = document.getElementById('modalRoomName');
  const modalOptionBtns = document.querySelectorAll('.modal-option-btn');
  const notesLabel = document.getElementById('notesLabel');
  const inputOptionalNotes = document.getElementById('inputOptionalNotes');

  // Tracking View Elements
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');
  const liveStatusCard = document.getElementById('liveStatusCard');
  const statusEmoji = document.getElementById('statusEmoji');
  const statusTitle = document.getElementById('statusTitle');
  const statusDesc = document.getElementById('statusDesc');

  const rateLimitText = document.getElementById('rateLimitText');
  const rateLimitBadge = document.getElementById('rateLimitBadge');

  let selectedCategory = 'Umum';
  let activeTicketId = null;
  let pollInterval = null;
  let geofencingConfig = {
    enabled: true,
    campusName: "SBM ITB Jakarta (Graha Irama)",
    latitude: -6.23933,
    longitude: 106.83228,
    maxRadiusMeters: 250
  };

  // Helper untuk update status wajib/opsional catatan kendala
  function updateNotesRequirement(category) {
    const isUmum = (category === 'Umum');
    if (notesLabel) {
      if (isUmum) {
        notesLabel.innerHTML = 'Catatan kendala / rincian masalah <span style="color: #DC2626;">(wajib diisi)</span>: <span style="color: #DC2626;">*</span>';
      } else {
        notesLabel.innerHTML = 'Catatan kendala / keterangan tambahan (opsional):';
      }
    }
    if (inputOptionalNotes) {
      if (isUmum) {
        inputOptionalNotes.placeholder = 'Tuliskan catatan kendala yang dialami... (wajib diisi)';
      } else {
        inputOptionalNotes.placeholder = 'Tuliskan catatan tambahan jika ada...';
        inputOptionalNotes.style.borderColor = '';
        inputOptionalNotes.style.boxShadow = '';
      }
    }
  }

  if (inputOptionalNotes) {
    inputOptionalNotes.addEventListener('input', () => {
      if (inputOptionalNotes.value.trim()) {
        inputOptionalNotes.style.borderColor = '';
        inputOptionalNotes.style.boxShadow = '';
      }
    });
  }

  // Haversine distance calculator
  function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp/2) * Math.sin(dp/2) +
              Math.cos(p1) * Math.cos(p2) *
              Math.sin(dl/2) * Math.sin(dl/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Load app info (including geofencing settings)
  async function loadAppInfo() {
    try {
      const res = await fetch('/api/info');
      const data = await res.json();
      if (data.geofencing) {
        geofencingConfig = data.geofencing;
      }
    } catch (e) {
      console.warn('Load info error:', e);
    }
  }
  loadAppInfo();

  // Set room name display safely
  displayRoomName.textContent = roomParam;
  if (modalRoomName) modalRoomName.textContent = roomParam;
  if (trackingRoomName) trackingRoomName.textContent = roomParam;

  // Load and display remaining quota
  async function updateQuotaDisplay() {
    try {
      const res = await fetch(`/api/call-quota?room=${encodeURIComponent(roomParam)}`);
      const data = await res.json();
      if (data.success) {
        const rem = data.remainingCalls;
        const max = data.maxCalls || 3;
        if (rem === max) {
          rateLimitText.textContent = `Sisa kuota panggilan: ${rem} dari ${max} kali (dalam 2 menit)`;
          if (rateLimitBadge) rateLimitBadge.style.borderColor = '#CBD5E1';
        } else if (rem > 0) {
          rateLimitText.textContent = `Sisa kuota panggilan: ${rem} dari ${max} kali (reset dlm ${data.resetInSeconds} dtk)`;
          if (rateLimitBadge) rateLimitBadge.style.borderColor = '#F59E0B';
        } else {
          rateLimitText.textContent = `Batas panggilan tercapai (0/${max}). Silakan tunggu ${data.resetInSeconds} detik`;
          if (rateLimitBadge) rateLimitBadge.style.borderColor = '#EF4444';
        }
      }
    } catch (e) {
      if (rateLimitText) rateLimitText.textContent = 'Batas panggilan: Maks. 3 kali per 2 menit';
    }
  }

  updateQuotaDisplay();
  setInterval(updateQuotaDisplay, 5000);

  // Open Modal on "PANGGIL BANTUAN SEGERA" Click
  btnCallNow.addEventListener('click', () => {
    updateNotesRequirement(selectedCategory);
    categoryModal.style.display = 'flex';
  });

  function closeModal() {
    categoryModal.style.display = 'none';
    resetModalButton();
  }

  btnModalClose.addEventListener('click', closeModal);
  btnCancelModal.addEventListener('click', closeModal);

  // Close modal when clicking backdrop outside card
  categoryModal.addEventListener('click', (e) => {
    if (e.target === categoryModal) {
      closeModal();
    }
  });

  // Modal Category selection handler
  modalOptionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modalOptionBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedCategory = btn.getAttribute('data-category') || 'Umum';
      updateNotesRequirement(selectedCategory);
    });
  });

  // Reset modal submit button
  function resetModalButton() {
    btnConfirmSend.disabled = false;
    btnConfirmSend.innerHTML = '<span>🚨 Kirim Panggilan</span>';
  }

  // Get current position using browser Geolocation API
  function getCoordinates() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        return reject(new Error('Browser Anda tidak mendukung fitur lokasi GPS.'));
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          });
        },
        (err) => {
          reject(err);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  }

  // Confirm and Send Call Button Click
  btnConfirmSend.addEventListener('click', async () => {
    const finalCategory = selectedCategory || 'Umum';
    const finalNotes = inputOptionalNotes ? inputOptionalNotes.value.trim() : '';

    // Validasi: Jika kategori Umum dipilih, catatan kendala WAJIB diisi
    if (finalCategory === 'Umum' && !finalNotes) {
      alert('⚠️ Catatan kendala wajib diisi jika memilih kategori "Umum".\n\nSilakan tuliskan penjelasan singkat mengenai kendala yang Anda alami agar tim teknis dapat membawa peralatan yang tepat.');
      if (inputOptionalNotes) {
        inputOptionalNotes.focus();
        inputOptionalNotes.style.borderColor = '#DC2626';
        inputOptionalNotes.style.boxShadow = '0 0 0 3px rgba(220, 38, 38, 0.2)';
      }
      resetModalButton();
      return;
    }

    let userLat = null;
    let userLon = null;

    // GPS Geofencing Check
    if (geofencingConfig && geofencingConfig.enabled !== false) {
      btnConfirmSend.disabled = true;
      btnConfirmSend.innerHTML = '<span class="spinner"></span> <span>Memverifikasi Lokasi Kampus...</span>';

      try {
        const coords = await getCoordinates();
        userLat = coords.latitude;
        userLon = coords.longitude;

        const campusLat = geofencingConfig.latitude || -6.23933;
        const campusLon = geofencingConfig.longitude || 106.83228;
        const maxRadius = geofencingConfig.maxRadiusMeters || 250;
        const distance = calculateDistanceMeters(userLat, userLon, campusLat, campusLon);

        if (distance > maxRadius) {
          const campusName = geofencingConfig.campusName || 'SBM ITB Jakarta';
          alert(`🚫 Panggilan Ditolak (Di Luar Kampus):\n\nAnda terdeteksi berada di luar area kampus ${campusName} (Jarak: ~${Math.round(distance)} meter, batas: ${maxRadius}m).\n\nLayanan bantuan darurat ini hanya dapat digunakan saat berada di dalam area ruang kelas kampus.`);
          resetModalButton();
          return;
        }
      } catch (geoErr) {
        console.warn('Geolocation error:', geoErr);
        alert('📍 Izin Lokasi Diperlukan:\n\nUntuk memverifikasi bahwa panggilan bantuan berasal dari ruang kelas SBM ITB Jakarta, mohon aktifkan GPS dan izinkan akses lokasi pada browser HP Anda.');
        resetModalButton();
        return;
      }
    }

    // Disable button & show spinner
    btnConfirmSend.disabled = true;
    btnConfirmSend.innerHTML = '<span class="spinner"></span> <span>Mengirim Notifikasi...</span>';

    const payload = {
      room: roomParam,
      category: finalCategory,
      notes: finalNotes,
      latitude: userLat,
      longitude: userLon
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
        updateQuotaDisplay();
        resetModalButton();
        return;
      }

      if (response.status === 403) {
        alert('🚫 ' + (data.error || 'Akses ditolak: di luar area kampus.'));
        updateQuotaDisplay();
        resetModalButton();
        return;
      }

      if (data.success && data.ticket) {
        activeTicketId = data.ticket.id;
        lastTrackedStatus = data.ticket.status;
        if (window.SoundNotifier) {
          window.SoundNotifier.playCallSentSound();
        }
        updateQuotaDisplay();
        closeModal();
        showTrackingView(data.ticket);
      } else {
        alert('Gagal mengirim panggilan: ' + (data.error || 'Terjadi kesalahan'));
        updateQuotaDisplay();
        resetModalButton();
      }
    } catch (err) {
      console.error('Call error:', err);
      alert('Koneksi internet bermasalah. Silakan periksa kembali jaringan Anda dan coba lagi.');
      updateQuotaDisplay();
      resetModalButton();
    }
  });

  let lastTrackedStatus = null;

  function showTrackingView(ticket) {
    callCard.style.display = 'none';
    trackingBox.style.display = 'block';
    trackingTicketId.textContent = '#' + ticket.id.slice(-6);
    lastTrackedStatus = ticket.status;

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
        const prevStatus = lastTrackedStatus;
        const newStatus = data.ticket.status;

        // Trigger sound on status change
        if (prevStatus && prevStatus !== newStatus && window.SoundNotifier) {
          if (newStatus === 'Diproses') {
            window.SoundNotifier.playStaffDispatchedSound();
          } else if (newStatus === 'Selesai') {
            window.SoundNotifier.playCompletedSound();
          }
        }
        lastTrackedStatus = newStatus;

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

  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '< 1 menit';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m === 0) return `${s} detik`;
    if (m < 60) return s > 0 ? `${m} menit ${s} detik` : `${m} menit`;
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return remM > 0 ? `${h} jam ${remM} menit` : `${h} jam`;
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
      statusDesc.textContent = 'Panggilan bantuan telah terkirim ke tim support. Menunggu staf mengambil tiket.';

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

      let timeInfo = '';
      if (ticket.completedAt) {
        const compD = new Date(ticket.completedAt);
        const compTime = compD.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
        const durText = ticket.resolutionTimeSeconds ? ` (Durasi pengerjaan: ${formatDuration(ticket.resolutionTimeSeconds)})` : '';
        timeInfo = `<div style="margin-top: 8px; font-weight: 700; color: #047857; font-size: 0.9rem;">🕒 Selesai pada: ${compTime}${durText}</div>`;
      }

      statusDesc.innerHTML = (handler 
        ? `Bantuan teknis telah diselesaikan oleh <strong>${escapeHTML(handler)}</strong>. Terima kasih telah menggunakan layanan teknis SBM ITB.`
        : 'Bantuan teknis telah selesai dilaksanakan. Terima kasih.') + timeInfo;

      step1.classList.add('completed');
      step2.classList.add('completed');
      step3.classList.add('completed');
    }
  }

  // Call again button
  btnCallAgain.addEventListener('click', () => {
    if (pollInterval) clearInterval(pollInterval);
    activeTicketId = null;
    lastTrackedStatus = null;
    trackingBox.style.display = 'none';
    callCard.style.display = 'block';
    if (inputOptionalNotes) inputOptionalNotes.value = '';
  });
});

