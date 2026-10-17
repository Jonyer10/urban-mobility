// Base de datos SQLite (módulo integrado de Node >= 22.13): casos persistentes + caché con TTL.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

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

const parseCase = (row) => (row ? { ...JSON.parse(row.data), id: Number(row.id) } : null);

// --- Casos ---
function createCase(caseData) {
  const createdAt = Date.now();
  const { lastInsertRowid } = stmts.insertCase.run('{}', createdAt);
  const id = Number(lastInsertRowid);
  const record = { ...caseData, id, createdAt: new Date(createdAt).toISOString() };
  stmts.updateCase.run(JSON.stringify(record), id);
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
stmts.purgeCache.run(Date.now());

module.exports = { createCase, updateCase, getCaseById, listCases, getRecentCases, cacheGet, cacheSet, normalizeKey };
