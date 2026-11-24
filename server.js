require('./src/env');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { db, DATA_DIR } = require('./src/db');
const { sendMail } = require('./src/notify');

const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const OFFICE_EMAIL = process.env.OFFICE_EMAIL || '';
const SESSION_DAYS = 30;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const STATUS = ['Neu', 'In Prüfung', 'An Gutachter', 'An Anwalt', 'Versicherung prüft', 'Teilbezahlt', 'Bezahlt', 'Abgeschlossen', 'Eigene Schuld / Kasko', 'Abgelehnt'];
const ROLES = ['kunde', 'fahrer', 'firma', 'buero', 'anwalt', 'gutachter', 'werkstatt', 'vermietung'];
const PARTNER = { anwalt: 'lawyer_id', gutachter: 'expert_id', werkstatt: 'workshop_id', vermietung: 'rental_id' };

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));

// Sicherheits-Header
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=(self)',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
  });
  next();
});

/* ------------------------------ Hilfsfunktionen ------------------------------ */
const now = () => Date.now();
const str = (v, max = 500) => (v == null ? null : String(v).trim().slice(0, max) || null);
const num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const bool = v => (v === true || v === 'true' || v === '1' || v === 1 || v === 'on' ? 1 : 0);
const err = (res, code, msg) => res.status(code).json({ error: msg });

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)').run(token, userId, expires);
  res.setHeader('Set-Cookie', `kf_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${PROD ? '; Secure' : ''}`);
}

app.use((req, res, next) => {
  const token = parseCookies(req).kf_session;
  if (token) {
    const row = db.prepare(`SELECT u.id,u.email,u.name,u.phone,u.role,u.company_id,u.active,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?`).get(token);
    if (row && row.expires > now() && row.active) { req.user = row; req.token = token; }
  }
  next();
});

const auth = (...roles) => (req, res, next) => {
  if (!req.user) return err(res, 401, 'Bitte anmelden.');
  if (roles.length && !roles.includes(req.user.role)) return err(res, 403, 'Keine Berechtigung.');
  next();
};

