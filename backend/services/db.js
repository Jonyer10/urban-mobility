// Base de datos SQLite (módulo integrado de Node >= 22.13): casos persistentes + caché con TTL.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { urbanDatabase, DEFAULT_SERVICES } = require('./localData');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'urban.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache (expires_at);

  -- Trazabilidad: un registro por paso de agente/herramienta/acción (lo que muestra la pestaña Trazabilidad)
  CREATE TABLE IF NOT EXISTS trace_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    at TEXT,
    agent TEXT,
    kind TEXT,
    tool TEXT,
    input TEXT,
    output TEXT,
    message TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_trace_case ON trace_events (case_id, seq);

  -- Historial de rutas calculadas por caso (al registrar y desde el chat)
  CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    at TEXT,
    source TEXT,
    origin TEXT,
    destination TEXT,
    route_name TEXT,
    distance_km REAL,
    duration_min REAL,
    via TEXT,
    alerts TEXT,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_routes_case ON routes (case_id, seq);

  -- Conversaciones del chat contextual
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    at TEXT,
    question TEXT,
    response TEXT,
    tools_used TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_chat_case ON chat_messages (case_id);

  -- Catálogo de servicios por categoría (espejo de services/localData.js)
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT,
    contact TEXT,
    lat REAL,
    lon REAL,
    UNIQUE (category, name)
  );
`);

// Columna de categoría en las tablas de historial para consultarlas por categoría
for (const table of ['trace_events', 'routes', 'chat_messages']) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes('category')) db.exec(`ALTER TABLE ${table} ADD COLUMN category TEXT`);
}

// Sincroniza el catálogo con localData.js
{
  db.exec('DELETE FROM services');
  const insService = db.prepare('INSERT INTO services (category, name, status, contact, lat, lon) VALUES (?, ?, ?, ?, ?, ?)');
  for (const [category, list] of Object.entries(urbanDatabase)) {
    for (const s of list) insService.run(category, s.name, s.status ?? null, s.contact ?? null, s.lat ?? null, s.lon ?? null);
  }
  for (const s of DEFAULT_SERVICES) insService.run('general', s.name, s.status ?? null, s.contact ?? null, s.lat ?? null, s.lon ?? null);
}

// Columnas legibles en la tabla cases (el detalle completo sigue en la columna JSON "data")
const caseCols = db.prepare('PRAGMA table_info(cases)').all().map((c) => c.name);
for (const [name, type] of [['user_text', 'TEXT'], ['incident_location', 'TEXT'], ['category', 'TEXT'], ['urgency_level', 'TEXT'], ['entity', 'TEXT'], ['has_image', 'INTEGER']]) {
  if (!caseCols.includes(name)) db.exec(`ALTER TABLE cases ADD COLUMN ${name} ${type}`);
}

db.exec(`
  CREATE VIEW IF NOT EXISTS historial_casos AS
    SELECT id, created_at, user_text, incident_location, category, urgency_level, entity, has_image, data
    FROM cases;
  CREATE VIEW IF NOT EXISTS historial_seguridad AS
    SELECT * FROM historial_casos WHERE lower(trim(category)) = 'seguridad';
  CREATE VIEW IF NOT EXISTS historial_ambiente AS
    SELECT * FROM historial_casos WHERE lower(trim(category)) = 'ambiente';
  CREATE VIEW IF NOT EXISTS historial_salud AS
    SELECT * FROM historial_casos WHERE lower(trim(category)) = 'salud';
  CREATE VIEW IF NOT EXISTS historial_infraestructura AS
    SELECT * FROM historial_casos WHERE lower(trim(category)) = 'infraestructura';
