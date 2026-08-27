const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const {
  readConfig,
  saveConfig,
  readTickets,
  readTicketsAsync,
  saveTickets,
  saveTicketsAsync,
  getTicketById,
  getTicketByIdAsync,
  createTicket,
  createTicketAsync,
  updateTicketStatus,
  updateTicketStatusAsync,
  updateTicketWaStatus,
  updateTicketWaStatusAsync,
  clearAllTickets,
  clearAllTicketsAsync,
  sanitizeString
} = require('./services/storage');
const { sendClassroomAlert, fetchWhatsAppGroups } = require('./services/waGateway');
const { sendTelegramAlert, sendTelegramStatusUpdate } = require('./services/telegramGateway');

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

// Anti-caching middleware for all API endpoints
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// --- REALTIME SERVER-SENT EVENTS (SSE) SYSTEM ---
const sseClients = new Set();

function broadcastRealtimeEvent(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// SSE stream endpoint
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);

  // Initial ping
  res.write(`event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);

  // Heartbeat every 20s
  const keepAlive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch (e) {
      clearInterval(keepAlive);
      sseClients.delete(res);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

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

// --- ADMIN AUTHENTICATION (Stateless Signed Tokens for Vercel Serverless & Local) ---
const AUTH_SECRET = 'SBM_ITB_SESSION_SECRET_KEY_9921_JAKARTA';

function generateAdminToken(role = 'admin') {
  const payload = {
    role: role === 'superadmin' ? 'superadmin' : 'admin',
    exp: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payloadStr).digest('base64url');
  return `${payloadStr}.${signature}`;
}

function getAdminSessionPayload(tokenOrReq) {
  let token = null;
  if (typeof tokenOrReq === 'string') {
    token = tokenOrReq;
  } else if (tokenOrReq && typeof tokenOrReq === 'object') {
    const cookies = parseCookies(tokenOrReq);
    token = tokenOrReq.headers['x-admin-token'] || 
            tokenOrReq.headers['authorization']?.replace('Bearer ', '') || 
            cookies.admin_session;
  }

  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  try {
    const [payloadStr, signature] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payloadStr).digest('base64url');
    if (signature !== expectedSig) return null;

    const payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf-8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function verifyAdminToken(token) {
  return getAdminSessionPayload(token) !== null;
}

function isValidAdminSession(req) {
  const session = getAdminSessionPayload(req);
  return session !== null;
}

function isValidSuperAdminSession(req) {
  const session = getAdminSessionPayload(req);
  return session !== null && session.role === 'superadmin';
}

function requireAdminAuthAPI(req, res, next) {
  if (isValidAdminSession(req)) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'Akses ditolak. Sesi login admin telah berakhir atau tidak valid.' });
}

function requireSuperAdminAuthAPI(req, res, next) {
  // Check if session is already superadmin
  if (isValidSuperAdminSession(req)) {
    return next();
  }

  // Also allow superadmin password in request body or header for on-demand verification
  const config = readConfig();
  const validSuperPass = process.env.SUPER_ADMIN_PASSWORD || config.superAdminPassword || config.adminPassword || 'Bismillah.1';
  const providedPass = req.headers['x-super-admin-password'] || req.body?.superAdminPassword;
  
  if (providedPass && providedPass === validSuperPass) {
    return next();
  }

  return res.status(403).json({ 
    success: false, 
    error: 'Akses ditolak. Tindakan ini memerlukan otorisasi Password Super Admin.',
    requiresSuperAdmin: true 
  });
}

function requireAdminAuthPage(req, res, next) {
  if (isValidAdminSession(req)) {
    return next();
  }
  const redirectUrl = encodeURIComponent(req.originalUrl || '/admin');
  return res.redirect(`/login?redirect=${redirectUrl}`);
}

function requireSuperAdminAuthPage(req, res, next) {
  if (isValidSuperAdminSession(req)) {
    return next();
  }
  const redirectUrl = encodeURIComponent(req.originalUrl || '/admin');
  return res.redirect(`/login?role=superadmin&redirect=${redirectUrl}`);
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

// Geofencing Helper (Haversine Formula)
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

let publicTunnelUrl = null;

// --- AUTH API ROUTES ---

// Admin Login (Supports both Super Admin and Staff Admin passwords)
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password || !password.trim()) {
    return res.status(400).json({ success: false, error: 'Kata sandi wajib diisi.' });
  }

  const cleanPassword = password.trim();
  const config = readConfig();
  const validSuperPassword = (process.env.SUPER_ADMIN_PASSWORD || config.superAdminPassword || 'Bismillah.1').trim();
  const validAdminPassword = (process.env.ADMIN_PASSWORD || config.adminPassword || 'admin').trim();

  if (cleanPassword === validSuperPassword) {
    const token = generateAdminToken('superadmin');
    res.setHeader('Set-Cookie', `admin_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
    return res.json({ 
      success: true, 
      message: 'Login Super Admin berhasil!', 
      token, 
      role: 'superadmin',
      isSuperAdmin: true 
    });
  }

  if (cleanPassword === validAdminPassword) {
    const token = generateAdminToken('admin');
    res.setHeader('Set-Cookie', `admin_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
    return res.json({ 
      success: true, 
      message: 'Login Staf Admin berhasil!', 
      token, 
      role: 'admin',
      isSuperAdmin: false 
    });
  }

  return res.status(401).json({ success: false, error: 'Kata sandi salah.' });
});

// Verify Super Admin Password (for modal unlocks & session promotion)
app.post('/api/admin/verify-superadmin', (req, res) => {
  const { password } = req.body;
  if (!password || !password.trim()) {
    return res.status(400).json({ success: false, error: 'Kata sandi Super Admin wajib diisi.' });
  }

  const cleanPassword = password.trim();
  const config = readConfig();
  const validSuperPassword = (process.env.SUPER_ADMIN_PASSWORD || config.superAdminPassword || config.adminPassword || 'Bismillah.1').trim();

  if (cleanPassword === validSuperPassword) {
    const token = generateAdminToken('superadmin');
    res.setHeader('Set-Cookie', `admin_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
    return res.json({ 
      success: true, 
      message: 'Otorisasi Super Admin berhasil!', 
      token, 
      role: 'superadmin',
      isSuperAdmin: true 
    });
  }

  return res.status(401).json({ success: false, error: 'Kata sandi Super Admin salah.' });
});

