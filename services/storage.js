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

function readConfig() {
  if (inMemoryConfig) return inMemoryConfig;
  try {
    const targetPath = isVercel && fs.existsSync(TMP_CONFIG_PATH) ? TMP_CONFIG_PATH : CONFIG_PATH;
    if (fs.existsSync(targetPath)) {
      const data = fs.readFileSync(targetPath, 'utf-8');
      inMemoryConfig = JSON.parse(data);
      return inMemoryConfig;
    }
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
      adminPassword: "admin"
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

function readTickets() {
  if (inMemoryTickets) return inMemoryTickets;
  try {
    const targetPath = isVercel && fs.existsSync(TMP_TICKETS_PATH) ? TMP_TICKETS_PATH : TICKETS_PATH;
    if (fs.existsSync(targetPath)) {
      const data = fs.readFileSync(targetPath, 'utf-8');
      inMemoryTickets = JSON.parse(data);
      return inMemoryTickets;
    }
    inMemoryTickets = [];
    return inMemoryTickets;
  } catch (err) {
    console.error("Error reading tickets:", err);
    return inMemoryTickets || [];
  }
}

function saveTickets(tickets) {
  inMemoryTickets = tickets;
  try {
    const targetPath = isVercel ? TMP_TICKETS_PATH : TICKETS_PATH;
    fs.writeFileSync(targetPath, JSON.stringify(tickets, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error("Error saving tickets file, stored in memory:", err);
    return true;
  }
}

function createTicket(room, category = "Umum", notes = "") {
  const tickets = readTickets();
  const newTicket = {
    id: "TICK-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(Math.random() * 1000),
    room,
    category: category || "Umum",
    notes: notes || "",
    status: "Menunggu", // 'Menunggu', 'Diproses', 'Selesai'
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    waStatus: {
      sent: false,
      timestamp: null,
      details: null
    }
  };
  tickets.unshift(newTicket);
  saveTickets(tickets);
  return newTicket;
}

function updateTicketStatus(id, status, handledBy = "") {
  const tickets = readTickets();
  const ticket = tickets.find(t => t.id === id);
  if (ticket) {
    ticket.status = status;
    ticket.updatedAt = new Date().toISOString();
    if (handledBy) ticket.handledBy = handledBy;
    saveTickets(tickets);
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

module.exports = {
  readConfig,
  saveConfig,
  readTickets,
  saveTickets,
  createTicket,
  updateTicketStatus,
  updateTicketWaStatus
};
