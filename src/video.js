// Videoraum pro Fall. Anbieter über VIDEO_PROVIDER: jitsi | daily | whereby
const crypto = require('crypto');

const P = () => (process.env.VIDEO_PROVIDER || '').toLowerCase();
const b64u = b => Buffer.from(b).toString('base64url');

function enabled() {
  const p = P();
  if (p === 'jitsi') return !!process.env.JITSI_DOMAIN;
  if (p === 'daily') return !!process.env.DAILY_API_KEY;
  if (p === 'whereby') return !!process.env.WHEREBY_API_KEY;
  return false;
}

// JWT für Jitsi mit Token-Anmeldung (selbst betriebener Server, optional)
function jitsiJwt(room, user, moderator) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({
    aud: 'jitsi', iss: process.env.JITSI_APP_ID, sub: process.env.JITSI_DOMAIN, room,
    exp: now + 6 * 3600, nbf: now - 60,
    context: { user: { name: user.name, email: user.email || undefined, moderator: !!moderator } },
    moderator: !!moderator,
  }));
  const sig = crypto.createHmac('sha256', process.env.JITSI_APP_SECRET).update(head + '.' + body).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/**
 * Liefert den Link, mit dem `user` dem Raum des Falls beitritt.
 * `c` = Fall, `saveRoom(room)` speichert den Raum beim ersten Aufruf.
 */
async function joinUrl(c, user, saveRoom) {
  const p = P();
  const moderator = ['buero', 'gutachter', 'anwalt'].includes(user.role);
  if (p === 'jitsi') {
    let room = c.video_room;
    if (!room) { room = `klarfall-${c.no}-${crypto.randomBytes(6).toString('hex')}`.toLowerCase(); saveRoom(room); }
    const base = `https://${process.env.JITSI_DOMAIN}/${room}`;
    const cfg = `#userInfo.displayName=${encodeURIComponent('"' + user.name + '"')}&config.prejoinConfig.enabled=false`;
    if (process.env.JITSI_APP_ID && process.env.JITSI_APP_SECRET) return `${base}?jwt=${jitsiJwt(room, user, moderator)}${cfg}`;
    return base + cfg;
  }
  if (p === 'daily') {
    const api = (process.env.DAILY_API_URL || 'https://api.daily.co/v1').replace(/\/$/, '');
    const h = { Authorization: `Bearer ${process.env.DAILY_API_KEY}`, 'Content-Type': 'application/json' };
    let room = c.video_room;
    if (!room) {
      const r = await fetch(`${api}/rooms`, { method: 'POST', headers: h, body: JSON.stringify({ privacy: 'private', properties: { exp: Math.floor(Date.now() / 1000) + 30 * 86400, enable_prejoin_ui: false, lang: 'de' } }) });
      if (!r.ok) throw new Error('Daily: Raum konnte nicht erstellt werden (' + r.status + ')');
      const j = await r.json(); room = j.url; saveRoom(room);
    }
    const t = await fetch(`${api}/meeting-tokens`, { method: 'POST', headers: h, body: JSON.stringify({ properties: { room_name: room.split('/').pop(), user_name: user.name, is_owner: moderator, exp: Math.floor(Date.now() / 1000) + 6 * 3600 } }) });
    if (!t.ok) throw new Error('Daily: Zugang konnte nicht erstellt werden (' + t.status + ')');
    return `${room}?t=${(await t.json()).token}`;
  }
  if (p === 'whereby') {
    let room = c.video_room;
    if (!room) {
      const api = (process.env.WHEREBY_API_URL || 'https://api.whereby.dev/v1').replace(/\/$/, '');
      const r = await fetch(`${api}/meetings`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.WHEREBY_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ endDate: new Date(Date.now() + 30 * 864e5).toISOString(), fields: ['hostRoomUrl'], roomMode: 'normal' }) });
      if (!r.ok) throw new Error('Whereby: Raum konnte nicht erstellt werden (' + r.status + ')');
      const j = await r.json(); room = JSON.stringify({ guest: j.roomUrl, host: j.hostRoomUrl }); saveRoom(room);
    }
    const urls = JSON.parse(room);
    return moderator ? urls.host : urls.guest;
  }
  throw new Error('Videocall ist nicht eingerichtet (VIDEO_PROVIDER in .env).');
}

module.exports = { enabled, joinUrl, provider: P };
