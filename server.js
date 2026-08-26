const express = require('express');
const cors = require('cors');
const path = require('path');
const {
  readConfig,
  saveConfig,
  readTickets,
  createTicket,
  updateTicketStatus,
  updateTicketWaStatus
} = require('./services/storage');
const { sendClassroomAlert } = require('./services/waGateway');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

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
  const { url } = req.body;
  if (url) {
    publicTunnelUrl = url;
    console.log(`🌐 Public Tunnel URL Updated: ${publicTunnelUrl}`);
  }
  res.json({ success: true, publicTunnelUrl });
});

// 2. Trigger Technical Call from Room (Called when Dosen/Mahasiswa clicks button)
app.post('/api/call', async (req, res) => {
  try {
    const { room, category, notes } = req.body;
    
    if (!room) {
      return res.status(400).json({ success: false, error: 'Nama ruangan wajib diisi.' });
    }

    const config = readConfig();
    const validRooms = config.rooms || [];
    
    // Create new ticket record
    const ticket = createTicket(room, category || 'Umum', notes || '');

    // Send WhatsApp notification
    const waResult = await sendClassroomAlert({
      room,
      category,
      notes,
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
      message: `Panggilan bantuan untuk ruang ${room} telah diterima dan diteruskan ke tim staf teknis.`,
      ticket: {
        id: ticket.id,
        room: ticket.room,
        category: ticket.category,
        createdAt: ticket.createdAt,
        status: ticket.status
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

// 3. Get Tickets (Admin / Monitoring)
app.get('/api/tickets', (req, res) => {
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

// 4. Update Ticket Status (Admin)
app.patch('/api/tickets/:id/status', (req, res) => {
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

// 5. Get Settings (Admin)
app.get('/api/admin/settings', (req, res) => {
  const config = readConfig();
  res.json({
    success: true,
    settings: {
      appTitle: config.appTitle,
      rooms: config.rooms,
      messageTemplate: config.messageTemplate,
      waGateway: config.waGateway
    }
  });
});

// 6. Save Settings (Admin)
app.post('/api/admin/settings', (req, res) => {
  const { appTitle, rooms, messageTemplate, waGateway } = req.body;
  const currentConfig = readConfig();

  const newConfig = {
    ...currentConfig,
    appTitle: appTitle || currentConfig.appTitle,
    rooms: Array.isArray(rooms) ? rooms.filter(r => r.trim() !== '') : currentConfig.rooms,
    messageTemplate: messageTemplate || currentConfig.messageTemplate,
    waGateway: {
      ...currentConfig.waGateway,
      ...(waGateway || {})
    }
  };

  const saved = saveConfig(newConfig);
  if (saved) {
    res.json({ success: true, message: 'Pengaturan berhasil disimpan!', settings: newConfig });
  } else {
    res.status(500).json({ success: false, error: 'Gagal menyimpan konfigurasi.' });
  }
});

// 7. Test WhatsApp Gateway
app.post('/api/admin/test-wa', async (req, res) => {
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

// Direct UI Routes for easy bookmarking
app.get('/call', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'call.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/admin/print-qr', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'print-qr.html'));
});
app.get('/admin/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});

// Start Server if run directly
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 SBM ITB QR Layanan Teknis Server Running!`);
    console.log(`📡 Local URL    : http://localhost:${PORT}`);
    console.log(`📱 Call URL     : http://localhost:${PORT}/call?room=Henk%20Uno`);
    console.log(`🖨️  Print QR Card: http://localhost:${PORT}/admin/print-qr`);
    console.log(`🛠️  Admin Panel  : http://localhost:${PORT}/admin`);
    console.log(`⚙️  WA Settings  : http://localhost:${PORT}/admin/settings`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
