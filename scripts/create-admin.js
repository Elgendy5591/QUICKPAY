// Ersten Büro-Zugang anlegen:  npm run admin -- email@firma.de "Vorname Name" Passwort123
require('../src/env');
const bcrypt = require('bcryptjs');
const { db } = require('../src/db');

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password || password.length < 8) {
  console.log('Aufruf: npm run admin -- <email> "<Name>" <Passwort (min. 8 Zeichen)>');
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 11);
const ex = db.prepare('SELECT id FROM users WHERE email=?').get(email);
if (ex) {
  db.prepare("UPDATE users SET pw_hash=?, role='buero', active=1, name=? WHERE id=?").run(hash, name, ex.id);
  console.log('Bestehender Nutzer zum Büro-Admin gemacht:', email);
} else {
  db.prepare("INSERT INTO users(email,pw_hash,name,role,created) VALUES (?,?,?,'buero',?)").run(email, hash, name, Date.now());
  console.log('Büro-Admin angelegt:', email);
}