// Admin Logout
app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', `admin_session=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ success: true, message: 'Berhasil logout.' });
});

// Check Admin Auth Status & Role
app.get('/api/admin/check-auth', (req, res) => {
  const session = getAdminSessionPayload(req);
  const authenticated = session !== null;
  const isSuperAdmin = session !== null && session.role === 'superadmin';
  const role = session ? session.role : 'guest';
  res.json({ success: true, authenticated, isSuperAdmin, role });
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
    ],
    googleSheetUrl: config.googleSheetUrl || "",
    geofencing: config.geofencing || {
      enabled: true,
      campusName: "SBM ITB Jakarta (Graha Irama)",
      latitude: -6.23933,
      longitude: 106.83228,
      maxRadiusMeters: 250
    }
  });
});

// 1.1 Public Live CSV Data for Google Sheets =IMPORTDATA(...)
app.get('/api/public/reports-csv', async (req, res) => {
  try {
    const tickets = (await readTicketsAsync()) || [];
    const headers = [
      'No',
      'ID Tiket',
      'Tanggal Panggil',
      'Jam Panggil',
      'Waktu Selesai',
      'Durasi Penanganan',
      'Ruangan',
      'Kategori Kendala',
      'Petugas Support',
      'Status Tiket',
      'Catatan Tambahan',
      'Terakhir Diperbarui'
    ];

    function formatDuration(seconds) {
      if (!seconds || seconds <= 0) return '< 1 mnt';
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      if (m === 0) return `${s} dtk`;
      if (m < 60) return s > 0 ? `${m} mnt ${s} dtk` : `${m} mnt`;
      const h = Math.floor(m / 60);
      const remM = m % 60;
      return remM > 0 ? `${h} jam ${remM} mnt` : `${h} jam`;
    }

    const rows = tickets.map((t, idx) => {
      const d = new Date(t.createdAt);
      const dateStr = !isNaN(d) ? d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
      const timeStr = !isNaN(d) ? d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';

      let compTimeStr = '-';
      let durationStr = '-';
      if (t.completedAt) {
        const compD = new Date(t.completedAt);
        compTimeStr = !isNaN(compD) ? compD.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
        durationStr = formatDuration(t.resolutionTimeSeconds);
      }

      const upD = t.updatedAt ? new Date(t.updatedAt) : null;
      const updatedStr = upD && !isNaN(upD) ? upD.toLocaleString('id-ID') : '-';

      return [
        idx + 1,
        `"${t.id || ''}"`,
        `"${dateStr}"`,
        `"${timeStr}"`,
        `"${compTimeStr}"`,
        `"${durationStr}"`,
        `"${(t.room || '').replace(/"/g, '""')}"`,
        `"${(t.category || 'Umum').replace(/"/g, '""')}"`,
        `"${(t.handledBy || '-').replace(/"/g, '""')}"`,
        `"${t.status || ''}"`,
        `"${(t.notes || '').replace(/"/g, '""')}"`,
        `"${updatedStr}"`
      ];
    });

    const csvContent = '\uFEFF' + [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="laporan_layanan_teknis_sbm.csv"');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(csvContent);
  } catch (err) {
    console.error('Error generating public CSV:', err);
    res.status(500).send('Error generating report');
  }
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

// 2.0 Get Remaining Call Quota for Current Room & IP
app.get('/api/call-quota', (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const room = (req.query && req.query.room) ? req.query.room.trim().toLowerCase() : 'unknown';
  const key = `${clientIp}_${room}`;
  const now = Date.now();

  let timestamps = callHistory.get(key) || [];
  timestamps = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  
  const usedCalls = timestamps.length;
  const remainingCalls = Math.max(0, MAX_CALLS_PER_WINDOW - usedCalls);
  let resetInSeconds = 0;
  if (timestamps.length > 0) {
    resetInSeconds = Math.max(0, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - timestamps[0])) / 1000));
  }

  res.json({
    success: true,
    maxCalls: MAX_CALLS_PER_WINDOW,
    windowMinutes: 2,
    usedCalls,
    remainingCalls,
    resetInSeconds
  });
});

