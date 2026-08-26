const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const {
  readConfig,
  saveConfig,
  readTickets,
  saveTickets,
  getTicketById,
  createTicket,
  updateTicketStatus,
  updateTicketWaStatus,
  clearAllTickets,
  sanitizeString
} = require('./services/storage');
const { sendClassroomAlert } = require('./services/waGateway');

const app = express();
const PORT = process.env.PORT || 3000;

// Simple cookie parser helper
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (!rc) return list;
  rc.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts.shift().trim();
    const value = decodeURIComponent(parts.join('='));
    list[key] = value;
  });
  return list;
}

// In-Memory Active Admin Sessions (token -> expiry)
const activeSessions = new Map();
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- RATE LIMITING MIDDLEWARE ---
// Limit: max 3 calls per 2 minutes (120,000 ms) per IP & Room
const callHistory = new Map(); // key -> array of timestamps
const RATE_LIMIT_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const MAX_CALLS_PER_WINDOW = 3;

function callRateLimiter(req, res, next) {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const room = (req.body && req.body.room) ? req.body.room.trim().toLowerCase() : 'unknown';
  const key = `${clientIp}_${room}`;
  const now = Date.now();

  let timestamps = callHistory.get(key) || [];
  // Filter out timestamps outside current window
  timestamps = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

  if (timestamps.length >= MAX_CALLS_PER_WINDOW) {
    const oldest = timestamps[0];
    const waitSeconds = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000);
    return res.status(429).json({
      success: false,
      error: `Batas panggilan tercapai: Maksimal ${MAX_CALLS_PER_WINDOW} kali panggilan per 2 menit. Silakan tunggu ${waitSeconds} detik lagi sebelum memanggil kembali.`,
      retryAfterSeconds: waitSeconds
    });
  }

  timestamps.push(now);
  callHistory.set(key, timestamps);
  next();
}

// --- ADMIN AUTHENTICATION HELPERS & MIDDLEWARE ---
function isValidAdminSession(req) {
  const cookies = parseCookies(req);
  const token = req.headers['x-admin-token'] || req.headers['authorization']?.replace('Bearer ', '') || cookies.admin_session;
  if (!token) return false;

  const sessionExp = activeSessions.get(token);
  if (!sessionExp) return false;

  if (Date.now() > sessionExp) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

function requireAdminAuthAPI(req, res, next) {
  if (isValidAdminSession(req)) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'Akses ditolak. Sesi login admin telah berakhir atau tidak valid.' });
}

function requireAdminAuthPage(req, res, next) {
  if (isValidAdminSession(req)) {
    return next();
  }
  const redirectUrl = encodeURIComponent(req.originalUrl || '/admin');
  return res.redirect(`/login?redirect=${redirectUrl}`);
}

// Helper to mask sensitive token
function maskToken(token) {
  if (!token || typeof token !== 'string') return '';
  if (token.length <= 4) return '****';
  return token.slice(0, 4) + '••••••••••••';
}

// Static Assets (Served after auth checks for protected pages)
app.use(express.static(path.join(__dirname, 'public')));

// Network info
const os = require('os');
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

let publicTunnelUrl = null;

// --- AUTH API ROUTES ---

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const config = readConfig();
  const validPassword = process.env.ADMIN_PASSWORD || config.adminPassword || 'admin';

  if (password === validPassword) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + SESSION_DURATION_MS;
    activeSessions.set(token, expiry);

    // Set cookie for browser navigation
    res.setHeader('Set-Cookie', `admin_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
    return res.json({ success: true, message: 'Login berhasil!', token });
  }

  return res.status(401).json({ success: false, error: 'Kata sandi salah.' });
});

// Admin Logout
app.post('/api/admin/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = req.headers['x-admin-token'] || cookies.admin_session;
  if (token) {
    activeSessions.delete(token);
  }
  res.setHeader('Set-Cookie', `admin_session=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ success: true, message: 'Berhasil logout.' });
});

// Check Admin Auth Status
app.get('/api/admin/check-auth', (req, res) => {
  const authenticated = isValidAdminSession(req);
  res.json({ success: true, authenticated });
});

// 1. Get Public App Info & Rooms
app.get('/api/info', (req, res) => {
  const config = readConfig();
  const localIp = getLocalIp();
  res.json({
    appTitle: config.appTitle || "Layanan Bantuan Teknis SBM ITB Jakarta",
    localIp,
    publicTunnelUrl,
    port: PORT,
    rooms: config.rooms || [
      "Henk Uno",
      "Kirana Megatara 1",
      "Kirana Megatara 2",
      "Noni Purnomo",
      "Medco",
      "12A Room"
    ]
  });
});

// Set active public tunnel URL (from launcher script)
app.post('/api/tunnel-url', (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  // Allow only localhost or if authenticated
  if (clientIp !== '127.0.0.1' && clientIp !== '::1' && !isValidAdminSession(req)) {
    return res.status(403).json({ success: false, error: 'Akses terbatas ke localhost.' });
  }
  const { url } = req.body;
  if (url) {
    publicTunnelUrl = url;
    console.log(`🌐 Public Tunnel URL Updated: ${publicTunnelUrl}`);
  }
  res.json({ success: true, publicTunnelUrl });
});