// Wer darf welchen Fall sehen?
function scope(user) {
  if (user.role === 'buero') return { sql: '1=1', args: [] };
  if (user.role === 'firma') return { sql: 'c.company_id = ?', args: [user.company_id ?? -1] };
  if (PARTNER[user.role]) return { sql: `c.${PARTNER[user.role]} = ?`, args: [user.id] };
  return { sql: 'c.customer_id = ?', args: [user.id] };
}
function getCase(user, id) {
  const s = scope(user);
  return db.prepare(`SELECT c.* FROM cases c WHERE c.id=? AND ${s.sql}`).get(id, ...s.args);
}
function addEvent(caseId, userId, text, kind = 'msg', internal = 0) {
  db.prepare('INSERT INTO events(case_id,created,user_id,kind,text,internal) VALUES (?,?,?,?,?,?)').run(caseId, now(), userId, kind, text, internal);
  db.prepare('UPDATE cases SET updated=? WHERE id=?').run(now(), caseId);
}
function caseNo() {
  const d = new Date();
  const ymd = d.toISOString().slice(2, 10).replace(/-/g, '');
  return `K-${ymd}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}
function publicCase(c, user) {
  const out = { ...c };
  if (user.role !== 'buero') delete out.note_internal;
  return out;
}
function userName(id) {
  if (!id) return null;
  const u = db.prepare('SELECT id,name,role,phone,email FROM users WHERE id=?').get(id);
  return u || null;
}
function contactOf(c) {
  if (c.customer_id) {
    const u = db.prepare('SELECT name,email,phone FROM users WHERE id=?').get(c.customer_id);
    return u || {};
  }
  return { name: c.guest_name, email: c.guest_email, phone: c.guest_phone };
}

// einfache Begrenzung für Login-Versuche
const attempts = new Map();
function limited(key) {
  const t = now(), a = (attempts.get(key) || []).filter(x => t - x < 15 * 60e3);
  a.push(t); attempts.set(key, a);
  return a.length > 10;
}

/* ------------------------------ Uploads ------------------------------ */
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', 'video/mp4', 'video/quicktime'];
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6)),
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED.includes(file.mimetype)),
});
function saveFiles(caseId, files, labels, userId) {
  const ins = db.prepare('INSERT INTO files(case_id,label,filename,original,mime,size,uploaded_by,created) VALUES (?,?,?,?,?,?,?,?)');
  (files || []).forEach((f, i) => ins.run(caseId, str(Array.isArray(labels) ? labels[i] : labels, 60) || 'Foto', f.filename, str(f.originalname, 200), f.mimetype, f.size, userId || null, now()));
}

/* ------------------------------ Auth ------------------------------ */
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, phone } = req.body || {};
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return err(res, 400, 'Bitte gültige E-Mail angeben.');
  if (!password || String(password).length < 8) return err(res, 400, 'Passwort mindestens 8 Zeichen.');
  if (!str(name)) return err(res, 400, 'Bitte Namen angeben.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return err(res, 409, 'Diese E-Mail ist schon registriert.');
  const hash = await bcrypt.hash(String(password), 11);
  const r = db.prepare('INSERT INTO users(email,pw_hash,name,phone,role,created) VALUES (?,?,?,?,?,?)').run(String(email).trim(), hash, str(name, 120), str(phone, 40), 'kunde', now());
  setSession(res, r.lastInsertRowid);
  res.json({ ok: true });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (limited(req.ip + '|' + String(email).toLowerCase())) return err(res, 429, 'Zu viele Versuche. Bitte 15 Minuten warten.');
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').trim());
  if (!u || !u.active || !(await bcrypt.compare(String(password || ''), u.pw_hash))) return err(res, 401, 'E-Mail oder Passwort falsch.');
  setSession(res, u.id);
  res.json({ ok: true, role: u.role });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.token) db.prepare('DELETE FROM sessions WHERE token=?').run(req.token);
  res.setHeader('Set-Cookie', 'kf_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const { id, email, name, phone, role, company_id } = req.user;
  const company = company_id ? db.prepare('SELECT id,name FROM companies WHERE id=?').get(company_id) : null;
  res.json({ user: { id, email, name, phone, role, company } });
});

app.post('/api/me/password', auth(), async (req, res) => {
  const { old, password } = req.body || {};
  const u = db.prepare('SELECT pw_hash FROM users WHERE id=?').get(req.user.id);
  if (!(await bcrypt.compare(String(old || ''), u.pw_hash))) return err(res, 400, 'Altes Passwort falsch.');
  if (!password || String(password).length < 8) return err(res, 400, 'Neues Passwort mindestens 8 Zeichen.');
  db.prepare('UPDATE users SET pw_hash=? WHERE id=?').run(await bcrypt.hash(String(password), 11), req.user.id);
  res.json({ ok: true });
});

/* ------------------------------ Fälle ------------------------------ */
app.get('/api/meta', (req, res) => res.json({ status: STATUS, roles: ROLES }));

// Neuer Fall: angemeldet (App) oder als Gast (Webseite)
app.post('/api/cases', upload.array('photos', 20), (req, res) => {
  const b = req.body || {};
  const u = req.user;
  if (!str(b.type)) return err(res, 400, 'Bitte Unfallart angeben.');
  if (!u && (!str(b.guest_name) || !str(b.guest_phone))) return err(res, 400, 'Bitte Name und Telefon angeben.');
  if (!u && limited('guest|' + req.ip)) { (req.files || []).forEach(f => fs.unlink(f.path, () => {})); return err(res, 429, 'Zu viele Meldungen. Bitte rufen Sie uns an.'); }
  const t = now();
  const whenTs = num(b.when_ts) || (b.when ? Date.parse(b.when) : null) || t;
  const r = db.prepare(`INSERT INTO cases(no,created,updated,customer_id,company_id,guest_name,guest_phone,guest_email,type,when_ts,place,own_plate,injured,police,opp_plate,opp_ins,opp_name,opp_phone,witness,text,fault,has_rs,commercial,needs_tow,needs_repair,needs_car,expert_pref,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Neu')`).run(
    caseNo(), t, t, u ? u.id : null, u && u.role === 'fahrer' ? u.company_id : null,
    u ? null : str(b.guest_name, 120), u ? null : str(b.guest_phone, 40), u ? null : str(b.guest_email, 160),
    str(b.type, 80), whenTs, str(b.place, 200), str(b.own_plate, 20)?.toUpperCase(), str(b.injured, 10), str(b.police, 60),
    str(b.opp_plate, 20)?.toUpperCase(), str(b.opp_ins, 120), str(b.opp_name, 120), str(b.opp_phone, 40), str(b.witness, 300),
    str(b.text, 4000), str(b.fault, 20), str(b.has_rs, 20), bool(b.commercial) || (u && u.role === 'fahrer' ? 1 : 0),
    bool(b.needs_tow), bool(b.needs_repair), bool(b.needs_car), str(b.expert_pref, 20));
  const id = r.lastInsertRowid;
  saveFiles(id, req.files, b.labels, u?.id);
  addEvent(id, u?.id || null, u ? 'Unfall gemeldet.' : 'Unfall über die Webseite gemeldet.', 'sys');
  const c = db.prepare('SELECT * FROM cases WHERE id=?').get(id);
  sendMail(OFFICE_EMAIL, `Neuer Unfall ${c.no}`, `${c.type} · ${c.place || ''}\n${BASE_URL}/portal/#fall-${id}`);
  const ct = contactOf(c);
  sendMail(ct.email, `Ihre Unfallmeldung ${c.no}`, `Danke, wir haben Ihre Meldung erhalten und melden uns kurzfristig.\nStatus: ${BASE_URL}/app/`);
  res.json({ ok: true, id, no: c.no });
});