// 2. Trigger Technical Call from Room (Protected with Rate Limit & Geofencing)
app.post('/api/call', callRateLimiter, async (req, res) => {
  try {
    const { room, category, notes, latitude, longitude } = req.body;
    
    if (!room) {
      return res.status(400).json({ success: false, error: 'Nama ruangan wajib diisi.' });
    }

    const config = readConfig();
    const geoConfig = config.geofencing || {};

    // Geofencing GPS Verification
    if (geoConfig.enabled !== false) {
      const latNum = parseFloat(latitude);
      const lonNum = parseFloat(longitude);

      if (isNaN(latNum) || isNaN(lonNum)) {
        return res.status(403).json({
          success: false,
          error: 'Izin lokasi (GPS) diperlukan untuk memverifikasi bahwa Anda berada di area kampus SBM ITB Jakarta.'
        });
      }

      const campusLat = geoConfig.latitude || -6.23933;
      const campusLon = geoConfig.longitude || 106.83228;
      const maxRadius = geoConfig.maxRadiusMeters || 250;
      const distance = calculateDistanceMeters(latNum, lonNum, campusLat, campusLon);

      if (distance > maxRadius) {
        const campusName = geoConfig.campusName || 'SBM ITB Jakarta';
        return res.status(403).json({
          success: false,
          error: `Panggilan ditolak: Anda terdeteksi berada di luar area kampus ${campusName} (Jarak terdeteksi: ~${Math.round(distance)} meter, batas: ${maxRadius} meter). Panggilan bantuan darurat hanya dapat digunakan di dalam area ruang kelas kampus.`
        });
      }
    }

    const safeRoom = sanitizeString(room);
    const safeCategory = sanitizeString(category) || 'Umum';
    const safeNotes = sanitizeString(notes) || '';
    
    // Create new ticket record
    const ticket = await createTicketAsync(safeRoom, safeCategory, safeNotes);

    // Broadcast realtime event instantly to all open admin dashboards (0ms delay)
    broadcastRealtimeEvent('new_ticket', { ticket });

    // Send notifications based on configured channel in PARALLEL
    const channel = config.notificationChannel || 'both';
    const dispatchPromises = [];

    if (channel === 'both' || channel === 'fonnte' || channel === 'wa') {
      dispatchPromises.push(
        sendClassroomAlert({
          room: safeRoom,
          category: safeCategory,
          notes: safeNotes,
          ticketId: ticket.id
        }).catch(err => ({ success: false, error: err.message, provider: 'fonnte' }))
      );
    }

    if (channel === 'both' || channel === 'telegram') {
      dispatchPromises.push(
        sendTelegramAlert({
          room: safeRoom,
          category: safeCategory,
          notes: safeNotes,
          ticketId: ticket.id
        }).catch(err => ({ success: false, error: err.message, provider: 'telegram' }))
      );
    }

    // Respond immediately to client caller (0ms lag on HP Dosen)
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
      }
    });

    // Run notifications concurrently in background & update delivery status
    Promise.all(dispatchPromises).then(async (results) => {
      const waRes = results.find(r => r && (r.provider === 'fonnte' || r.mode === 'simulation')) || { success: false };
      const teleRes = results.find(r => r && (r.provider === 'telegram')) || { success: false };
      await updateTicketWaStatusAsync(ticket.id, {
        sent: results.some(r => r && r.success),
        provider: channel,
        timestamp: new Date().toISOString(),
        details: { waResult: waRes, teleResult: teleRes }
      });
    }).catch(e => console.error('Background dispatch error:', e));
  } catch (error) {
    console.error('Error handling /api/call:', error);
    res.status(500).json({ success: false, error: error.message || 'Terjadi kesalahan sistem' });
  }
});