// 2. Trigger Technical Call from Room (Protected with Rate Limit)
app.post('/api/call', callRateLimiter, async (req, res) => {
  try {
    const { room, category, notes } = req.body;
    
    if (!room) {
      return res.status(400).json({ success: false, error: 'Nama ruangan wajib diisi.' });
    }

    const safeRoom = sanitizeString(room);
    const safeCategory = sanitizeString(category) || 'Umum';
    const safeNotes = sanitizeString(notes) || '';
    
    // Create new ticket record
    const ticket = createTicket(safeRoom, safeCategory, safeNotes);

    // Send WhatsApp notification
    const waResult = await sendClassroomAlert({
      room: safeRoom,
      category: safeCategory,
      notes: safeNotes,
      ticketId: ticket.id
    });

    // Update ticket with WA dispatch result
    updateTicketWaStatus(ticket.id, {
      sent: waResult.success,
      provider: waResult.provider || waResult.mode || 'unknown',
      timestamp: new Date().toISOString(),
      details: waResult
    });

    res.json({
      success: true,
      message: `Panggilan bantuan untuk ruang ${safeRoom} telah diterima dan diteruskan ke tim staf support.`,
      ticket: {
        id: ticket.id,
        room: ticket.room,
        category: ticket.category,
        notes: ticket.notes,
        createdAt: ticket.createdAt,
        status: ticket.status,
        handledBy: ticket.handledBy || ""
      },
      waDispatch: {
        success: waResult.success,
        mode: waResult.mode || waResult.provider
      }
    });
  } catch (error) {
    console.error('Error handling /api/call:', error);
    res.status(500).json({ success: false, error: error.message || 'Terjadi kesalahan sistem' });
  }
});

// 3. Public Ticket Status (for Live Tracking on HP Dosen/Caller)
app.get('/api/tickets/:id', (req, res) => {
  const { id } = req.params;
  const ticket = getTicketById(id);
  if (!ticket) {
    return res.status(404).json({ success: false, error: 'Tiket tidak ditemukan.' });
  }
  // Return safe sanitized public status
  res.json({
    success: true,
    ticket: {
      id: ticket.id,
      room: ticket.room,
      category: ticket.category,
      notes: ticket.notes,
      status: ticket.status,
      handledBy: ticket.handledBy || "",
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt
    }
  });
});

// 3.1 Quick Claim Ticket by Support Staff (via WhatsApp Quick Action Link)
app.post('/api/tickets/:id/claim', (req, res) => {
  const { id } = req.params;
  const { staffName } = req.body;

  if (!staffName || !staffName.trim()) {
    return res.status(400).json({ success: false, error: 'Nama staf support wajib diisi.' });
  }

  const safeStaffName = sanitizeString(staffName.trim());
  const updatedTicket = updateTicketStatus(id, 'Diproses', safeStaffName);

  if (!updatedTicket) {
    return res.status(404).json({ success: false, error: 'Tiket tidak ditemukan.' });
  }

  res.json({
    success: true,
    message: `Tiket berhasil diambil oleh ${safeStaffName}. Status diubah menjadi "Diproses".`,
    ticket: updatedTicket
  });
});

// 3.2 Quick Complete Ticket by Support Staff
app.post('/api/tickets/:id/complete', (req, res) => {
  const { id } = req.params;
  const { staffName } = req.body;
  const safeStaffName = staffName ? sanitizeString(staffName.trim()) : undefined;

  const updatedTicket = updateTicketStatus(id, 'Selesai', safeStaffName);
  if (!updatedTicket) {
    return res.status(404).json({ success: false, error: 'Tiket tidak ditemukan.' });
  }

  res.json({
    success: true,
    message: 'Tiket berhasil diselesaikan.',
    ticket: updatedTicket
  });
});

// 4. Get Tickets (Admin / Monitoring - Protected)
app.get('/api/tickets', requireAdminAuthAPI, (req, res) => {
  const { status, limit } = req.query;
  let tickets = readTickets();

  if (status && status !== 'all') {
    tickets = tickets.filter(t => t.status.toLowerCase() === status.toLowerCase());
  }

  if (limit) {
    tickets = tickets.slice(0, parseInt(limit, 10));
  }

  res.json({ success: true, tickets });
});

