// Automatischer Test aller Rollen gegen eine frische Test-Datenbank.  Aufruf: npm test
const os = require('os'), path = require('path'), fs = require('fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'klarfall-test-'));
process.env.PORT = '0';
const http = require('http');
const bcrypt = require('bcryptjs');
let app, db;

// Nachgebaute externe Dienste (KI, Twilio, Daily), damit der Test ohne echte Konten läuft
const calls = { ai: 0, twilio: [], daily: 0 };
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/messages') { calls.ai++; const j = JSON.parse(body); calls.aiImages = j.messages[0].content.filter(c => c.type === 'image').length;
      return res.end(JSON.stringify({ content: [{ type: 'text', text: '{"teile":[{"teil":"Stoßfänger hinten","schaden":"Delle","massnahme":"erneuern"}],"schwere":"mittel","kosten_von":2500,"kosten_bis":4000,"totalschaden_moeglich":false,"video_reicht":true,"plausibel":true,"auffaelligkeiten":[],"fehlende_fotos":["Kennzeichen Gegner"],"zusammenfassung":"Test."}' }] })); }
    if (req.url.includes('/Messages.json')) { calls.twilio.push(Object.fromEntries(new URLSearchParams(body))); return res.end('{"sid":"SM1"}'); }
    if (req.url === '/v1/rooms') { calls.daily++; return res.end('{"url":"https://test.daily.co/raum1","name":"raum1"}'); }
    if (req.url === '/v1/meeting-tokens') return res.end('{"token":"tok123"}');
    res.statusCode = 404; res.end('{}');
  });
});

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fails++; };

(async () => {
  await new Promise(r => mock.listen(0, r));
  const m = `http://127.0.0.1:${mock.address().port}`;
  Object.assign(process.env, { ANTHROPIC_API_KEY: 'test', ANTHROPIC_API_URL: m, TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_SMS_FROM: '+4930000', TWILIO_WHATSAPP_FROM: '+4930001', TWILIO_API_URL: m, VIDEO_PROVIDER: 'daily', DAILY_API_KEY: 'k', DAILY_API_URL: m + '/v1' });
  app = require('../server'); db = require('../src/db').db;
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

  console.log('Vollmacht');
  const { deflateSync } = require('zlib');
  const png = (() => { const w = 120, h = 60, raw = require("crypto").randomBytes((w * 4 + 1) * h); const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    for (let y = 0; y < h; y++) raw[y * (w * 4 + 1)] = 0;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); })();
  const sig = 'data:image/png;base64,' + png.toString('base64');
  ok((await drv('/api/cases/' + c.id + '/vollmacht')).body.paras?.length > 3, 'Vollmacht-Text mit Falldaten');
  ok((await drv('/api/cases/' + c.id + '/sign', { json: { signature: sig } })).status === 200, 'Fahrer unterschreibt Vollmacht');
  ok((await drv('/api/cases/' + c.id + '/sign', { json: { signature: sig } })).status === 409, 'Doppelt unterschreiben verhindert');
  const vf = (await office('/api/cases/' + c.id)).body.files.find(f => f.label === 'Vollmacht (unterschrieben)');
  const pdf = await fetch(`${base}/files/${vf.id}`, { headers: { cookie: '' } });
  ok(vf && vf.mime === 'application/pdf', 'Vollmacht-PDF im Fall gespeichert');
  const fdS = new FormData(); fdS.append('type', 'Vorfahrt'); fdS.append('guest_name', 'Şükrü Ğüneş'); fdS.append('guest_phone', '01701234567'); fdS.append('signature', sig);
  ok((await guest('/api/cases', { method: 'POST', body: fdS })).body.signed === true, 'Unterschrift direkt bei Meldung (mit türkischen Zeichen)');

  console.log('KI');
  const fdA = new FormData(); fdA.append('type', 'Spurwechsel'); fdA.append('photos', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'x.jpg'); fdA.append('labels', 'Hinten');
  const ca = (await drv('/api/cases', { method: 'POST', body: fdA })).body;
  await new Promise(r => setTimeout(r, 400));
  const ad = (await office('/api/cases/' + ca.id)).body.case;
  ok(calls.ai >= 1 && calls.aiImages === 1, 'Fotos an KI gesendet');
  ok(ad.ai && ad.ai.kosten_bis === 4000 && ad.ai_status === 'fertig', 'KI-Ergebnis im Fall (Büro)');
  const cd = (await drv('/api/cases/' + ca.id)).body.case;
  ok(cd.ai && cd.ai.kosten_von === 2500 && !cd.ai.zusammenfassung, 'Kunde sieht nur Kostenrahmen');

  console.log('Video');
  const v1 = await drv('/api/cases/' + c.id + '/video', { method: 'POST' });
  ok(v1.status === 200 && v1.body.url.startsWith('https://test.daily.co/raum1?t='), 'Daily-Raum für Fahrer');
  const v2 = await gut('/api/cases/' + c.id + '/video', { method: 'POST' });
  ok(v2.status === 200 && calls.daily === 1, 'Gutachter im selben Raum');
  ok((await firm('/api/cases/' + c.id + '/video', { method: 'POST' })).status === 403, 'Firma startet keinen Videocall');
  process.env.VIDEO_PROVIDER = 'jitsi'; process.env.JITSI_DOMAIN = 'meet.example.de'; process.env.JITSI_APP_ID = 'kf'; process.env.JITSI_APP_SECRET = 's';
  const vj = await office('/api/cases/' + ca.id + '/video', { method: 'POST' });
  ok(vj.body.url && vj.body.url.startsWith('https://meet.example.de/klarfall-') && vj.body.url.includes('jwt='), 'Jitsi mit Token');
  ok((await office('/api/cases/' + c.id, { method: 'PATCH', json: { video_at: '2026-12-01T10:00' } })).status === 200, 'Videotermin gesetzt');

  console.log('SMS & WhatsApp');
  calls.twilio = [];
  await drv('/api/me', { method: 'PATCH', json: { notify_channel: 'whatsapp', phone: '0170 1234567', lang: 'tr' } });
  await office('/api/cases/' + c.id, { method: 'PATCH', json: { status: 'An Anwalt' } });
  await new Promise(r => setTimeout(r, 200));
  const wa = calls.twilio.find(t => t.To === 'whatsapp:+491701234567');
  ok(wa && /yeni durumu/.test(wa.Body), 'WhatsApp an Fahrer auf Türkisch');
  calls.twilio = [];
  await guest('/api/cases', { method: 'POST', body: (() => { const f = new FormData(); f.append('type', 'Vorfahrt'); f.append('guest_name', 'G'); f.append('guest_phone', '0301234567'); return f; })() });
  await new Promise(r => setTimeout(r, 200));
  ok(calls.twilio.some(t => t.To === '+49301234567' && /eingegangen/.test(t.Body)), 'SMS-Bestätigung an Gast ohne E-Mail');

  srv.close(); mock.close();
  console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : '\nAlle Tests bestanden');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