app.get('/api/cases', auth(), (req, res) => {
  const s = scope(req.user);
  const where = [s.sql], args = [...s.args];
  if (req.query.status) { where.push('c.status = ?'); args.push(String(req.query.status)); }
  if (req.query.open === '1') where.push(`c.status NOT IN ('Bezahlt','Abgeschlossen','Abgelehnt')`);
  if (req.query.q) {
    where.push(`(c.no LIKE ? OR c.own_plate LIKE ? OR c.opp_plate LIKE ? OR c.place LIKE ? OR c.guest_name LIKE ? OR u.name LIKE ?)`);
    const q = '%' + String(req.query.q).slice(0, 60) + '%'; args.push(q, q, q, q, q, q);
  }
  const rows = db.prepare(`SELECT c.id,c.no,c.created,c.updated,c.type,c.when_ts,c.place,c.own_plate,c.opp_plate,c.status,c.claim_amount,c.paid_amount,c.days_off,c.company_id,
      COALESCE(u.name,c.guest_name) AS customer_name, co.name AS company_name,
      (SELECT COUNT(*) FROM files f WHERE f.case_id=c.id) AS file_count
    FROM cases c LEFT JOIN users u ON u.id=c.customer_id LEFT JOIN companies co ON co.id=c.company_id
    WHERE ${where.join(' AND ')} ORDER BY c.updated DESC LIMIT 1000`).all(...args);
  res.json({ cases: rows });
});

