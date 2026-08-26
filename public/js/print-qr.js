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
  const container = document.getElementById('qrCardsContainer');
  const baseUrlInput = document.getElementById('baseUrlInput');
  const btnUpdateQr = document.getElementById('btnUpdateQr');
  const roomSelectFilter = document.getElementById('roomSelectFilter');
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

  // Initial render
  updateDirectLink();
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

  btnPrintCurrentView.addEventListener('click', () => {
    window.print();
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
        <div>
          <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 6px;">
            <span style="background: #0F2C59; color: #DDA74F; font-weight: 800; font-size: 0.85rem; padding: 4px 10px; border-radius: 6px; border: 1.5px solid #DDA74F; letter-spacing: 0.5px;">🏛️ SBM ITB</span>
          </div>
          <div class="qr-header-subtitle">SEKOLAH BISNIS DAN MANAJEMEN</div>
          <div class="qr-header-title">INSTITUT TEKNOLOGI BANDUNG</div>
          <div style="font-size: 0.75rem; color: #64748B; font-weight: 600;">KAMPUS JAKARTA</div>
        </div>

        <div class="qr-room-tag">
          RUANG ${room.toUpperCase()}
        </div>

        <div class="qr-box">
          <div id="${qrElementId}"></div>
        </div>

        <div>
          <div class="qr-instruction-bold">
            SCAN UNTUK BANTUAN TEKNIS
          </div>
          <div class="qr-features-list">
            Proyektor • Audio / Mic • Suhu AC • Wi-Fi / Listrik
          </div>
          <div class="qr-footer-desc">
            Bantuan darurat kelas • Notifikasi langsung diteruskan ke Staf IT/Support
          </div>
        </div>

        <!-- Per-Room Print & Download Actions -->
        <div class="qr-card-actions no-print">
          <button class="btn-card-action" onclick="printSingleRoom('${cardEl.id}')">
            🖨️ Cetak Ruang Ini
          </button>
          <button class="btn-card-action" onclick="downloadQrImage('${qrElementId}', '${room}')">
            📥 Download QR (PNG)
          </button>
        </div>
      `;

      container.appendChild(cardEl);

      // Generate QR Code with High Error Correction
      new QRCode(qrElementId, {
        text: callUrl,
        width: 180,
        height: 180,
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
    }, 100);
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

  // Global helper functions
  window.printSingleRoom = (cardElementId) => {
    document.body.classList.add('print-single-mode');
    document.querySelectorAll('.qr-card-design').forEach(card => card.classList.remove('print-target-card'));
    const targetCard = document.getElementById(cardElementId);
    if (targetCard) {
      targetCard.classList.add('print-target-card');
      setTimeout(() => {
        window.print();
      }, 100);
    }
  };

  window.downloadQrImage = (canvasContainerId, roomName) => {
    const containerEl = document.getElementById(canvasContainerId);
    const canvas = containerEl ? containerEl.querySelector('canvas') : null;
    if (canvas) {
      const link = document.createElement('a');
      link.download = `QR_Layanan_SBM_ITB_${roomName.replace(/\s+/g, '_')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } else {
      alert('Gagal mendownload gambar QR.');
    }
  };
});