// 3. Public Ticket Status (for Live Tracking on HP Dosen/Caller)
app.get('/api/tickets/:id', async (req, res) => {
  const { id } = req.params;
  const ticket = await getTicketByIdAsync(id);
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
      claimedAt: ticket.claimedAt || null,
      completedAt: ticket.completedAt || null,
      resolutionTimeSeconds: ticket.resolutionTimeSeconds || null,
      updatedAt: ticket.updatedAt
    }
  });
});

// 3.1 Quick Claim Ticket by Support Staff (via WhatsApp/Telegram Quick Action Link)
app.post('/api/tickets/:id/claim', async (req, res) => {
  const { id } = req.params;
  const { staffName } = req.body;

  if (!staffName || !staffName.trim()) {
    return res.status(400).json({ success: false, error: 'Nama staf support wajib diisi.' });
  }

  const safeStaffName = sanitizeString(staffName.trim());
  const updatedTicket = await updateTicketStatusAsync(id, 'Diproses', safeStaffName);

  if (!updatedTicket) {
    return res.status(404).json({ success: false, error: 'Tiket tidak ditemukan.' });
  }

  // Broadcast realtime event instantly to dashboards
  broadcastRealtimeEvent('ticket_updated', { ticket: updatedTicket });

  // Broadcast status update to Telegram group in background
  sendTelegramStatusUpdate({
    ticket: updatedTicket,
    newStatus: 'Diproses',
    handledBy: safeStaffName
  }).catch(e => console.error('Telegram broadcast error:', e));

  res.json({
    success: true,
    message: `Tiket berhasil diambil oleh ${safeStaffName}. Status diubah menjadi "Diproses".`,
    ticket: updatedTicket
  });
});

// 3.2 Quick Complete Ticket by Support Staff
app.post('/api/tickets/:id/complete', async (req, res) => {
  const { id } = req.params;
  const { staffName } = req.body;
  const safeStaffName = staffName ? sanitizeString(staffName.trim()) : undefined;

  const updatedTicket = await updateTicketStatusAsync(id, 'Selesai', safeStaffName);
  if (!updatedTicket) {
    return res.status(404).json({ success: false, error: 'Tiket tidak ditemukan.' });
  }

  // Broadcast realtime event instantly to dashboards
  broadcastRealtimeEvent('ticket_updated', { ticket: updatedTicket });

  // Broadcast completion update to Telegram group in background
  sendTelegramStatusUpdate({
    ticket: updatedTicket,
    newStatus: 'Selesai',
    handledBy: updatedTicket.handledBy
  }).catch(e => console.error('Telegram broadcast error:', e));

  res.json({
    success: true,
    message: 'Tiket berhasil diselesaikan.',
    ticket: updatedTicket
  });
});