app.get('/api/stats', auth('buero', 'firma', 'anwalt', 'gutachter', 'werkstatt', 'vermietung'), (req, res) => {
  const s = scope(req.user);
  const r = db.prepare(`SELECT COUNT(*) total,
      SUM(c.status='Neu') neu,
      SUM(c.status NOT IN ('Bezahlt','Abgeschlossen','Abgelehnt')) offen,
      COALESCE(SUM(c.claim_amount),0) gefordert, COALESCE(SUM(c.paid_amount),0) bezahlt,
      COALESCE(SUM(c.days_off),0) ausfalltage,
      SUM(c.fault='Ich') eigen, SUM(c.fault='Der Gegner') gegner
    FROM cases c WHERE ${s.sql}`).get(...s.args);
  res.json(r);
});

app.get('/api/cases/:id', auth(), (req, res) => {
  const c = getCase(req.user, Number(req.params.id));
  if (!c) return err(res, 404, 'Fall nicht gefunden.');
  const internal = req.user.role === 'buero';
  const events = db.prepare(`SELECT e.id,e.created,e.kind,e.text,e.internal,u.name AS by_name,u.role AS by_role FROM events e LEFT JOIN users u ON u.id=e.user_id WHERE e.case_id=? ${internal ? '' : 'AND e.internal=0'} ORDER BY e.created`).all(c.id);
  const files = db.prepare('SELECT id,label,original,mime,size,created FROM files WHERE case_id=? ORDER BY created').all(c.id);
  const parties = {
    customer: contactOf(c),
    company: c.company_id ? db.prepare('SELECT id,name FROM companies WHERE id=?').get(c.company_id) : null,
    expert: userName(c.expert_id), lawyer: userName(c.lawyer_id), workshop: userName(c.workshop_id), rental: userName(c.rental_id),
  };
  res.json({ case: publicCase(c, req.user), events, files, parties });
});

// Büro: Status, Zuweisung, Beträge, Notizen
app.patch('/api/cases/:id', auth('buero'), (req, res) => {
  const c = getCase(req.user, Number(req.params.id));
  if (!c) return err(res, 404, 'Fall nicht gefunden.');
  const b = req.body || {};
  const fields = {
    status: v => (STATUS.includes(v) ? v : c.status),
    expert_id: num, lawyer_id: num, workshop_id: num, rental_id: num,
    claim_no: v => str(v, 80), damage_amount: num, claim_amount: num, paid_amount: num, days_off: num,
    liability: v => str(v, 40), note_internal: v => str(v, 4000), company_id: num,
  };
  const set = [], args = [];
  for (const [k, fn] of Object.entries(fields)) if (k in b) { set.push(`${k}=?`); args.push(fn(b[k])); }
  for (const [role, col] of Object.entries(PARTNER)) {
    if (col in b && b[col] != null && b[col] !== '') {
      const p = db.prepare('SELECT role FROM users WHERE id=?').get(Number(b[col]));
      if (!p || p.role !== role) return err(res, 400, `Ungültiger Partner für ${role}.`);
    }
  }
  if (!set.length) return res.json({ ok: true });
  set.push('updated=?'); args.push(now());
  db.prepare(`UPDATE cases SET ${set.join(',')} WHERE id=?`).run(...args, c.id);
  const n = db.prepare('SELECT * FROM cases WHERE id=?').get(c.id);
  if (n.status !== c.status) {
    addEvent(c.id, req.user.id, `Status: ${n.status}`, 'status');
    const ct = contactOf(n);
    sendMail(ct.email, `Ihr Fall ${n.no}: ${n.status}`, `Neuer Stand Ihres Falls: ${n.status}\n${BASE_URL}/app/`);
  }
  for (const [role, col] of Object.entries(PARTNER)) {
    if (n[col] && n[col] !== c[col]) {
      const p = userName(n[col]);
      addEvent(c.id, req.user.id, `${role[0].toUpperCase() + role.slice(1)} zugewiesen: ${p.name}`, 'sys');
      sendMail(p.email, `Neuer Auftrag ${n.no}`, `Ihnen wurde der Fall ${n.no} zugewiesen.\n${BASE_URL}/portal/#fall-${c.id}`);
    }
  }
  res.json({ ok: true });
});

