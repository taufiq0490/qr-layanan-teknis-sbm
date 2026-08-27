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
  if (category) {
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

  const sendPromises = chatIds
    .filter(chatId => chatId && typeof chatId === 'string' && chatId.trim() !== '')
    .map(async (chatId) => {
      try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(6000), // 6 seconds timeout
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
        return { chatId, success: data.ok, data };
      } catch (err) {
        console.error(`[Telegram Gateway Error for ${chatId}]:`, err.message);
        return { chatId, success: false, error: err.message };
      }
    });

  const results = await Promise.all(sendPromises);
  const allSuccess = results.some(r => r.success);

  const telegramMessages = results
    .filter(r => r.success && r.data && r.data.result && r.data.result.message_id)
    .map(r => ({
      chatId: String(r.data.result.chat?.id || r.chatId),
      messageId: r.data.result.message_id
    }));

  return {
    success: allSuccess,
    provider: 'telegram',
    telegramMessages,
    results
  };
}

/**
 * Delete previously dispatched Telegram messages for a ticket (Opsi 1 - Auto Clean)
 */
async function deleteTelegramMessages(ticket) {
  const config = readConfig();
  const teleConfig = config.telegramGateway || {};
  const botToken = teleConfig.botToken || '';
  if (!botToken || !ticket || !Array.isArray(ticket.telegramMessages) || ticket.telegramMessages.length === 0) {
    return { success: true, count: 0 };
  }

  console.log(`[Telegram Gateway] Deleting ${ticket.telegramMessages.length} message(s) for Ticket #${ticket.id.slice(-6)}...`);

  const deletePromises = ticket.telegramMessages.map(async (msg) => {
    if (!msg || !msg.chatId || !msg.messageId) return { success: false };
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          chat_id: String(msg.chatId).trim(),
          message_id: msg.messageId
        })
      });
      const data = await res.json();
      console.log(`[Telegram deleteMessage] Deleted message ID ${msg.messageId} from chat ${msg.chatId}: ${data.ok ? 'OK' : data.description}`);
      return { chatId: msg.chatId, messageId: msg.messageId, success: data.ok, data };
    } catch (e) {
      console.warn(`[Telegram deleteMessage error for ${msg.chatId}#${msg.messageId}]:`, e.message);
      return { chatId: msg.chatId, messageId: msg.messageId, success: false, error: e.message };
    }
  });

  const results = await Promise.all(deletePromises);
  return { success: results.some(r => r.success), results };
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

  // Opsi 1: Jika tiket SELESAI, otomatis HAPUS semua pesan panggilan tiket ini dari grup Telegram!
  if (newStatus === 'Selesai') {
    const delResult = await deleteTelegramMessages(ticket);
    return { success: true, deleted: true, delResult };
  }

  const now = new Date();
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + " WIB";
  const staffName = handledBy || ticket.handledBy || 'Tim Support';
  const shortId = `#${ticket.id.slice(-6)}`;

  let updateText = '';
  let replyMarkup = null;

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
  } else {
    return { success: true };
  }

  const sendPromises = chatIds
    .filter(chatId => chatId && typeof chatId === 'string' && chatId.trim() !== '')
    .map(async (chatId) => {
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
          signal: AbortSignal.timeout(6000),
          body: JSON.stringify(payload)
        });
        const data = await response.json();
        return { chatId, success: data.ok, data };
      } catch (err) {
        console.error(`[Telegram Status Update Error for ${chatId}]:`, err.message);
        return { chatId, success: false, error: err.message };
      }
    });

  const results = await Promise.all(sendPromises);
  const telegramMessages = results
    .filter(r => r.success && r.data && r.data.result && r.data.result.message_id)
    .map(r => ({
      chatId: String(r.data.result.chat?.id || r.chatId),
      messageId: r.data.result.message_id
    }));

  return { success: results.some(r => r.success), telegramMessages, results };
}

module.exports = {
  sendTelegramAlert,
  sendTelegramStatusUpdate,
  deleteTelegramMessages
};
