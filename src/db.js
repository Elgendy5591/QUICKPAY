const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new Database(path.join(DATA_DIR, 'klarfall.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('kunde','fahrer','firma','buero','anwalt','gutachter','werkstatt','vermietung')),
  company_id INTEGER REFERENCES companies(id),
  active INTEGER NOT NULL DEFAULT 1,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  customer_id INTEGER REFERENCES users(id),
  company_id INTEGER REFERENCES companies(id),
  guest_name TEXT, guest_phone TEXT, guest_email TEXT,
  type TEXT NOT NULL,
  when_ts INTEGER,
  place TEXT,
  own_plate TEXT,
  injured TEXT,
  police TEXT,
  opp_plate TEXT, opp_ins TEXT, opp_name TEXT, opp_phone TEXT,
  witness TEXT,
  text TEXT,
  fault TEXT,
  has_rs TEXT,
  commercial INTEGER DEFAULT 0,
  needs_tow INTEGER DEFAULT 0, needs_repair INTEGER DEFAULT 0, needs_car INTEGER DEFAULT 0,
  expert_pref TEXT,
  status TEXT NOT NULL DEFAULT 'Neu',
  expert_id INTEGER REFERENCES users(id),
  lawyer_id INTEGER REFERENCES users(id),
  workshop_id INTEGER REFERENCES users(id),
  rental_id INTEGER REFERENCES users(id),
  claim_no TEXT,
  damage_amount REAL,
  claim_amount REAL,
  paid_amount REAL,
  days_off INTEGER,
  liability TEXT,
  note_internal TEXT
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  label TEXT,
  filename TEXT NOT NULL,
  original TEXT,
  mime TEXT,
  size INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'msg',
  text TEXT NOT NULL,
  internal INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cases_customer ON cases(customer_id);
CREATE INDEX IF NOT EXISTS idx_cases_company ON cases(company_id);
CREATE INDEX IF NOT EXISTS idx_events_case ON events(case_id);
CREATE INDEX IF NOT EXISTS idx_files_case ON files(case_id);
`);

// Spalten nachrüsten (bestehende Datenbanken werden automatisch erweitert)
function addCol(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addCol('users', 'notify_channel', "TEXT DEFAULT 'email'");
addCol('users', 'lang', "TEXT DEFAULT 'de'");
addCol('cases', 'lang', "TEXT DEFAULT 'de'");
addCol('cases', 'signed_at', 'INTEGER');
addCol('cases', 'video_room', 'TEXT');
addCol('cases', 'video_url', 'TEXT');
addCol('cases', 'video_at', 'INTEGER');
addCol('cases', 'ai_json', 'TEXT');
addCol('cases', 'ai_at', 'INTEGER');
addCol('cases', 'ai_status', 'TEXT');

module.exports = { db, DATA_DIR };