app.post('/api/cases/:id/events', auth(), (req, res) => {
  const c = getCase(req.user, Number(req.params.id));
  if (!c) return err(res, 404, 'Fall nicht gefunden.');
  const text = str((req.body || {}).text, 4000);
  if (!text) return err(res, 400, 'Nachricht ist leer.');
  const internal = req.user.role === 'buero' && bool(req.body.internal) ? 1 : 0;
  addEvent(c.id, req.user.id, text, 'msg', internal);
  if (req.user.role !== 'buero') sendMail(OFFICE_EMAIL, `Nachricht zu ${c.no}`, `${req.user.name}: ${text}\n${BASE_URL}/portal/#fall-${c.id}`);
  else if (!internal) sendMail(contactOf(c).email, `Nachricht zu Ihrem Fall ${c.no}`, `${text}\n${BASE_URL}/app/`);
  res.json({ ok: true });
});

app.post('/api/cases/:id/files', auth(), upload.array('files', 20), (req, res) => {
  const c = getCase(req.user, Number(req.params.id));
  if (!c) { (req.files || []).forEach(f => fs.unlink(f.path, () => {})); return err(res, 404, 'Fall nicht gefunden.'); }
  if (!req.files?.length) return err(res, 400, 'Keine gültige Datei (erlaubt: Fotos, PDF, Video).');
  saveFiles(c.id, req.files, req.body.labels, req.user.id);
  addEvent(c.id, req.user.id, `${req.files.length} Datei(en) hochgeladen.`, 'sys');
  res.json({ ok: true });
});

app.get('/files/:id', auth(), (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id=?').get(Number(req.params.id));
  if (!f || !getCase(req.user, f.case_id)) return err(res, 404, 'Nicht gefunden.');
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.original || 'datei')}"`);
  fs.createReadStream(path.join(UPLOAD_DIR, path.basename(f.filename))).on('error', () => res.status(404).end()).pipe(res);
});

