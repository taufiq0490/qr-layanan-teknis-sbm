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
  const superAdminPasswordInput = document.getElementById('superAdminPasswordInput');
  const currentSuperAdminPasswordInput = document.getElementById('currentSuperAdminPasswordInput');
  const roomTagsContainer = document.getElementById('roomTagsContainer');
  const newRoomInput = document.getElementById('newRoomInput');
  const btnAddRoom = document.getElementById('btnAddRoom');
  const settingsForm = document.getElementById('settingsForm');
  const btnTestWa = document.getElementById('btnTestWa');
  const btnTestTele = document.getElementById('btnTestTele');

  let currentRooms = [];

  // Check Super Admin Auth
  try {
    const authRes = await fetch('/api/admin/check-auth', { headers: getAuthHeaders() });
    const authData = await authRes.json();
    if (!authData.authenticated) {
      window.location.href = '/login?role=superadmin&redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }
    if (!authData.isSuperAdmin) {
      alert('⚠️ Akses Pengaturan Sistem dibatasi hanya untuk Super Admin. Silakan masukkan kata sandi Super Admin.');
      window.location.href = '/login?role=superadmin&redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }
    const badgeContainer = document.getElementById('userRoleBadge');
    if (badgeContainer) {
      badgeContainer.className = 'role-badge superadmin';
      badgeContainer.innerHTML = '👑 Super Admin';
    }
  } catch (e) {}

  // Load Settings from API
  try {
    const res = await fetch('/api/admin/settings', {
      headers: getAuthHeaders()
    });
    if (res.status === 401 || res.status === 403) {
      window.location.href = '/login?role=superadmin&redirect=' + encodeURIComponent(window.location.pathname);
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
      
      // Geofencing
      const geo = s.geofencing || {};
      const geoEnabled = document.getElementById('geoEnabled');
      const geoLat = document.getElementById('geoLat');
      const geoLon = document.getElementById('geoLon');
      const geoRadius = document.getElementById('geoRadius');

      if (geoEnabled) geoEnabled.checked = geo.enabled !== false;
      if (geoLat) geoLat.value = geo.latitude ?? -6.23933;
      if (geoLon) geoLon.value = geo.longitude ?? 106.83228;
      if (geoRadius) geoRadius.value = geo.maxRadiusMeters ?? 250;

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

  // Audio Notification Settings Binding
  if (window.SoundNotifier) {
    const sn = window.SoundNotifier;
    const settingsSoundType = document.getElementById('settingsSoundType');
    const settingsSoundVolume = document.getElementById('settingsSoundVolume');
    const settingsVolPercent = document.getElementById('settingsVolPercent');
    const settingsLoopAlarm = document.getElementById('settingsLoopAlarm');
    const btnSettingsTestSound = document.getElementById('btnSettingsTestSound');

    if (settingsSoundType) {
      settingsSoundType.value = sn.soundType;
      settingsSoundType.addEventListener('change', (e) => {
        sn.setSoundType(e.target.value);
      });
    }

    if (settingsSoundVolume) {
      settingsSoundVolume.value = sn.volume;
      if (settingsVolPercent) settingsVolPercent.textContent = Math.round(sn.volume * 100) + '%';

      settingsSoundVolume.addEventListener('input', (e) => {
        sn.setVolume(e.target.value);
        if (settingsVolPercent) settingsVolPercent.textContent = Math.round(e.target.value * 100) + '%';
      });
    }

    if (settingsLoopAlarm) {
      settingsLoopAlarm.checked = sn.loopEnabled;
      settingsLoopAlarm.addEventListener('change', (e) => {
        sn.setLoopEnabled(e.target.checked);
      });
    }

    if (btnSettingsTestSound) {
      btnSettingsTestSound.addEventListener('click', () => {
        const type = settingsSoundType ? settingsSoundType.value : sn.soundType;
        sn.testSound(type);
      });
    }
  }


  // Global Helper: Fetch WhatsApp Groups from Fonnte
  window.fetchWhatsAppGroups = async function() {
    const btnFetchWAGroups = document.getElementById('btnFetchWAGroups');
    const detectedWAGroupsBox = document.getElementById('detectedWAGroupsBox');
    const detectedWAGroupsList = document.getElementById('detectedWAGroupsList');

    if (btnFetchWAGroups) {
      btnFetchWAGroups.disabled = true;
      btnFetchWAGroups.textContent = '⏳ Mengambil grup...';
    }

    try {
      const res = await fetch('/api/admin/wa-groups', {
        headers: getAuthHeaders()
      });
      const data = await res.json();

      if (data.success && Array.isArray(data.groups) && data.groups.length > 0) {
        if (detectedWAGroupsBox) detectedWAGroupsBox.style.display = 'block';
        if (detectedWAGroupsList) {
          detectedWAGroupsList.innerHTML = data.groups.map(g => {
            const gid = g.id || g.jid || '';
            const gname = g.name || g.subject || 'Grup Tanpa Nama';
            return `
              <div style="display: flex; justify-content: space-between; align-items: center; background: white; padding: 8px 10px; border-radius: 6px; border: 1px solid #D1FAE5; font-size: 0.82rem;">
                <div>
                  <strong style="color: #065F46;">💬 ${escapeHTML(gname)}</strong>
                  <div style="font-size: 0.74rem; color: #64748B; font-family: monospace;">${escapeHTML(gid)}</div>
                </div>
                <button type="button" class="btn btn-outline" onclick="window.addWAGroupToTargets('${escapeHTML(gid)}')" style="font-size: 0.74rem; padding: 4px 10px; height: auto;">
                  ➕ Pilih Grup Ini
                </button>
              </div>
            `;
          }).join('');
        }
      } else if (data.success && Array.isArray(data.groups) && data.groups.length === 0) {
        if (detectedWAGroupsBox) {
          detectedWAGroupsBox.style.display = 'block';
          detectedWAGroupsList.innerHTML = `
            <div style="background: white; padding: 10px; border-radius: 6px; border: 1px solid #FED7AA; font-size: 0.82rem; color: #9A3412;">
              <strong>ℹ️ Belum Ada Grup Terdeteksi di Fonnte:</strong>
              <div style="margin-top: 4px; font-size: 0.78rem; line-height: 1.4; color: #475569;">
                1. Pastikan nomor WhatsApp Anda di Fonnte sudah masuk ke dalam Grup WA di HP Anda.<br>
                2. Anda juga bisa melihat ID Grup di <strong><a href="https://dashboard.fonnte.com" target="_blank" style="color: #0284C7; text-decoration: underline;">dashboard.fonnte.com</a> ➔ menu Group</strong> lalu tempelkan manual pada kolom di atas.
              </div>
            </div>
          `;
        }
      } else {
        alert('❌ Gagal mengambil grup WhatsApp: ' + (data.error || 'Pastikan token Fonnte valid & terhubung ke WhatsApp.'));
      }
    } catch (err) {
      alert('❌ Terjadi kesalahan saat menghubungi server: ' + err.message);
    } finally {
      if (btnFetchWAGroups) {
        btnFetchWAGroups.disabled = false;
        btnFetchWAGroups.textContent = '👥 Cari Group WA Saya';
      }
    }
  };

  // Global Helper: Add Group ID to input
  window.addWAGroupToTargets = function(groupId) {
    if (!groupId) return;
    const staffNumbersInput = document.getElementById('staffNumbersInput');
    if (!staffNumbersInput) return;
    const currentVal = staffNumbersInput.value.trim();
    if (!currentVal) {
      staffNumbersInput.value = groupId;
    } else {
      const parts = currentVal.split(',').map(s => s.trim()).filter(Boolean);
      if (!parts.includes(groupId)) {
        parts.push(groupId);
        staffNumbersInput.value = parts.join(', ');
      }
    }
    alert(`✅ ID Group "${groupId}" berhasil ditambahkan ke daftar penerima notifikasi!`);
  };

  // Button: Get current location for Geofencing
  const btnGetCurrentLocation = document.getElementById('btnGetCurrentLocation');
  if (btnGetCurrentLocation) {
    btnGetCurrentLocation.addEventListener('click', () => {
      if (!navigator.geolocation) {
        alert('Browser Anda tidak mendukung fitur lokasi GPS.');
        return;
      }
      btnGetCurrentLocation.disabled = true;
      btnGetCurrentLocation.textContent = '⏳ Mengambil koordinat GPS...';

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const geoLat = document.getElementById('geoLat');
          const geoLon = document.getElementById('geoLon');
          if (geoLat) geoLat.value = pos.coords.latitude.toFixed(6);
          if (geoLon) geoLon.value = pos.coords.longitude.toFixed(6);
          alert(`✅ Lokasi berhasil didapatkan!\n\nLatitude: ${pos.coords.latitude}\nLongitude: ${pos.coords.longitude}\nAkurasi: ±${Math.round(pos.coords.accuracy)} meter`);
          btnGetCurrentLocation.disabled = false;
          btnGetCurrentLocation.textContent = '🎯 Gunakan Lokasi Saya Saat Ini';
        },
        (err) => {
          alert('❌ Gagal mendapatkan lokasi GPS: ' + err.message);
          btnGetCurrentLocation.disabled = false;
          btnGetCurrentLocation.textContent = '🎯 Gunakan Lokasi Saya Saat Ini';
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
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
    const newStaffPass = adminPasswordInput && adminPasswordInput.value.trim();
    const newSuperPass = superAdminPasswordInput && superAdminPasswordInput.value.trim();
    const currentSuperPass = currentSuperAdminPasswordInput && currentSuperAdminPasswordInput.value.trim();

    // Check if user is attempting to change password
    if ((newStaffPass || newSuperPass) && !currentSuperPass) {
      alert('⚠️ Untuk mengubah kata sandi, Anda wajib memasukkan Kata Sandi Super Admin yang lama/saat ini terlebih dahulu.');
      if (currentSuperAdminPasswordInput) {
        currentSuperAdminPasswordInput.focus();
      }
      return;
    }

    const geoEnabled = document.getElementById('geoEnabled');
    const geoLat = document.getElementById('geoLat');
    const geoLon = document.getElementById('geoLon');
    const geoRadius = document.getElementById('geoRadius');

    const payload = {
      messageTemplate: messageTemplate.value.trim(),
      claimBaseUrl: claimBaseUrl ? claimBaseUrl.value.trim() : undefined,
      notificationChannel: selectedChannel,
      currentSuperAdminPassword: currentSuperPass || undefined,
      adminPassword: newStaffPass || undefined,
      superAdminPassword: newSuperPass || undefined,
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
      },
      geofencing: {
        enabled: geoEnabled ? geoEnabled.checked : true,
        latitude: geoLat ? parseFloat(geoLat.value) : -6.23933,
        longitude: geoLon ? parseFloat(geoLon.value) : 106.83228,
        maxRadiusMeters: geoRadius ? parseInt(geoRadius.value, 10) : 250
      }
    };

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      if (res.status === 401 || res.status === 403) {
        window.location.href = '/login?role=superadmin&redirect=' + encodeURIComponent(window.location.pathname);
        return;
      }
      const data = await res.json();
      if (data.success) {
        if (data.newToken) {
          localStorage.setItem('admin_token', data.newToken);
        }
        let msg = '✅ Pengaturan sistem, WhatsApp, & Telegram Bot berhasil disimpan!';
        if (newSuperPass && newStaffPass) {
          msg = '✅ Pengaturan, Kata Sandi Super Admin & Kata Sandi Staf baru berhasil diperbarui!';
        } else if (newSuperPass) {
          msg = '✅ Pengaturan & Kata Sandi Super Admin baru berhasil diperbarui!';
        } else if (newStaffPass) {
          msg = '✅ Pengaturan & Kata Sandi Staf baru berhasil diperbarui!';
        }
        alert(msg);
        if (adminPasswordInput) adminPasswordInput.value = '';
        if (superAdminPasswordInput) superAdminPasswordInput.value = '';
        if (currentSuperAdminPasswordInput) currentSuperAdminPasswordInput.value = '';
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

