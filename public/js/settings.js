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

document.addEventListener('DOMContentLoaded', async () => {
  const fonnteToken = document.getElementById('fonnteToken');
  const staffNumbersInput = document.getElementById('staffNumbersInput');
  const messageTemplate = document.getElementById('messageTemplate');
  const claimBaseUrl = document.getElementById('claimBaseUrl');
  const adminPasswordInput = document.getElementById('adminPasswordInput');
  const roomTagsContainer = document.getElementById('roomTagsContainer');
  const newRoomInput = document.getElementById('newRoomInput');
  const btnAddRoom = document.getElementById('btnAddRoom');
  const settingsForm = document.getElementById('settingsForm');
  const btnTestWa = document.getElementById('btnTestWa');

  let currentRooms = [];

  // Load Settings from API
  try {
    const res = await fetch('/api/admin/settings');
    if (res.status === 401) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }
    const data = await res.json();
    if (data.success) {
      const s = data.settings;
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

    const newPass = adminPasswordInput && adminPasswordInput.value.trim();

    const payload = {
      messageTemplate: messageTemplate.value.trim(),
      claimBaseUrl: claimBaseUrl ? claimBaseUrl.value.trim() : undefined,
      adminPassword: newPass || undefined,
      rooms: currentRooms,
      waGateway: {
        provider: fonnteToken.value.trim() ? 'fonnte' : 'simulation',
        fonnteToken: fonnteToken.value.trim(),
        staffNumbers: staffNumbers
      }
    };

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          alert('✅ Pengaturan sistem & WhatsApp Gateway berhasil disimpan!');
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

  // Test WhatsApp
  btnTestWa.addEventListener('click', async () => {
    btnTestWa.disabled = true;
    btnTestWa.textContent = '⏳ Mengirim Uji Coba...';

    try {
      const res = await fetch('/api/admin/test-wa', { method: 'POST' });
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

