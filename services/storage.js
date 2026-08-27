const fs = require('fs');
const path = require('path');

const isVercel = process.env.VERCEL === '1' || process.env.NOW_REGION;
const tmpDir = isVercel ? '/tmp' : path.join(__dirname, '..');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const TMP_CONFIG_PATH = path.join(tmpDir, 'config.json');

const TICKETS_PATH = path.join(__dirname, '..', 'tickets.json');
const TMP_TICKETS_PATH = path.join(tmpDir, 'tickets.json');

let inMemoryConfig = null;
let inMemoryTickets = null;

function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[<>]/g, '') // remove direct html tags
    .trim();
}

function readConfig() {
  try {
    const targetPath = isVercel && fs.existsSync(TMP_CONFIG_PATH) ? TMP_CONFIG_PATH : CONFIG_PATH;
    if (fs.existsSync(targetPath)) {
      const data = fs.readFileSync(targetPath, 'utf-8');
      inMemoryConfig = JSON.parse(data);
      return inMemoryConfig;
    }
    if (inMemoryConfig) return inMemoryConfig;
    const defaultConfig = {
      appTitle: "Layanan Bantuan Teknis SBM ITB Jakarta",
      rooms: [
        "Henk Uno",
        "Kirana Megatara 1",
        "Kirana Megatara 2",
        "Noni Purnomo",
        "Medco",
        "12A Room"
      ],
      messageTemplate: "Mohon bantuan teknis di ruang {room} SEGERA!",
      waGateway: {
        provider: "fonnte",
        fonnteToken: "",
        staffNumbers: [],
        countryCode: "62",
        webhookUrl: ""
      },
      adminPassword: "admin",
      superAdminPassword: "Bismillah.1"
    };
    inMemoryConfig = defaultConfig;
    return defaultConfig;
  } catch (err) {
    console.error("Error reading config:", err);
    return inMemoryConfig || {};
  }
}