`);

const stmts = {
  insertCase: db.prepare('INSERT INTO cases (data, created_at) VALUES (?, ?)'),
  updateCase: db.prepare('UPDATE cases SET data = ? WHERE id = ?'),
  getCase: db.prepare('SELECT id, data FROM cases WHERE id = ?'),
  recentCases: db.prepare('SELECT id, data FROM cases WHERE created_at >= ? ORDER BY id DESC'),
  listCases: db.prepare('SELECT id, data FROM cases ORDER BY id DESC LIMIT ?'),
  getCache: db.prepare('SELECT value FROM cache WHERE key = ? AND expires_at > ?'),
  setCache: db.prepare('INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)'),
  purgeCache: db.prepare('DELETE FROM cache WHERE expires_at <= ?')
};

const asText = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

// Refleja el caso en columnas legibles y en las tablas trace_events y chat_messages
function syncRelational(record) {
  const id = record.id;
  db.prepare('UPDATE cases SET user_text = ?, incident_location = ?, category = ?, urgency_level = ?, entity = ?, has_image = ? WHERE id = ?').run(
    record.user_text ?? null,
    record.incident_location ?? record.origin_location ?? null,
    record.analysis?.category ?? null,
    record.analysis?.urgency_level ?? null,
    record.services?.[0]?.name ?? null,
    record.has_image ? 1 : 0,
    id
  );
  const category = record.analysis?.category ?? null;
  db.prepare('DELETE FROM trace_events WHERE case_id = ?').run(id);
  const insEvent = db.prepare('INSERT INTO trace_events (case_id, seq, at, agent, kind, tool, input, output, message, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  (record.trace_events ?? []).forEach((e, i) => insEvent.run(id, i + 1, e.at ?? null, e.agent ?? null, e.kind ?? null, e.tool ?? null, asText(e.input), asText(e.output), e.message ?? null, category));
  db.prepare('DELETE FROM routes WHERE case_id = ?').run(id);
  const insRoute = db.prepare('INSERT INTO routes (case_id, seq, at, source, origin, destination, route_name, distance_km, duration_min, via, alerts, detail, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const history = record.route_history ?? (record.route ? [{ at: record.createdAt, source: 'registro', route: record.route }] : []);
  history.forEach((h, i) => insRoute.run(id, i + 1, h.at ?? null, h.source ?? null, h.route?.origin?.name ?? null, h.route?.destination?.name ?? null, h.route?.best?.name ?? null, h.route?.best?.distance_km ?? null, h.route?.best?.duration_min ?? null, asText(h.route?.best?.via), asText(h.route?.alerts), JSON.stringify(h.route), category));
  db.prepare('DELETE FROM chat_messages WHERE case_id = ?').run(id);
  const insChat = db.prepare('INSERT INTO chat_messages (case_id, at, question, response, tools_used, category) VALUES (?, ?, ?, ?, ?, ?)');
  (record.chat_history ?? []).forEach((m) => insChat.run(id, m.at ?? null, m.question ?? null, m.response ?? null, asText(m.tools_used), category));
}

const parseCase = (row) => (row ? { ...JSON.parse(row.data), id: Number(row.id) } : null);

// --- Casos ---
function createCase(caseData) {
  const createdAt = Date.now();
  const { lastInsertRowid } = stmts.insertCase.run('{}', createdAt);
  const id = Number(lastInsertRowid);
  const record = { ...caseData, id, createdAt: new Date(createdAt).toISOString() };
  stmts.updateCase.run(JSON.stringify(record), id);
  syncRelational(record);
  return record;
}

function getCaseById(id) {
  return parseCase(stmts.getCase.get(id));
}

function updateCase(id, changes) {
  const current = getCaseById(id);
  if (!current) return null;
  const record = { ...current, ...changes, id };
  stmts.updateCase.run(JSON.stringify(record), id);
  syncRelational(record);
  return record;
}

function listCases(limit = 50) {
  return stmts.listCases.all(limit).map(parseCase);
}

function getRecentCases(sinceMs) {
  return stmts.recentCases.all(Date.now() - sinceMs).map(parseCase);
}

// --- Caché con expiración ---
function cacheGet(key) {
  const row = stmts.getCache.get(key, Date.now());
  return row ? JSON.parse(row.value) : null;
}

function cacheSet(key, value, ttlMs) {
  stmts.setCache.run(key, JSON.stringify(value), Date.now() + ttlMs);
}

// Normaliza texto para generar claves de caché estables (minúsculas, sin tildes ni espacios extra)
function normalizeKey(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Importa los casos del antiguo cases.json (una sola vez) para no perder datos
function migrateLegacyJson() {
  const legacy = path.join(path.dirname(DB_PATH), 'cases.json');
  if (!fs.existsSync(legacy)) return;
  try {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM cases').get();
    if (Number(n) === 0) {
      for (const c of JSON.parse(fs.readFileSync(legacy, 'utf8'))) {
        const { id, ...rest } = c;
        createCase(rest);
      }
    }
    fs.renameSync(legacy, `${legacy}.migrated`);
  } catch (error) {
    console.warn('Aviso: no se pudo migrar cases.json:', error.message);
  }
}

migrateLegacyJson();
// Resincroniza todos los casos existentes (rellena historial, chat y categoría)
for (const row of db.prepare('SELECT id, data FROM cases').all()) syncRelational(parseCase(row));
stmts.purgeCache.run(Date.now());

module.exports = { createCase, updateCase, getCaseById, listCases, getRecentCases, cacheGet, cacheSet, normalizeKey };
