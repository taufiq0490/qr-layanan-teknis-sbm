const { readConfig } = require('./storage');

/**
 * Send Telegram notification to configured Chat IDs / Group IDs
 */
async function sendTelegramAlert({ room, category, notes, ticketId }) {
  const config = readConfig();
  const teleConfig = config.telegramGateway || {};
  const botToken = teleConfig.botToken || '';
  const chatIds = teleConfig.chatIds || [];

  const claimBaseUrl = config.claimBaseUrl || "https://qr-layanan-teknis-sbm.vercel.app";
  const claimUrl = `${claimBaseUrl}/claim?ticket=${encodeURIComponent(ticketId)}`;

  const now = new Date();
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + " WIB";
  const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });

  let template = config.messageTemplate || "Mohon bantuan teknis di ruang {room} SEGERA!";
  let message = template.replace('{room}', `<b>${room}</b>`);

  let extraLines = [];
  if (category && category !== 'Umum') {
    extraLines.push(`📌 <b>Kendala:</b> ${category}`);
  }
  if (notes && notes.trim() !== '') {
    extraLines.push(`📝 <b>Catatan:</b> <i>${notes.trim()}</i>`);
  }

  let formattedText = `🚨 <b>PANGGILAN BANTUAN TEKNIS SBM ITB</b>\n\n`;
  formattedText += `${message}\n`;
  if (extraLines.length > 0) {
    formattedText += `\n${extraLines.join('\n')}\n`;
  }
  formattedText += `\n🕒 <b>Waktu:</b> ${dateStr}, ${timeStr}\n🆔 <b>ID Tiket:</b> <code>#${ticketId.slice(-6)}</code>`;

  // Simulation mode if token is empty
  if (!botToken || teleConfig.enabled === false || chatIds.length === 0) {
    console.log(`[Telegram Gateway SIMULATION] Alert for Room "${room}":`);
    console.log(formattedText);
    return {
      success: true,
      mode: 'simulation',
      message: 'Simulasi Telegram berhasil (Bot Token atau Chat ID belum disetel).',
      dispatchedText: formattedText
    };
  }

  console.log(`[Telegram Gateway] Sending alert for Room "${room}" to ${chatIds.length} target(s)...`);

  const results = [];
  for (const chatId of chatIds) {
    if (!chatId || !chatId.trim()) continue;
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId.trim(),
          text: formattedText,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '🚀 Klaim & Tangani Tiket',
                  url: claimUrl
                }
              ]
            ]
          }
        })
      });

      const data = await response.json();
      results.push({ chatId, success: data.ok, data });
    } catch (err) {
      console.error(`[Telegram Gateway Error for ${chatId}]:`, err);
      results.push({ chatId, success: false, error: err.message });
    }
  }

  const allSuccess = results.some(r => r.success);
  return {
    success: allSuccess,
    provider: 'telegram',
    results
  };
}

/**
 * Send status update to Telegram Group / Chat (e.g. Diproses or Selesai)
 */
async function sendTelegramStatusUpdate({ ticket, newStatus, handledBy }) {
  const config = readConfig();
  const teleConfig = config.telegramGateway || {};
  const botToken = teleConfig.botToken || '';
  const chatIds = teleConfig.chatIds || [];

  if (!botToken || teleConfig.enabled === false || chatIds.length === 0) {
    return { success: true, mode: 'simulation' };
  }

  const now = new Date();
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + " WIB";
  const staffName = handledBy || ticket.handledBy || 'Tim Support';
  const shortId = `#${ticket.id.slice(-6)}`;

  let updateText = '';
  let replyMarkup = null;

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

  if (newStatus === 'Diproses') {
    updateText = `🔵 <b>UPDATE: TIKET SEDANG DIPROSES</b>\n\n` +
      `📍 <b>Ruangan:</b> ${ticket.room}\n` +
      `📌 <b>Kendala:</b> ${ticket.category || 'Umum'}\n` +
      `👤 <b>Petugas:</b> ${staffName} sedang menuju lokasi\n` +
      `🕒 <b>Waktu:</b> ${timeStr}\n` +
      `🆔 <b>ID Tiket:</b> <code>${shortId}</code>`;

    const claimBaseUrl = config.claimBaseUrl || "https://qr-layanan-teknis-sbm.vercel.app";
    replyMarkup = {
      inline_keyboard: [
        [
          {
            text: '✓ Selesaikan Pekerjaan',
            url: `${claimBaseUrl}/claim?ticket=${encodeURIComponent(ticket.id)}`
          }
        ]
      ]
    };
  } else if (newStatus === 'Selesai') {
    const durText = ticket.resolutionTimeSeconds ? formatDuration(ticket.resolutionTimeSeconds) : '-';

    updateText = `🟢 <b>UPDATE: KENDALA SELESAI DITANGANI</b>\n\n` +
      `📍 <b>Ruangan:</b> ${ticket.room}\n` +
      `📌 <b>Kendala:</b> ${ticket.category || 'Umum'}\n` +
      `👤 <b>Petugas:</b> ${staffName}\n` +
      `⏱️ <b>Durasi Pengerjaan:</b> ${durText}\n` +
      `🕒 <b>Waktu Selesai:</b> ${timeStr}\n` +
      `🆔 <b>ID Tiket:</b> <code>${shortId}</code>\n\n` +
      `<i>✨ Pekerjaan telah selesai dilaksanakan.</i>`;
  } else {
    return { success: true };
  }

  const results = [];
  for (const chatId of chatIds) {
    if (!chatId || !chatId.trim()) continue;
    try {
      const payload = {
        chat_id: chatId.trim(),
        text: updateText,
        parse_mode: 'HTML'
      };
      if (replyMarkup) payload.reply_markup = replyMarkup;

      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      results.push({ chatId, success: data.ok, data });
    } catch (err) {
      console.error(`[Telegram Status Update Error for ${chatId}]:`, err);
      results.push({ chatId, success: false, error: err.message });
    }
  }

  return { success: results.some(r => r.success), results };
}

module.exports = {
  sendTelegramAlert,
  sendTelegramStatusUpdate
};