app.get('/api/export.csv', auth('buero', 'firma'), (req, res) => {
  const s = scope(req.user);
  const rows = db.prepare(`SELECT c.no,c.status,c.created,c.when_ts,COALESCE(u.name,c.guest_name) kunde,co.name firma,c.own_plate,c.type,c.place,c.opp_plate,c.opp_ins,c.fault,c.liability,c.claim_no,c.damage_amount,c.claim_amount,c.paid_amount,c.days_off,
      ex.name gutachter, la.name anwalt, ws.name werkstatt
    FROM cases c LEFT JOIN users u ON u.id=c.customer_id LEFT JOIN companies co ON co.id=c.company_id
    LEFT JOIN users ex ON ex.id=c.expert_id LEFT JOIN users la ON la.id=c.lawyer_id LEFT JOIN users ws ON ws.id=c.workshop_id
    WHERE ${s.sql} ORDER BY c.created DESC`).all(...s.args);
  const head = ['Fall', 'Status', 'Gemeldet', 'Unfallzeit', 'Kunde/Fahrer', 'Firma', 'Kennzeichen', 'Art', 'Ort', 'Gegner', 'Versicherung Gegner', 'Schuld (Angabe)', 'Haftung', 'Schaden-Nr.', 'Schaden €', 'Gefordert €', 'Bezahlt €', 'Ausfalltage', 'Gutachter', 'Anwalt', 'Werkstatt'];
  const d = ts => (ts ? new Date(ts).toLocaleString('de-DE') : '');
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [head.map(esc).join(';')].concat(rows.map(r => [r.no, r.status, d(r.created), d(r.when_ts), r.kunde, r.firma, r.own_plate, r.type, r.place, r.opp_plate, r.opp_ins, r.fault, r.liability, r.claim_no, r.damage_amount, r.claim_amount, r.paid_amount, r.days_off, r.gutachter, r.anwalt, r.werkstatt].map(esc).join(';')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="klarfall-faelle.csv"');
  res.send('﻿' + lines.join('\r\n'));
});

/* ------------------------------ Verwaltung (Büro) ------------------------------ */
app.get('/api/users', auth('buero'), (req, res) => {
  const rows = db.prepare(`SELECT u.id,u.email,u.name,u.phone,u.role,u.active,u.company_id,co.name company_name,u.created FROM users u LEFT JOIN companies co ON co.id=u.company_id ORDER BY u.role,u.name`).all();
  res.json({ users: rows });
});
app.get('/api/partners', auth('buero'), (req, res) => {
  res.json({ partners: db.prepare(`SELECT id,name,role FROM users WHERE role IN ('anwalt','gutachter','werkstatt','vermietung') AND active=1 ORDER BY name`).all() });
});
app.post('/api/users', auth('buero'), async (req, res) => {
  const { email, name, phone, role, company_id } = req.body || {};
  if (!ROLES.includes(role)) return err(res, 400, 'Ungültige Rolle.');
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || !str(name)) return err(res, 400, 'E-Mail und Name nötig.');
  if (['fahrer', 'firma'].includes(role) && !num(company_id)) return err(res, 400, 'Für Fahrer und Firmen bitte eine Firma wählen.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return err(res, 409, 'E-Mail existiert schon.');
  const pw = req.body.password && String(req.body.password).length >= 8 ? String(req.body.password) : crypto.randomBytes(6).toString('base64url');
  db.prepare('INSERT INTO users(email,pw_hash,name,phone,role,company_id,created) VALUES (?,?,?,?,?,?,?)').run(String(email).trim(), await bcrypt.hash(pw, 11), str(name, 120), str(phone, 40), role, num(company_id), now());
  sendMail(email, 'Ihr Zugang zu Klarfall', `Hallo ${name},\nIhr Zugang: ${email}\nPasswort: ${pw}\nAnmelden: ${BASE_URL}/${['kunde', 'fahrer'].includes(role) ? 'app' : 'portal'}/\nBitte Passwort nach dem ersten Login ändern.`);
  res.json({ ok: true, password: pw });
});
app.patch('/api/users/:id', auth('buero'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id && 'active' in (req.body || {}) && !bool(req.body.active)) return err(res, 400, 'Sie können sich nicht selbst sperren.');
  if ('active' in req.body) {
    db.prepare('UPDATE users SET active=? WHERE id=?').run(bool(req.body.active), id);
    if (!bool(req.body.active)) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  }
  res.json({ ok: true });
});
app.get('/api/companies', auth('buero'), (req, res) => {
  res.json({ companies: db.prepare(`SELECT co.id,co.name,(SELECT COUNT(*) FROM cases c WHERE c.company_id=co.id) cases,(SELECT COUNT(*) FROM users u WHERE u.company_id=co.id) users FROM companies co ORDER BY co.name`).all() });
});
app.post('/api/companies', auth('buero'), (req, res) => {
  const name = str((req.body || {}).name, 120);
  if (!name) return err(res, 400, 'Name nötig.');
  const r = db.prepare('INSERT INTO companies(name,created) VALUES (?,?)').run(name, now());
  res.json({ ok: true, id: r.lastInsertRowid });
});

/* ------------------------------ Seiten ------------------------------ */
app.use('/api', (req, res) => err(res, 404, 'Unbekannter Endpunkt.'));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use((e, req, res, next) => {
  console.error(e);
  if (e instanceof multer.MulterError) return err(res, 400, e.code === 'LIMIT_FILE_SIZE' ? 'Datei zu groß (max. 50 MB).' : 'Upload-Fehler.');
  err(res, 500, 'Serverfehler.');
});

// abgelaufene Sitzungen aufräumen
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires<?').run(now()), 3600e3).unref();

if (require.main === module) app.listen(PORT, () => console.log(`Klarfall läuft auf ${BASE_URL}`));
module.exports = app;