function saveConfig(config) {
  inMemoryConfig = config;
  try {
    const targetPath = isVercel ? TMP_CONFIG_PATH : CONFIG_PATH;
    fs.writeFileSync(targetPath, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error("Error saving config file, stored in memory:", err);
    return true;
  }
}

function getKvCredentials() {
  const cfg = readConfig();
  const kvUrl = process.env.KV_REST_API_URL || 
                process.env.UPSTASH_REDIS_REST_URL || 
                cfg.kvConfig?.url || 
                cfg.upstashRedis?.url || 
                '';
  const kvToken = process.env.KV_REST_API_TOKEN || 
                  process.env.UPSTASH_REDIS_REST_TOKEN || 
                  cfg.kvConfig?.token || 
                  cfg.upstashRedis?.token || 
                  '';
  return { kvUrl: kvUrl.trim(), kvToken: kvToken.trim() };
}

function getStorageStatus() {
  const { kvUrl, kvToken } = getKvCredentials();
  const hasCloudKv = Boolean(kvUrl && kvToken);
  return {
    isVercel: Boolean(isVercel),
    hasCloudKv,
    kvUrl: kvUrl ? kvUrl.replace(/(https?:\/\/)[^@]+@/, '$1') : '',
    storageType: hasCloudKv ? 'Vercel KV / Upstash Redis (Persistent Cloud Database)' : (isVercel ? 'Vercel Ephemeral Memory (/tmp)' : 'Local File Storage (tickets.json)')
  };
}

// Test KV Connection
async function testKvConnection(url, token) {
  const targetUrl = url || getKvCredentials().kvUrl;
  const targetToken = token || getKvCredentials().kvToken;
  if (!targetUrl || !targetToken) {
    return { success: false, error: 'URL atau Token Cloud KV / Upstash Redis belum diisi.' };
  }
  try {
    const testKey = 'sbm_ping_' + Date.now();
    // 1. SET test key
    const setRes = await fetch(`${targetUrl}/set/${testKey}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${targetToken}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify({ ping: 'pong', time: new Date().toISOString() })
    });
    if (!setRes.ok) {
      return { success: false, error: `HTTP ${setRes.status}: ${setRes.statusText}` };
    }

    // 2. GET test key
    const getRes = await fetch(`${targetUrl}/get/${testKey}`, {
      headers: { Authorization: `Bearer ${targetToken}` },
      signal: AbortSignal.timeout(6000)
    });
    const getData = await getRes.json();

    // 3. Clean up test key
    fetch(`${targetUrl}/del/${testKey}`, {
      headers: { Authorization: `Bearer ${targetToken}` }
    }).catch(() => {});

    if (getData && getData.result) {
      return { success: true, message: 'Koneksi Cloud KV / Upstash Redis berhasil dan aktif!' };
    }
    return { success: true, message: 'Koneksi berhasil terhubung.' };
  } catch (e) {
    return { success: false, error: e.message || 'Gagal menghubungi server Cloud KV.' };
  }
}

// Cloud KV / Upstash Redis REST integration for Vercel & Local
async function getKvConfig() {
  const { kvUrl, kvToken } = getKvCredentials();
  if (!kvUrl || !kvToken) return null;
  try {
    const res = await fetch(`${kvUrl}/get/sbm_config`, {
      headers: { Authorization: `Bearer ${kvToken}` },
      signal: AbortSignal.timeout(4000)
    });
    const data = await res.json();
    if (data && data.result) {
      const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
      return parsed && typeof parsed === 'object' ? parsed : null;
    }
    return null;
  } catch (e) {
    console.error("Error reading config from Cloud KV:", e.message);
    return null;
  }
}

async function setKvConfig(config) {
  const { kvUrl, kvToken } = getKvCredentials();
  if (!kvUrl || !kvToken) return false;
  try {
    await fetch(`${kvUrl}/set/sbm_config`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${kvToken}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify(config)
    });
    return true;
  } catch (e) {
    console.error("Error saving config to Cloud KV:", e.message);
    return false;
  }
}

async function readConfigAsync() {
  const cloudConfig = await getKvConfig();
  if (cloudConfig && typeof cloudConfig === 'object') {
    inMemoryConfig = { ...readConfig(), ...cloudConfig };
    return inMemoryConfig;
  }
  return readConfig();
}

async function saveConfigAsync(config) {
  inMemoryConfig = config;
  await setKvConfig(config);
  return saveConfig(config);
}

// Cloud KV / Upstash Redis REST integration for Vercel
async function getKvTickets() {
  const { kvUrl, kvToken } = getKvCredentials();
  if (!kvUrl || !kvToken) return null;
  try {
    const res = await fetch(`${kvUrl}/get/sbm_tickets`, {
      headers: { Authorization: `Bearer ${kvToken}` },
      signal: AbortSignal.timeout(4000)
    });
    const data = await res.json();
    if (data && data.result !== undefined && data.result !== null) {
      const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
      return Array.isArray(parsed) ? parsed : [];
    }
    return [];
  } catch (e) {
    console.error("Error reading tickets from Cloud KV:", e.message);
    return null;
  }
}

async function setKvTickets(tickets) {
  const { kvUrl, kvToken } = getKvCredentials();
  if (!kvUrl || !kvToken) return false;
  try {
    await fetch(`${kvUrl}/set/sbm_tickets`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${kvToken}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify(tickets)
    });
    return true;
  } catch (e) {
    console.error("Error saving tickets to Cloud KV:", e.message);
    return false;
  }
}

function readTickets() {
  try {
    const targetPath = isVercel && fs.existsSync(TMP_TICKETS_PATH) ? TMP_TICKETS_PATH : TICKETS_PATH;
    if (fs.existsSync(targetPath)) {
      const data = fs.readFileSync(targetPath, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        inMemoryTickets = parsed;
        return inMemoryTickets;
      }
    }
    if (Array.isArray(inMemoryTickets)) return inMemoryTickets;
    inMemoryTickets = [];
    return inMemoryTickets;
  } catch (err) {
    console.error("Error reading tickets:", err);
    if (Array.isArray(inMemoryTickets)) return inMemoryTickets;
    inMemoryTickets = [];
    return inMemoryTickets;
  }
}

async function readTicketsAsync() {
  const cloudTickets = await getKvTickets();
  if (cloudTickets !== null && Array.isArray(cloudTickets)) {
    inMemoryTickets = cloudTickets;
    return cloudTickets;
  }
  return readTickets();
}

function saveTickets(tickets) {
  if (!Array.isArray(tickets)) tickets = [];
  inMemoryTickets = tickets;
  // Trigger background KV sync if configured
  setKvTickets(tickets).catch(() => {});
  try {
    const targetPath = isVercel ? TMP_TICKETS_PATH : TICKETS_PATH;
    fs.writeFileSync(targetPath, JSON.stringify(tickets, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error("Error saving tickets file, stored in memory:", err);
    return true;
  }
}

async function saveTicketsAsync(tickets) {
  if (!Array.isArray(tickets)) tickets = [];
  inMemoryTickets = tickets;
  await setKvTickets(tickets);
  try {
    const targetPath = isVercel ? TMP_TICKETS_PATH : TICKETS_PATH;
    fs.writeFileSync(targetPath, JSON.stringify(tickets, null, 2), 'utf-8');
    return true;
  } catch (err) {
    return true;
  }
}

async function createTicketAsync(room, category = "Umum", notes = "") {
  const tickets = await readTicketsAsync();
  const safeRoom = sanitizeString(room);
  const safeCategory = sanitizeString(category) || "Umum";
  const safeNotes = sanitizeString(notes);
  const now = new Date().toISOString();

  const newTicket = {
    id: "TICK-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(Math.random() * 1000),
    room: safeRoom,
    category: safeCategory,
    notes: safeNotes,
    status: "Menunggu",
    handledBy: "",
    createdAt: now,
    claimedAt: null,
    completedAt: null,
    resolutionTimeSeconds: null,
    updatedAt: now,
    waStatus: {
      sent: false,
      timestamp: null,
      details: null
    },
    telegramMessages: [] // Array of { chatId, messageId }
  };
  tickets.unshift(newTicket);
  await saveTicketsAsync(tickets);
  return newTicket;
}

function createTicket(room, category = "Umum", notes = "") {
  const tickets = readTickets();
  const safeRoom = sanitizeString(room);
  const safeCategory = sanitizeString(category) || "Umum";
  const safeNotes = sanitizeString(notes);
  const now = new Date().toISOString();

  const newTicket = {
    id: "TICK-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(Math.random() * 1000),
    room: safeRoom,
    category: safeCategory,
    notes: safeNotes,
    status: "Menunggu",
    handledBy: "",
    createdAt: now,
    claimedAt: null,
    completedAt: null,
    resolutionTimeSeconds: null,
    updatedAt: now,
    waStatus: {
      sent: false,
      timestamp: null,
      details: null
    },
    telegramMessages: [] // Array of { chatId, messageId }
  };
  tickets.unshift(newTicket);
  saveTickets(tickets);
  return newTicket;
}

async function updateTicketStatusAsync(id, status, handledBy = "") {
  const tickets = await readTicketsAsync();
  const ticket = tickets.find(t => t.id === id);
  if (ticket) {
    const now = new Date().toISOString();
    ticket.status = status;
    ticket.updatedAt = now;

    if (handledBy !== undefined && handledBy !== null && handledBy !== "") {
      ticket.handledBy = sanitizeString(handledBy);
    }

    if (status === 'Diproses' && !ticket.claimedAt) {
      ticket.claimedAt = now;
    }

    if (status === 'Selesai') {
      if (!ticket.completedAt) {
        ticket.completedAt = now;
      }
      const createdTime = new Date(ticket.createdAt).getTime();
      const completedTime = new Date(ticket.completedAt).getTime();
      ticket.resolutionTimeSeconds = Math.max(0, Math.round((completedTime - createdTime) / 1000));
    }

    await saveTicketsAsync(tickets);
    return ticket;
  }
  return null;
}

function updateTicketStatus(id, status, handledBy = "") {
  const tickets = readTickets();
  const ticket = tickets.find(t => t.id === id);
  if (ticket) {
    const now = new Date().toISOString();
    ticket.status = status;
    ticket.updatedAt = now;

    if (handledBy !== undefined && handledBy !== null && handledBy !== "") {
      ticket.handledBy = sanitizeString(handledBy);
    }

    if (status === 'Diproses' && !ticket.claimedAt) {
      ticket.claimedAt = now;
    }

    if (status === 'Selesai') {
      if (!ticket.completedAt) {
        ticket.completedAt = now;
      }
      const createdTime = new Date(ticket.createdAt).getTime();
      const completedTime = new Date(ticket.completedAt).getTime();
      ticket.resolutionTimeSeconds = Math.max(0, Math.round((completedTime - createdTime) / 1000));
    }

    saveTickets(tickets);
    return ticket;
  }
  return null;
}

async function getTicketByIdAsync(id) {
  const tickets = await readTicketsAsync();
  return tickets.find(t => t.id === id) || null;
}

function getTicketById(id) {
  const tickets = readTickets();
  return tickets.find(t => t.id === id) || null;
}

async function updateTicketWaStatusAsync(id, waStatus) {
  const tickets = await readTicketsAsync();
  const ticket = tickets.find(t => t.id === id);
  if (ticket) {
    ticket.waStatus = waStatus;
    ticket.updatedAt = new Date().toISOString();
    await saveTicketsAsync(tickets);
    return ticket;
  }
  return null;
}

function updateTicketWaStatus(id, waStatus) {
  const tickets = readTickets();
  const ticket = tickets.find(t => t.id === id);
  if (ticket) {
    ticket.waStatus = waStatus;
    ticket.updatedAt = new Date().toISOString();
    saveTickets(tickets);
    return ticket;
  }
  return null;
}

async function appendTelegramMessagesAsync(id, newMessages) {
  if (!Array.isArray(newMessages) || newMessages.length === 0) return null;
  const tickets = await readTicketsAsync();
  const ticket = tickets.find(t => t.id === id);
  if (ticket) {
    if (!Array.isArray(ticket.telegramMessages)) {
      ticket.telegramMessages = [];
    }
    for (const msg of newMessages) {
      if (msg && msg.chatId && msg.messageId) {
        const exists = ticket.telegramMessages.some(m => m.chatId === msg.chatId && m.messageId === msg.messageId);
        if (!exists) {
          ticket.telegramMessages.push(msg);
        }
      }
    }
    ticket.updatedAt = new Date().toISOString();
    await saveTicketsAsync(tickets);
    return ticket;
  }
  return null;
}

function appendTelegramMessages(id, newMessages) {
  if (!Array.isArray(newMessages) || newMessages.length === 0) return null;
  const tickets = readTickets();
  const ticket = tickets.find(t => t.id === id);
  if (ticket) {
    if (!Array.isArray(ticket.telegramMessages)) {
      ticket.telegramMessages = [];
    }
    for (const msg of newMessages) {
      if (msg && msg.chatId && msg.messageId) {
        const exists = ticket.telegramMessages.some(m => m.chatId === msg.chatId && m.messageId === msg.messageId);
        if (!exists) {
          ticket.telegramMessages.push(msg);
        }
      }
    }
    ticket.updatedAt = new Date().toISOString();
    saveTickets(tickets);
    return ticket;
  }
  return null;
}

async function clearAllTicketsAsync() {
  inMemoryTickets = [];
  await saveTicketsAsync([]);
  return true;
}

function clearAllTickets() {
  inMemoryTickets = [];
  saveTickets([]);
  return true;
}

module.exports = {
  readConfig,
  readConfigAsync,
  saveConfig,
  saveConfigAsync,
  getStorageStatus,
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
  appendTelegramMessages,
  appendTelegramMessagesAsync,
  clearAllTickets,
  clearAllTicketsAsync,
  testKvConnection,
  sanitizeString
};