// 5. Update Ticket Status (Admin - Protected)
app.patch('/api/tickets/:id/status', requireAdminAuthAPI, (req, res) => {
  const { id } = req.params;
  const { status, handledBy } = req.body;

  if (!['Menunggu', 'Diproses', 'Selesai', 'Dibatalkan'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Status tidak valid' });
  }

  const updatedTicket = updateTicketStatus(id, status, handledBy);
  if (!updatedTicket) {
    return res.status(404).json({ success: false, error: 'Tiket tidak ditemukan' });
  }

  res.json({ success: true, ticket: updatedTicket });
});

// 5.1 Clear all tickets (Admin - Protected)
app.post('/api/admin/clear-tickets', requireAdminAuthAPI, (req, res) => {
  try {
    clearAllTickets();
    res.json({ success: true, message: 'Seluruh riwayat tiket berhasil dikosongkan.' });
  } catch (err) {
    console.error('Error clearing tickets:', err);
    res.status(500).json({ success: false, error: 'Gagal mengosongkan riwayat tiket.' });
  }
});

// 6. Get Settings (Admin - Protected with MASKED TOKEN)
app.get('/api/admin/settings', requireAdminAuthAPI, (req, res) => {
  const config = readConfig();
  const rawToken = (config.waGateway && config.waGateway.fonnteToken) || '';
  
  res.json({
    success: true,
    settings: {
      appTitle: config.appTitle,
      rooms: config.rooms,
      messageTemplate: config.messageTemplate,
      claimBaseUrl: config.claimBaseUrl || "https://qr-layanan-teknis-sbm.vercel.app",
      waGateway: {
        provider: config.waGateway?.provider || 'fonnte',
        fonnteToken: maskToken(rawToken),
        hasToken: Boolean(rawToken),
        staffNumbers: config.waGateway?.staffNumbers || [],
        countryCode: config.waGateway?.countryCode || '62',
        webhookUrl: config.waGateway?.webhookUrl || ''
      }
    }
  });
});

// 7. Save Settings (Admin - Protected with SAFE TOKEN PRESERVATION)
app.post('/api/admin/settings', requireAdminAuthAPI, (req, res) => {
  const { appTitle, rooms, messageTemplate, claimBaseUrl, waGateway, adminPassword } = req.body;
  const currentConfig = readConfig();

  // If token is masked or not provided, preserve existing token
  let tokenToSave = currentConfig.waGateway?.fonnteToken || '';
  if (waGateway && typeof waGateway.fonnteToken === 'string') {
    const inputToken = waGateway.fonnteToken.trim();
    if (inputToken && !inputToken.includes('••••') && !inputToken.includes('****')) {
      tokenToSave = inputToken;
    }
  }

  const newConfig = {
    ...currentConfig,
    appTitle: appTitle ? sanitizeString(appTitle) : currentConfig.appTitle,
    rooms: Array.isArray(rooms) ? rooms.map(sanitizeString).filter(r => r !== '') : currentConfig.rooms,
    messageTemplate: messageTemplate ? sanitizeString(messageTemplate) : currentConfig.messageTemplate,
    claimBaseUrl: claimBaseUrl ? sanitizeString(claimBaseUrl) : (currentConfig.claimBaseUrl || "https://qr-layanan-teknis-sbm.vercel.app"),
    adminPassword: adminPassword && adminPassword.trim() ? adminPassword.trim() : currentConfig.adminPassword,
    waGateway: {
      ...currentConfig.waGateway,
      provider: waGateway?.provider || currentConfig.waGateway?.provider || 'fonnte',
      fonnteToken: tokenToSave,
      staffNumbers: Array.isArray(waGateway?.staffNumbers) ? waGateway.staffNumbers : currentConfig.waGateway?.staffNumbers,
      countryCode: waGateway?.countryCode || currentConfig.waGateway?.countryCode || '62',
      webhookUrl: waGateway?.webhookUrl || currentConfig.waGateway?.webhookUrl || ''
    }
  };

  const saved = saveConfig(newConfig);
  if (saved) {
    res.json({ success: true, message: 'Pengaturan berhasil disimpan!' });
  } else {
    res.status(500).json({ success: false, error: 'Gagal menyimpan konfigurasi.' });
  }
});

// 8. Test WhatsApp Gateway (Admin - Protected)
app.post('/api/admin/test-wa', requireAdminAuthAPI, async (req, res) => {
  try {
    const testResult = await sendClassroomAlert({
      room: "Ruang Simulasi/Test",
      category: "Uji Coba Sistem",
      notes: "Ini adalah pesan uji coba dari Dashboard Admin SBM ITB",
      ticketId: "TEST-" + Date.now().toString(36).toUpperCase()
    });

    res.json({
      success: testResult.success,
      result: testResult
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- DIRECT UI ROUTES ---
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/claim', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'claim.html'));
});
app.get('/call', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'call.html'));
});

// Protected Admin Web Pages
app.get('/admin', requireAdminAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/admin/print-qr', requireAdminAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'print-qr.html'));
});
app.get('/admin/settings', requireAdminAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});
app.get(['/admin/reports', '/reports'], requireAdminAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reports.html'));
});

// Start Server if run directly
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 SBM ITB QR Layanan Teknis Server Running!`);
    console.log(`📡 Local URL    : http://localhost:${PORT}`);
    console.log(`📱 Call URL     : http://localhost:${PORT}/call?room=Henk%20Uno`);
    console.log(`🔑 Login Admin  : http://localhost:${PORT}/login`);
    console.log(`🛠️  Admin Panel  : http://localhost:${PORT}/admin`);
    console.log(`🖨️  Print QR Card: http://localhost:${PORT}/admin/print-qr`);
    console.log(`📈  Reports      : http://localhost:${PORT}/admin/reports`);
    console.log(`⚙️  WA Settings  : http://localhost:${PORT}/admin/settings`);
    console.log(`=======================================================`);
  });
}

module.exports = app;

