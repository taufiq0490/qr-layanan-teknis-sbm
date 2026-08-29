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

document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('qrCardsContainer');
  const baseUrlInput = document.getElementById('baseUrlInput');
  const btnUpdateQr = document.getElementById('btnUpdateQr');
  const roomSelectFilter = document.getElementById('roomSelectFilter');
  const formatSelect = document.getElementById('formatSelect');
  const btnPrintCurrentView = document.getElementById('btnPrintCurrentView');
  const btnDirectOpenUrl = document.getElementById('btnDirectOpenUrl');

  let roomsList = [];

  try {
    const res = await fetch('/api/info');
    const data = await res.json();
    roomsList = data.rooms || [
      "Henk Uno",
      "Kirana Megatara 1",
      "Kirana Megatara 2",
      "Noni Purnomo",
      "Medco",
      "12A Room"
    ];

    // Jika tunnel publik aktif, otomatis prioritaskan URL publik Cloudflare
    if (data.publicTunnelUrl) {
      baseUrlInput.value = data.publicTunnelUrl;
    } else if (window.location.origin && window.location.origin !== 'null') {
      baseUrlInput.value = window.location.origin;
    } else if (data.localIp && data.localIp !== 'localhost') {
      baseUrlInput.value = `http://${data.localIp}:${data.port || 3000}`;
    } else {
      baseUrlInput.value = 'http://localhost:3000';
    }
  } catch (err) {
    console.error('Error fetching info:', err);
    roomsList = ["Henk Uno", "Kirana Megatara 1", "Kirana Megatara 2", "Noni Purnomo", "Medco", "12A Room"];
    baseUrlInput.value = window.location.origin || 'http://localhost:3000';
  }

  // Populate Dropdown
  roomsList.forEach(room => {
    const opt = document.createElement('option');
    opt.value = room;
    opt.textContent = `📍 Ruang ${room}`;
    roomSelectFilter.appendChild(opt);
  });

  // Update direct link button
  function updateDirectLink() {
    let url = baseUrlInput.value.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    if (btnDirectOpenUrl) {
      btnDirectOpenUrl.href = url;
    }
  }

  // Format Switcher Handler
  function updateFormatClass() {
    const selectedFormat = formatSelect ? formatSelect.value : 'standard';
    document.body.classList.remove('format-standee', 'format-compact');
    if (selectedFormat === 'standee') {
      document.body.classList.add('format-standee');
    } else if (selectedFormat === 'compact') {
      document.body.classList.add('format-compact');
    }
  }

  // Initial render
  updateDirectLink();
  updateFormatClass();
  renderCards();

  // Listeners
  btnUpdateQr.addEventListener('click', () => {
    updateDirectLink();
    renderCards();
  });
  baseUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      updateDirectLink();
      renderCards();
    }
  });
  baseUrlInput.addEventListener('input', updateDirectLink);
  roomSelectFilter.addEventListener('change', renderCards);
  if (formatSelect) {
    formatSelect.addEventListener('change', () => {
      updateFormatClass();
    });
  }

  btnPrintCurrentView.addEventListener('click', () => {
    window.ensureSuperAdmin({
      title: 'Otorisasi Cetak Kartu QR Kelas',
      desc: 'Pencetakan kartu QR kelas dilindungi. Masukkan kata sandi Super Admin untuk melanjutkan.',
      onSuccess: () => {
        window.print();
      }
    });
  });

  window.onafterprint = () => {
    document.body.classList.remove('print-single-mode');
    document.querySelectorAll('.qr-card-design').forEach(card => card.classList.remove('print-target-card'));
  };

  function renderCards() {
    container.innerHTML = '';
    const selectedFilter = roomSelectFilter.value;
    const baseUrl = baseUrlInput.value.trim();
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');

    let filteredRooms = roomsList;
    if (selectedFilter !== 'ALL') {
      filteredRooms = roomsList.filter(r => r === selectedFilter);
    }

    filteredRooms.forEach((room, idx) => {
      const cardEl = document.createElement('div');
      cardEl.className = 'qr-card-design';
      cardEl.id = `card-room-${idx}`;
      
      const callUrl = `${cleanBaseUrl}/call?room=${encodeURIComponent(room)}`;
      const qrElementId = `qr-canvas-${idx}`;

      cardEl.innerHTML = `
        <!-- 1. TOP HIGH-VISIBILITY BANNER -->
        <div class="qr-top-highlight-badge">
          <span class="pulse-dot"></span>
          🚨 BANTUAN LAYANAN TEKNIS KELAS
          <span class="pulse-dot"></span>
        </div>

        <!-- 2. BRANDING SBM ITB -->
        <div class="qr-brand-container">
          <img src="/images/logo-sbm-itb.png" alt="SBM ITB Logo" class="qr-brand-logo">
        </div>
        <div class="qr-header-subtitle">SEKOLAH BISNIS DAN MANAJEMEN</div>
        <div class="qr-header-title">INSTITUT TEKNOLOGI BANDUNG</div>
        <div class="qr-header-campus">KAMPUS JAKARTA</div>

        <!-- 3. COMPACT ROOM PILL (DIPERKECIL) -->
        <div class="qr-room-banner">
          <span style="font-size: 0.95rem;">📍</span>
          <span class="qr-room-name">RUANG ${escapeHTML(room.toUpperCase())}</span>
        </div>

        <!-- 4. QR CODE VIEWFINDER / SCANNER FRAME -->
        <div class="qr-scanner-frame">
          <div class="corner-tr"></div>
          <div class="corner-bl"></div>
          <div id="${qrElementId}"></div>
          <div class="qr-scan-instruction">
            📱 ARAHKAN KAMERA HP KE QR
          </div>
          <div class="qr-scan-subtext">
            Buka Kamera / Google Lens • Tanpa Install Aplikasi
          </div>
        </div>

        <!-- 5. HIGHLIGHTED ISSUE CATEGORIES GRID (4 KATEGORI) -->
        <div class="qr-issues-grid">
          <div class="qr-issue-pill">
            <span class="icon">🖥️</span>
            <span>SmartBoard/Projector</span>
          </div>
          <div class="qr-issue-pill">
            <span class="icon">🎤</span>
            <span>Mic & Audio</span>
          </div>
          <div class="qr-issue-pill">
            <span class="icon">⚡</span>
            <span>Listrik</span>
          </div>
          <div class="qr-issue-pill">
            <span class="icon">🛠️</span>
            <span>Bantuan Lain</span>
          </div>
        </div>

        <!-- 6. 3-STEP QUICK WORKFLOW GUIDE -->
        <div class="qr-steps-container">
          <div class="qr-step-item">
            <span class="qr-step-num">1</span>
            <span>Scan QR</span>
          </div>
          <span class="qr-step-arrow">➔</span>
          <div class="qr-step-item">
            <span class="qr-step-num">2</span>
            <span>Pilih Kendala</span>
          </div>
          <span class="qr-step-arrow">➔</span>
          <div class="qr-step-item">
            <span class="qr-step-num">3</span>
            <span>Teknisi Tiba</span>
          </div>
        </div>

        <!-- Standee fold line for desk tent mode -->
        <div class="standee-fold-line"></div>

        <!-- 7. FOOTER SLA & RESPONSE TIME ASSURANCE -->
        <div class="qr-card-footer">
          <div class="qr-footer-sla">
            ⚡ Respon Cepat 1 - 3 Menit Langsung ke Ruangan Ini
          </div>
          <div class="qr-footer-team">
            Tim Operasional & Dukungan Teknis Perkuliahan • SBM ITB Kampus Jakarta
          </div>
        </div>

        <!-- 8. PER-ROOM PRINT & DOWNLOAD ACTIONS -->
        <div class="qr-card-actions no-print">
          <button class="btn-card-action btn-action-primary" onclick="printSingleRoom('${cardEl.id}')" title="Cetak halaman PDF khusus ruangan ini">
            🖨️ Cetak Ruang Ini
          </button>
          <button class="btn-card-action" onclick="downloadCardPoster('${cardEl.id}', '${escapeHTML(room)}')" title="Download kartu lengkap sebagai gambar PNG">
            🖼️ Download Poster
          </button>
          <button class="btn-card-action" onclick="downloadQrImage('${qrElementId}', '${escapeHTML(room)}')" title="Download QR code saja">
            📥 Download QR
          </button>
        </div>
      `;

      container.appendChild(cardEl);

      // Generate QR Code with High Error Correction
      new QRCode(qrElementId, {
        text: callUrl,
        width: 175,
        height: 175,
        colorDark: "#0F2C59",
        colorLight: "#FFFFFF",
        correctLevel: QRCode.CorrectLevel.H
      });

      // Draw SBM ITB logo emblem in the center of QR code
      drawSbmLogoOnQr(qrElementId);
    });
  }

  // Draw SBM ITB logo in center of QR
  function drawSbmLogoOnQr(qrElementId) {
    setTimeout(() => {
      const qrBox = document.getElementById(qrElementId);
      if (!qrBox) return;
      const canvas = qrBox.querySelector('canvas');
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;
      
      // Logo size: ~28% of QR code width (within 30% Error Correction budget)
      const logoSize = Math.floor(width * 0.28);
      const x = (width - logoSize) / 2;
      const y = (height - logoSize) / 2;
      const radius = 6;

      // 1. White border container with soft drop shadow
      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1;
      drawRoundedRect(ctx, x - 4, y - 4, logoSize + 8, logoSize + 8, radius + 2);
      ctx.fill();
      ctx.restore();

      // 2. Inner SBM Navy Blue background
      ctx.fillStyle = '#0F2C59';
      drawRoundedRect(ctx, x, y, logoSize, logoSize, radius);
      ctx.fill();

      // 3. Gold accent border
      ctx.strokeStyle = '#DDA74F';
      ctx.lineWidth = 1.5;
      drawRoundedRect(ctx, x, y, logoSize, logoSize, radius);
      ctx.stroke();

      // 4. "SBM" typography
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${Math.round(logoSize * 0.34)}px "Segoe UI", Montserrat, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SBM', width / 2, y + (logoSize * 0.36));

      // 5. "ITB" typography (Gold)
      ctx.fillStyle = '#DDA74F';
      ctx.font = `bold ${Math.round(logoSize * 0.24)}px "Segoe UI", Montserrat, Arial, sans-serif`;
      ctx.fillText('ITB', width / 2, y + (logoSize * 0.72));

      // Update <img> tag if generated by qrcode.js for seamless print & save
      const img = qrBox.querySelector('img');
      if (img) {
        img.src = canvas.toDataURL('image/png');
      }
    }, 120);
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  // --- ACTIONS & EXPORTS ---

  // 1. Print Single Room
  window.printSingleRoom = (cardElementId) => {
    window.ensureSuperAdmin({
      title: 'Otorisasi Cetak Kartu QR Ruangan',
      desc: 'Pencetakan kartu QR kelas dilindungi. Masukkan kata sandi Super Admin untuk melanjutkan.',
      onSuccess: () => {
        document.body.classList.add('print-single-mode');
        document.querySelectorAll('.qr-card-design').forEach(card => card.classList.remove('print-target-card'));
        const targetCard = document.getElementById(cardElementId);
        if (targetCard) {
          targetCard.classList.add('print-target-card');
          setTimeout(() => {
            window.print();
          }, 100);
        }
      }
    });
  };

  // 2. Download Raw QR Code Image
  window.downloadQrImage = (canvasContainerId, roomName) => {
    window.ensureSuperAdmin({
      title: 'Otorisasi Download QR Ruangan',
      desc: 'Pengunduhan file gambar QR code dilindungi. Masukkan kata sandi Super Admin untuk melanjutkan.',
      onSuccess: () => {
        const containerEl = document.getElementById(canvasContainerId);
        const canvas = containerEl ? containerEl.querySelector('canvas') : null;
        if (canvas) {
          const link = document.createElement('a');
          link.download = `QR_Bantuan_Teknis_${roomName.replace(/\s+/g, '_')}.png`;
          link.href = canvas.toDataURL('image/png');
          link.click();
        } else {
          alert('Gagal mendownload gambar QR.');
        }
      }
    });
  };

  // 3. Download Entire Poster/Card as High-Res PNG Image
  window.downloadCardPoster = (cardElementId, roomName) => {
    window.ensureSuperAdmin({
      title: 'Otorisasi Download Poster Kartu QR',
      desc: 'Pengunduhan poster kartu QR dilindungi. Masukkan kata sandi Super Admin untuk melanjutkan.',
      onSuccess: async () => {
        const cardEl = document.getElementById(cardElementId);
        if (!cardEl) return;

        if (typeof html2canvas === 'undefined') {
          // Fallback to QR only if html2canvas not loaded
          window.downloadQrImage(cardEl.querySelector('.qr-scanner-frame div[id^="qr-canvas"]').id, roomName);
          return;
        }

        const actionsEl = cardEl.querySelector('.qr-card-actions');
        if (actionsEl) actionsEl.style.display = 'none';

        try {
          const canvas = await html2canvas(cardEl, {
            scale: 2.5, // Ultra-sharp 300 DPI equivalent export
            useCORS: true,
            backgroundColor: '#FFFFFF',
            logging: false
          });

          const link = document.createElement('a');
          link.download = `Poster_Bantuan_Teknis_Kelas_${roomName.replace(/\s+/g, '_')}.png`;
          link.href = canvas.toDataURL('image/png');
          link.click();
        } catch (err) {
          console.error('Error generating card poster image:', err);
          alert('Terjadi kendala saat generate gambar poster. Silakan gunakan fungsi Cetak PDF.');
        } finally {
          if (actionsEl) actionsEl.style.display = 'flex';
        }
      }
    });
  };
});
