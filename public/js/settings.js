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

document.addEventListener('DOMContentLoaded', async () => {
  const fonnteToken = document.getElementById('fonnteToken');
  const staffNumbersInput = document.getElementById('staffNumbersInput');
  const teleBotToken = document.getElementById('teleBotToken');
  const teleChatIds = document.getElementById('teleChatIds');
  const messageTemplate = document.getElementById('messageTemplate');
  const claimBaseUrl = document.getElementById('claimBaseUrl');
  const adminPasswordInput = document.getElementById('adminPasswordInput');
  const roomTagsContainer = document.getElementById('roomTagsContainer');
  const newRoomInput = document.getElementById('newRoomInput');
  const btnAddRoom = document.getElementById('btnAddRoom');
  const settingsForm = document.getElementById('settingsForm');
  const btnTestWa = document.getElementById('btnTestWa');
  const btnTestTele = document.getElementById('btnTestTele');

  let currentRooms = [];

  // Load Settings from API
  try {
    const res = await fetch('/api/admin/settings', {
      headers: getAuthHeaders()
    });
    if (res.status === 401) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }
    const data = await res.json();
    if (data.success) {
      const s = data.settings;
      
      // Radio notificationChannel
      const chVal = s.notificationChannel || 'both';
      const rad = document.querySelector(`input[name="notificationChannel"][value="${chVal}"]`);
      if (rad) rad.checked = true;

      // Telegram
      if (teleBotToken) teleBotToken.value = (s.telegramGateway && s.telegramGateway.botToken) || '';
      if (teleChatIds) teleChatIds.value = (s.telegramGateway && s.telegramGateway.chatIds) ? s.telegramGateway.chatIds.join(', ') : '';

      // WA
      fonnteToken.value = (s.waGateway && s.waGateway.fonnteToken) || '';
      staffNumbersInput.value = (s.waGateway && s.waGateway.staffNumbers) ? s.waGateway.staffNumbers.join(', ') : '';
      
      messageTemplate.value = s.messageTemplate || "Mohon bantuan teknis di ruang {room} SEGERA!";
      if (claimBaseUrl) claimBaseUrl.value = s.claimBaseUrl || "https://qr-layanan-teknis-sbm.vercel.app";
      currentRooms = s.rooms || [
        "Henk Uno",
        "Kirana Megatara 1",
        "Kirana Megatara 2",
        "Noni Purnomo",
        "Medco",
        "12A Room"
      ];
      renderRoomTags();
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }

  function renderRoomTags() {
    roomTagsContainer.innerHTML = currentRooms.map((room, idx) => `
      <div class="tag-item">
        <span>📍 ${escapeHTML(room)}</span>
        <span class="tag-remove" onclick="removeRoom(${idx})">&times;</span>
      </div>
    `).join('');
  }

  window.removeRoom = (idx) => {
    currentRooms.splice(idx, 1);
    renderRoomTags();
  };

  btnAddRoom.addEventListener('click', () => {
    const val = newRoomInput.value.trim();
    if (val && !currentRooms.includes(val)) {
      currentRooms.push(val);
      renderRoomTags();
      newRoomInput.value = '';
    }
  });

  // Save Settings
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const staffNumbers = staffNumbersInput.value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const chatIds = teleChatIds.value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const selectedChannel = document.querySelector('input[name="notificationChannel"]:checked')?.value || 'both';
    const newPass = adminPasswordInput && adminPasswordInput.value.trim();

    const payload = {
      messageTemplate: messageTemplate.value.trim(),
      claimBaseUrl: claimBaseUrl ? claimBaseUrl.value.trim() : undefined,
      notificationChannel: selectedChannel,
      adminPassword: newPass || undefined,
      rooms: currentRooms,
      waGateway: {
        provider: fonnteToken.value.trim() ? 'fonnte' : 'simulation',
        fonnteToken: fonnteToken.value.trim(),
        staffNumbers: staffNumbers
      },
      telegramGateway: {
        enabled: true,
        botToken: teleBotToken.value.trim(),
        chatIds: chatIds
      }
    };

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = await res.json();
      if (data.success) {
        if (newPass) {
          alert('✅ Pengaturan & Kata Sandi Admin baru berhasil disimpan! Silakan gunakan kata sandi baru saat login berikutnya.');
        } else {
          alert('✅ Pengaturan sistem, WhatsApp, & Telegram Bot berhasil disimpan!');
        }
        if (adminPasswordInput) adminPasswordInput.value = '';
      } else {
        alert('❌ Gagal menyimpan: ' + data.error);
      }
    } catch (err) {
      console.error('Error saving settings:', err);
      alert('Terjadi kesalahan koneksi.');
    }
  });

  // Test Telegram
  if (btnTestTele) {
    btnTestTele.addEventListener('click', async () => {
      btnTestTele.disabled = true;
      btnTestTele.textContent = '⏳ Mengirim Telegram...';

      try {
        const res = await fetch('/api/admin/test-telegram', {
          method: 'POST',
          headers: getAuthHeaders()
        });
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        const data = await res.json();

        if (data.success) {
          if (data.result && data.result.mode === 'simulation') {
            alert('ℹ️ Mode Simulasi: Pesan Telegram tercatat di log server. (Isi Bot Token dan Chat ID untuk mengirim ke Telegram asli).');
          } else {
            alert('✅ Pesan Telegram uji coba berhasil dikirim ke grup/akun staf support!');
          }
        } else {
          alert('❌ Gagal mengirim Telegram: ' + (data.error || JSON.stringify(data.result)));
        }
      } catch (err) {
        console.error('Test Telegram error:', err);
        alert('Terjadi kesalahan saat memanggil API Telegram.');
      } finally {
        btnTestTele.disabled = false;
        btnTestTele.textContent = '✈️ Uji Coba Kirim Telegram';
      }
    });
  }

  // Test WhatsApp
  btnTestWa.addEventListener('click', async () => {
    btnTestWa.disabled = true;
    btnTestWa.textContent = '⏳ Mengirim Uji Coba...';

    try {
      const res = await fetch('/api/admin/test-wa', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = await res.json();

      if (data.success) {
        if (data.result && data.result.mode === 'simulation') {
          alert('ℹ️ Mode Simulasi: Pesan uji coba berhasil tercatat di log server. (Isi Fonnte Token dan Nomor Staf untuk mengirim ke WhatsApp asli).');
        } else {
          alert('✅ Pesan WhatsApp uji coba berhasil terkirim ke nomor staf!');
        }
      } else {
        alert('❌ Gagal mengirim pesan uji coba: ' + (data.error || JSON.stringify(data.result)));
      }
    } catch (err) {
      console.error('Test WA error:', err);
      alert('Terjadi kesalahan saat memanggil API test.');
    } finally {
      btnTestWa.disabled = false;
      btnTestWa.textContent = '📲 Uji Coba Kirim WA';
    }
  });
});

