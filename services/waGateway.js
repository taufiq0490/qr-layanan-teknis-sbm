const { readConfig } = require('./storage');

/**
 * Format phone number or WhatsApp group target
 * (e.g. 0812... -> 62812..., but preserve 120363xxx@g.us)
 */
function normalizePhoneNumber(target, defaultCountryCode = '62') {
  if (!target) return '';
  let str = String(target).trim();
  // WhatsApp Group ID format
  if (str.includes('@g.us')) {
    return str;
  }
  // Standard phone number
  let cleaned = str.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = defaultCountryCode + cleaned.substring(1);
  }
  return cleaned;
}

/**
 * Fetch WhatsApp Groups associated with the connected Fonnte device
 */
async function fetchWhatsAppGroups(fonnteToken) {
  if (!fonnteToken) {
    return { success: false, error: 'Token Fonnte belum dikonfigurasi.' };
  }
  try {
    // 1. Sync latest groups from WhatsApp device
    await fetch('https://api.fonnte.com/fetch-group', {
      method: 'POST',
      headers: { 'Authorization': fonnteToken }
    }).catch(() => null);

    // 2. Retrieve the synced groups
    const response = await fetch('https://api.fonnte.com/get-whatsapp-group', {
      method: 'POST',
      headers: {
        'Authorization': fonnteToken
      }
    });
    const data = await response.json();
    if (data.status === true && Array.isArray(data.data)) {
      return { success: true, groups: data.data };
    }
    // Handle when device has no groups registered yet
    if (data.reason && data.reason.toLowerCase().includes('no whatsapp group')) {
      return {
        success: true,
        groups: [],
        message: 'Nomor WhatsApp Anda saat ini belum terdaftar di dalam grup WhatsApp manapun di Fonnte.'
      };
    }
    return { success: false, error: data.reason || data.message || 'Gagal mengambil daftar grup.' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Send WhatsApp notification to all configured staff numbers / group IDs
 */
async function sendClassroomAlert({ room, category, notes, ticketId }) {
  const config = readConfig();
  const waConfig = config.waGateway || {};
  const staffNumbers = waConfig.staffNumbers || [];
  
  // Format message according to user specification:
  // "Mohon bantuan teknis di ruang [Nama Ruangan] SEGERA!"
  let template = config.messageTemplate || "Mohon bantuan teknis di ruang {room} SEGERA!";
  let message = template.replace('{room}', room);

  // Add optional details if category or notes were specified
  let extraDetails = [];
  if (category && category !== 'Umum') {
    extraDetails.push(`📌 Kendala: ${category}`);
  }
  if (notes && notes.trim() !== '') {
    extraDetails.push(`📝 Info Tambahan: ${notes.trim()}`);
  }
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + " WIB";
  const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
  
  const claimBaseUrl = config.claimBaseUrl || "https://qr-layanan-teknis-sbm.vercel.app";
  const claimUrl = `${claimBaseUrl}/claim?ticket=${encodeURIComponent(ticketId)}`;

  let fullMessage = `🚨 *PANGGILAN BANTUAN TEKNIS SBM ITB*\n\n${message}\n`;
  if (extraDetails.length > 0) {
    fullMessage += `\n${extraDetails.join('\n')}\n`;
  }
  fullMessage += `\n🕒 Waktu: ${dateStr}, ${timeStr}\n🆔 ID Tiket: #${ticketId.slice(-6)}\n\n👉 *Klaim Tugas Cepat:* ${claimUrl}`;

  console.log(`[WA Gateway] Sending alert for Room "${room}"...`);

  // If simulation mode or no token is provided
  if (!waConfig.fonnteToken || waConfig.provider === 'simulation' || staffNumbers.length === 0) {
    console.log(`[WA Gateway SIMULATION] Message to be sent:`);
    console.log(`-----------------------------------------------`);
    console.log(fullMessage);
    console.log(`-----------------------------------------------`);
    console.log(`[WA Gateway SIMULATION] Staff targets:`, staffNumbers.length > 0 ? staffNumbers : ['(No staff numbers configured yet - please set in /admin/settings)']);
    
    return {
      success: true,
      mode: 'simulation',
      message: 'Simulasi pesan berhasil (Token Fonnte belum dikonfigurasi).',
      dispatchedText: fullMessage,
      recipients: staffNumbers
    };
  }

  // Fonnte Provider
  if (waConfig.provider === 'fonnte') {
    try {
      const normalizedTargets = staffNumbers
        .map(num => normalizePhoneNumber(num, waConfig.countryCode || '62'))
        .filter(Boolean)
        .join(',');

      if (!normalizedTargets) {
        return {
          success: false,
          error: 'Tidak ada nomor WhatsApp atau ID Grup yang valid terdaftar.'
        };
      }

      const response = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: {
          'Authorization': waConfig.fonnteToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          target: normalizedTargets,
          message: fullMessage,
          countryCode: waConfig.countryCode || '62'
        })
      });

      const data = await response.json();
      console.log('[WA Gateway Fonnte Response]:', data);

      if (data.status === true || data.status === 'success' || data.status === 200) {
        return {
          success: true,
          provider: 'fonnte',
          data,
          dispatchedText: fullMessage
        };
      } else {
        return {
          success: false,
          provider: 'fonnte',
          error: data.reason || data.message || 'Gagal mengirim pesan via Fonnte',
          data
        };
      }
    } catch (err) {
      console.error('[WA Gateway Fonnte Error]:', err);
      return {
        success: false,
        provider: 'fonnte',
        error: err.message
      };
    }
  }

  // Generic Webhook Provider
  if (waConfig.provider === 'generic_webhook' && waConfig.webhookUrl) {
    try {
      const response = await fetch(waConfig.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room,
          category,
          notes,
          ticketId,
          message: fullMessage,
          staffNumbers
        })
      });
      const data = await response.json().catch(() => ({ status: 'ok' }));
      return {
        success: true,
        provider: 'generic_webhook',
        data
      };
    } catch (err) {
      return {
        success: false,
        provider: 'generic_webhook',
        error: err.message
      };
    }
  }

  return {
    success: true,
    mode: 'unsupported_or_fallback',
    message: 'Alert dicatat di sistem.'
  };
}

module.exports = {
  sendClassroomAlert,
  normalizePhoneNumber,
  fetchWhatsAppGroups
};