// 4. Get Tickets (Admin / Monitoring - Protected)
app.get('/api/tickets', requireAdminAuthAPI, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  const { status, limit } = req.query;
  let tickets = await readTicketsAsync();

  if (status && status !== 'all') {
    tickets = tickets.filter(t => t.status.toLowerCase() === status.toLowerCase());
  }

  if (limit) {
    tickets = tickets.slice(0, parseInt(limit, 10));
  }

  res.json({ success: true, tickets });
});

// 5. Update Ticket Status (Admin - Protected)
app.patch('/api/tickets/:id/status', requireAdminAuthAPI, async (req, res) => {
  const { id } = req.params;
  const { status, handledBy } = req.body;

  if (!['Menunggu', 'Diproses', 'Selesai', 'Dibatalkan'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Status tidak valid' });
  }

  const updatedTicket = await updateTicketStatusAsync(id, status, handledBy);
  if (!updatedTicket) {
    return res.status(404).json({ success: false, error: 'Tiket tidak ditemukan' });
  }

  // Broadcast realtime event instantly to dashboards
  broadcastRealtimeEvent('ticket_updated', { ticket: updatedTicket });

  // Broadcast status update to Telegram group in background
  if (['Diproses', 'Selesai'].includes(status)) {
    sendTelegramStatusUpdate({
      ticket: updatedTicket,
      newStatus: status,
      handledBy: updatedTicket.handledBy
    }).catch(e => console.error('Telegram broadcast error:', e));
  }

  res.json({ success: true, ticket: updatedTicket });
});

// 5.1 Clear all tickets (Super Admin - Protected)
app.post('/api/admin/clear-tickets', requireSuperAdminAuthAPI, async (req, res) => {
  try {
    await clearAllTicketsAsync();
    broadcastRealtimeEvent('tickets_cleared', {});
    res.json({ success: true, message: 'Seluruh riwayat tiket berhasil dikosongkan.' });
  } catch (err) {
    console.error('Error clearing tickets:', err);
    res.status(500).json({ success: false, error: 'Gagal mengosongkan riwayat tiket.' });
  }
});

// 6. Get Settings (Super Admin - Protected with MASKED TOKEN)
app.get('/api/admin/settings', requireSuperAdminAuthAPI, (req, res) => {
  const config = readConfig();
  const rawToken = (config.waGateway && config.waGateway.fonnteToken) || '';
  const rawTeleToken = (config.telegramGateway && config.telegramGateway.botToken) || '';
  
  res.json({
    success: true,
    settings: {
      appTitle: config.appTitle,
      rooms: config.rooms,
      messageTemplate: config.messageTemplate,
      claimBaseUrl: config.claimBaseUrl || "https://qr-layanan-teknis-sbm.vercel.app",
      notificationChannel: config.notificationChannel || 'both',
      waGateway: {
        provider: config.waGateway?.provider || 'fonnte',
        fonnteToken: maskToken(rawToken),
        hasToken: Boolean(rawToken),
        staffNumbers: config.waGateway?.staffNumbers || [],
        countryCode: config.waGateway?.countryCode || '62',
        webhookUrl: config.waGateway?.webhookUrl || ''
      },
      telegramGateway: {
        enabled: config.telegramGateway?.enabled !== false,
        botToken: maskToken(rawTeleToken),
        hasBotToken: Boolean(rawTeleToken),
        chatIds: config.telegramGateway?.chatIds || []
      },
      geofencing: {
        enabled: config.geofencing?.enabled !== false,
        campusName: config.geofencing?.campusName || "SBM ITB Jakarta (Graha Irama)",
        latitude: config.geofencing?.latitude ?? -6.23933,
        longitude: config.geofencing?.longitude ?? 106.83228,
        maxRadiusMeters: config.geofencing?.maxRadiusMeters ?? 250
      },
      googleSheetUrl: config.googleSheetUrl || "",
      hasAdminPassword: Boolean(config.adminPassword),
      hasSuperAdminPassword: Boolean(config.superAdminPassword)
    }
  });
});

// 7. Save Settings (Super Admin - Protected with SAFE TOKEN PRESERVATION & OLD PASSWORD VERIFICATION)
app.post('/api/admin/settings', requireSuperAdminAuthAPI, (req, res) => {
  const { 
    appTitle, 
    rooms, 
    messageTemplate, 
    claimBaseUrl, 
    notificationChannel, 
    waGateway, 
    telegramGateway, 
    currentSuperAdminPassword,
    adminPassword, 
    superAdminPassword, 
    geofencing, 
    googleSheetUrl 
  } = req.body;
  const currentConfig = readConfig();

  const isChangingSuperPass = typeof superAdminPassword === 'string' && superAdminPassword.trim() !== '';
  const isChangingStaffPass = typeof adminPassword === 'string' && adminPassword.trim() !== '';

  // Enforce Old / Current Super Admin Password Verification before allowing password change
  if (isChangingSuperPass || isChangingStaffPass) {
    const validCurrentSuperPass = (process.env.SUPER_ADMIN_PASSWORD || currentConfig.superAdminPassword || currentConfig.adminPassword || 'Bismillah.1').trim();
    const providedOldPass = (currentSuperAdminPassword || '').trim();

    if (!providedOldPass) {
      return res.status(400).json({
        success: false,
        error: 'Kata sandi lama (Super Admin saat ini) wajib diisi untuk mengubah kata sandi.'
      });
    }

    if (providedOldPass !== validCurrentSuperPass) {
      return res.status(400).json({
        success: false,
        error: 'Kata sandi lama (Super Admin saat ini) yang Anda masukkan salah. Perubahan kata sandi ditolak.'
      });
    }
  }

  // If WA token is masked or not provided, preserve existing token
  let tokenToSave = currentConfig.waGateway?.fonnteToken || '';
  if (waGateway && typeof waGateway.fonnteToken === 'string') {
    const inputToken = waGateway.fonnteToken.trim();
    if (inputToken && !inputToken.includes('••••') && !inputToken.includes('****')) {
      tokenToSave = inputToken;
    }
  }

  // If Telegram token is masked or not provided, preserve existing token
  let teleTokenToSave = currentConfig.telegramGateway?.botToken || '';
  if (telegramGateway && typeof telegramGateway.botToken === 'string') {
    const inputTeleToken = telegramGateway.botToken.trim();
    if (inputTeleToken && !inputTeleToken.includes('••••') && !inputTeleToken.includes('****')) {
      teleTokenToSave = inputTeleToken;
    }
  }

  const newConfig = {
    ...currentConfig,
    appTitle: appTitle ? sanitizeString(appTitle) : currentConfig.appTitle,
    rooms: Array.isArray(rooms) ? rooms.map(sanitizeString).filter(r => r !== '') : currentConfig.rooms,
    messageTemplate: messageTemplate ? sanitizeString(messageTemplate) : currentConfig.messageTemplate,
    claimBaseUrl: claimBaseUrl ? sanitizeString(claimBaseUrl) : (currentConfig.claimBaseUrl || "https://qr-layanan-teknis-sbm.vercel.app"),
    googleSheetUrl: typeof googleSheetUrl === 'string' ? googleSheetUrl.trim() : (currentConfig.googleSheetUrl || ""),
    notificationChannel: notificationChannel || currentConfig.notificationChannel || 'both',
    adminPassword: isChangingStaffPass ? adminPassword.trim() : (currentConfig.adminPassword || 'admin'),
    superAdminPassword: isChangingSuperPass ? superAdminPassword.trim() : (currentConfig.superAdminPassword || 'Bismillah.1'),
    waGateway: {
      ...currentConfig.waGateway,
      provider: waGateway?.provider || currentConfig.waGateway?.provider || 'fonnte',
      fonnteToken: tokenToSave,
      staffNumbers: Array.isArray(waGateway?.staffNumbers) ? waGateway.staffNumbers : currentConfig.waGateway?.staffNumbers,
      countryCode: waGateway?.countryCode || currentConfig.waGateway?.countryCode || '62',
      webhookUrl: waGateway?.webhookUrl || currentConfig.waGateway?.webhookUrl || ''
    },
    telegramGateway: {
      enabled: telegramGateway?.enabled !== false,
      botToken: teleTokenToSave,
      chatIds: Array.isArray(telegramGateway?.chatIds) ? telegramGateway.chatIds : (currentConfig.telegramGateway?.chatIds || [])
    },
    geofencing: {
      enabled: geofencing?.enabled !== false,
      campusName: geofencing?.campusName ? sanitizeString(geofencing.campusName) : (currentConfig.geofencing?.campusName || "SBM ITB Jakarta (Graha Irama)"),
      latitude: (typeof geofencing?.latitude === 'number' && !isNaN(geofencing.latitude)) ? geofencing.latitude : (currentConfig.geofencing?.latitude ?? -6.23933),
      longitude: (typeof geofencing?.longitude === 'number' && !isNaN(geofencing.longitude)) ? geofencing.longitude : (currentConfig.geofencing?.longitude ?? 106.83228),
      maxRadiusMeters: (typeof geofencing?.maxRadiusMeters === 'number' && !isNaN(geofencing.maxRadiusMeters)) ? geofencing.maxRadiusMeters : (currentConfig.geofencing?.maxRadiusMeters ?? 250)
    }
  };

  const saved = saveConfig(newConfig);
  if (saved) {
    let newToken = null;
    if (isChangingSuperPass) {
      newToken = generateAdminToken('superadmin');
      res.setHeader('Set-Cookie', `admin_session=${newToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
    }
    res.json({ 
      success: true, 
      message: 'Pengaturan berhasil disimpan!',
      newToken: newToken || undefined 
    });
  } else {
    res.status(500).json({ success: false, error: 'Gagal menyimpan konfigurasi.' });
  }
});

// 7.1 Fetch WhatsApp Groups from Fonnte (Super Admin - Protected)
app.get('/api/admin/wa-groups', requireSuperAdminAuthAPI, async (req, res) => {
  try {
    const config = readConfig();
    const fonnteToken = config.waGateway?.fonnteToken;
    if (!fonnteToken) {
      return res.status(400).json({ success: false, error: 'Token Fonnte belum dikonfigurasi.' });
    }
    const result = await fetchWhatsAppGroups(fonnteToken);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Test WhatsApp Gateway (Super Admin - Protected)
app.post('/api/admin/test-wa', requireSuperAdminAuthAPI, async (req, res) => {
  try {
    const testTicket = createTicket(
      "Ruang Simulasi/Test",
      "Uji Coba Sistem WA",
      "Pesan uji coba WhatsApp dari Dashboard Admin SBM ITB"
    );

    const testResult = await sendClassroomAlert({
      room: testTicket.room,
      category: testTicket.category,
      notes: testTicket.notes,
      ticketId: testTicket.id
    });

    updateTicketWaStatus(testTicket.id, {
      sent: testResult.success,
      provider: 'fonnte',
      timestamp: new Date().toISOString(),
      details: testResult
    });

    res.json({
      success: testResult.success,
      ticketId: testTicket.id,
      result: testResult
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8.1 Test Telegram Gateway (Super Admin - Protected)
app.post('/api/admin/test-telegram', requireSuperAdminAuthAPI, async (req, res) => {
  try {
    const testTicket = createTicket(
      "Ruang Simulasi/Test",
      "Uji Coba Sistem Telegram",
      "Pesan uji coba Telegram Bot dari Dashboard Admin SBM ITB"
    );

    const testResult = await sendTelegramAlert({
      room: testTicket.room,
      category: testTicket.category,
      notes: testTicket.notes,
      ticketId: testTicket.id
    });

    updateTicketWaStatus(testTicket.id, {
      sent: testResult.success,
      provider: 'telegram',
      timestamp: new Date().toISOString(),
      details: testResult
    });

    res.json({
      success: testResult.success,
      ticketId: testTicket.id,
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
app.get('/admin/print-qr', requireSuperAdminAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'print-qr.html'));
});
app.get('/admin/settings', requireSuperAdminAuthPage, (req, res) => {
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

