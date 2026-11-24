// Automatischer Test aller Rollen gegen eine frische Test-Datenbank.  Aufruf: npm test
const os = require('os'), path = require('path'), fs = require('fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'klarfall-test-'));
process.env.PORT = '0';
const bcrypt = require('bcryptjs');
const app = require('../server');
const { db } = require('../src/db');

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fails++; };

(async () => {
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const client = () => {
    let cookie = '';
    return async (url, opts = {}) => {
      const o = { ...opts, headers: { ...(opts.headers || {}), cookie } };
      if (opts.json) { o.method = o.method || 'POST'; o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(opts.json); }
      const r = await fetch(base + url, o);
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      const ct = r.headers.get('content-type') || '';
      return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
    };
  };
  db.prepare("INSERT INTO users(email,pw_hash,name,role,created) VALUES ('buero@test.de',?,'Büro','buero',?)").run(bcrypt.hashSync('geheim123', 4), Date.now());

  console.log('Büro');
  const office = client();
  ok((await office('/api/auth/login', { json: { email: 'buero@test.de', password: 'geheim123' } })).status === 200, 'Login Büro');
  const co = await office('/api/companies', { json: { name: 'Taxi Test GmbH' } });
  ok(co.body.id, 'Firma anlegen');
  const mk = async (role, email, extra = {}) => (await office('/api/users', { json: { role, email, name: role + ' Test', ...extra } })).body.password;
  const pw = {
    fahrer: await mk('fahrer', 'fahrer@test.de', { company_id: co.body.id }),
    firma: await mk('firma', 'firma@test.de', { company_id: co.body.id }),
    anwalt: await mk('anwalt', 'anwalt@test.de'),
    gutachter: await mk('gutachter', 'gutachter@test.de'),
  };
  ok(Object.values(pw).every(Boolean), 'Zugänge für Fahrer, Firma, Anwalt, Gutachter angelegt');

  console.log('Gast über Webseite');
  const guest = client();
  const fd = new FormData();
  fd.append('type', 'Vorfahrt'); fd.append('guest_name', 'Gast'); fd.append('guest_phone', '0301234');
  fd.append('photos', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'a.jpg'); fd.append('labels', 'Vorne');
  const g = await guest('/api/cases', { method: 'POST', body: fd });
  ok(g.status === 200 && g.body.no, 'Gast-Meldung mit Foto');
  ok((await guest('/api/cases')).status === 401, 'Gast kann keine Fallliste sehen');

  console.log('Fahrer');
  const drv = client();
  ok((await drv('/api/auth/login', { json: { email: 'fahrer@test.de', password: pw.fahrer } })).status === 200, 'Login Fahrer');
  const fd2 = new FormData(); fd2.append('type', 'Hinten aufgefahren (auf mich)'); fd2.append('own_plate', 'b-tx 1'); fd2.append('place', 'Kantstr.');
  const c = (await drv('/api/cases', { method: 'POST', body: fd2 })).body;
  ok(c.id, 'Fahrer meldet Unfall');
  const mine = (await drv('/api/cases')).body.cases;
  ok(mine.length === 1 && mine[0].own_plate === 'B-TX 1', 'Fahrer sieht nur eigenen Fall');
  ok((await drv('/api/cases/' + g.body.id)).status === 404, 'Fahrer sieht fremden Fall nicht');
  ok((await drv('/api/cases/' + c.id, { method: 'PATCH', json: { status: 'Bezahlt' } })).status === 403, 'Fahrer darf Status nicht ändern');

  console.log('Büro bearbeitet');
  const partners = (await office('/api/partners')).body.partners;
  const an = partners.find(p => p.role === 'anwalt'), gu = partners.find(p => p.role === 'gutachter');
  ok((await office('/api/cases/' + c.id, { method: 'PATCH', json: { status: 'An Gutachter', expert_id: gu.id, lawyer_id: an.id, claim_amount: 4200, paid_amount: 1000, note_internal: 'geheim' } })).status === 200, 'Status, Partner, Beträge gespeichert');
  ok((await office('/api/cases/' + c.id, { method: 'PATCH', json: { lawyer_id: gu.id } })).status === 400, 'Falscher Partner-Typ wird abgelehnt');
  await office(`/api/cases/${c.id}/events`, { json: { text: 'Nur intern', internal: true } });
  await office(`/api/cases/${c.id}/events`, { json: { text: 'Gutachter kommt morgen' } });
  ok((await office('/api/cases')).body.cases.length === 2, 'Büro sieht alle Fälle');
  ok((await office('/api/export.csv')).body.includes('An Gutachter'), 'CSV-Export');

  console.log('Fahrer sieht Stand');
  const d = (await drv('/api/cases/' + c.id)).body;
  ok(d.case.status === 'An Gutachter', 'Neuer Status sichtbar');
  ok(!('note_internal' in d.case), 'Interne Notiz verborgen');
  ok(!d.events.some(e => e.text === 'Nur intern') && d.events.some(e => e.text === 'Gutachter kommt morgen'), 'Interne Nachricht verborgen, normale sichtbar');

  console.log('Firma');
  const firm = client();
  await firm('/api/auth/login', { json: { email: 'firma@test.de', password: pw.firma } });
  const fc = (await firm('/api/cases')).body.cases;
  ok(fc.length === 1 && fc[0].id === c.id, 'Firma sieht nur Fälle ihrer Flotte');
  ok((await firm('/api/stats')).body.gefordert === 4200, 'Firma-Kennzahlen');

  console.log('Partner');
  const gut = client();
  await gut('/api/auth/login', { json: { email: 'gutachter@test.de', password: pw.gutachter } });
  ok((await gut('/api/cases')).body.cases.length === 1, 'Gutachter sieht zugewiesenen Fall');
  ok((await gut('/api/cases/' + g.body.id)).status === 404, 'Gutachter sieht anderen Fall nicht');
  const fd3 = new FormData(); fd3.append('files', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'gutachten.pdf'); fd3.append('labels', 'Gutachten');
  ok((await gut(`/api/cases/${c.id}/files`, { method: 'POST', body: fd3 })).status === 200, 'Gutachter lädt Gutachten hoch');
  const files = (await drv('/api/cases/' + c.id)).body.files;
  ok(files.some(f => f.label === 'Gutachten'), 'Fahrer sieht das Gutachten');
  ok((await drv('/files/' + files[0].id)).status === 200, 'Datei-Download mit Berechtigung');
  ok((await guest('/files/' + files[0].id)).status === 401, 'Datei-Download ohne Login gesperrt');

  console.log('Kunde (Selbstregistrierung)');
  const cust = client();
  ok((await cust('/api/auth/register', { json: { email: 'k@test.de', password: 'abcdefgh', name: 'Kunde' } })).status === 200, 'Registrierung');
  ok((await cust('/api/cases')).body.cases.length === 0, 'Neuer Kunde sieht keine fremden Fälle');
  ok((await cust('/api/users')).status === 403, 'Kunde hat keinen Admin-Zugriff');

  srv.close();
  console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : '\nAlle Tests bestanden');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
