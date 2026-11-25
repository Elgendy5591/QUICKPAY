// Benachrichtigungen: E-Mail (Brevo-API oder SMTP), SMS und WhatsApp (Twilio).
// Brevo nutzen, wo SMTP gesperrt ist (z. B. Railway Trial/Hobby).
// Ohne Zugangsdaten wird nur ins Log geschrieben.
let transport = null;
if (process.env.SMTP_HOST) {
  const nodemailer = require('nodemailer');
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

const brevoReady = () => !!process.env.BREVO_API_KEY;
function parseFrom(v) {
  const m = String(v || '').match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].replace(/^"|"$/g, '') || 'Klarfall', email: m[2] } : { name: 'Klarfall', email: String(v || '').trim() };
}
async function sendMail(to, subject, text) {
  if (!to) return false;
  if (brevoReady()) {
    try {
      const api = (process.env.BREVO_API_URL || 'https://api.brevo.com').replace(/\/$/, '');
      const r = await fetch(api + '/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: parseFrom(process.env.MAIL_FROM), to: [{ email: to }], subject, textContent: text }),
      });
      if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 200));
      return true;
    } catch (e) { console.error('[mail] Brevo-Fehler:', e.message); return false; }
  }
  if (!transport) { console.log(`[mail] an ${to}: ${subject}`); return false; }
  try { await transport.sendMail({ from: process.env.MAIL_FROM || 'Klarfall <noreply@example.com>', to, subject, text }); return true; }
  catch (e) { console.error('[mail] Fehler:', e.message); return false; }
}

// Telefonnummer ins internationale Format (+49…) bringen
function e164(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/[^\d+]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  else if (p.startsWith('0')) p = (process.env.DEFAULT_COUNTRY_CODE || '+49') + p.slice(1);
  else if (!p.startsWith('+')) p = (process.env.DEFAULT_COUNTRY_CODE || '+49') + p;
  return /^\+\d{8,15}$/.test(p) ? p : null;
}

const twilioReady = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
async function twilio(params) {
  const api = (process.env.TWILIO_API_URL || 'https://api.twilio.com').replace(/\/$/, '');
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const r = await fetch(`${api}/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return true;
}

async function sendSMS(phone, text) {
  const to = e164(phone);
  if (!to) return false;
  if (!twilioReady() || !process.env.TWILIO_SMS_FROM) { console.log(`[sms] an ${to}: ${text.slice(0, 60)}`); return false; }
  try { return await twilio({ To: to, From: process.env.TWILIO_SMS_FROM, Body: text.slice(0, 600) }); }
  catch (e) { console.error('[sms] Fehler:', e.message); return false; }
}

// WhatsApp: Nachrichten, die wir zuerst schicken, brauchen eine von Meta freigegebene Vorlage
// (TWILIO_WA_TEMPLATE_SID, Variablen {{1}} = Fallnummer, {{2}} = Text). Ohne Vorlage wird frei
// gesendet – das stellt WhatsApp nur zu, wenn der Kunde in den letzten 24 Std. geschrieben hat.
async function sendWhatsApp(phone, text, vars = {}) {
  const to = e164(phone);
  if (!to) return false;
  if (!twilioReady() || !process.env.TWILIO_WHATSAPP_FROM) { console.log(`[whatsapp] an ${to}: ${text.slice(0, 60)}`); return false; }
  const base = { To: 'whatsapp:' + to, From: 'whatsapp:' + process.env.TWILIO_WHATSAPP_FROM.replace(/^whatsapp:/, '') };
  try {
    if (process.env.TWILIO_WA_TEMPLATE_SID) return await twilio({ ...base, ContentSid: process.env.TWILIO_WA_TEMPLATE_SID, ContentVariables: JSON.stringify({ 1: vars.no || '', 2: text.slice(0, 500) }) });
    return await twilio({ ...base, Body: text.slice(0, 1500) });
  } catch (e) {
    console.error('[whatsapp] Fehler:', e.message);
    return false;
  }
}

const channels = () => ({ email: !!transport || brevoReady(), sms: twilioReady() && !!process.env.TWILIO_SMS_FROM, whatsapp: twilioReady() && !!process.env.TWILIO_WHATSAPP_FROM });

// Kurze Texte für Kunden in ihrer Sprache
const T = {
  de: { received: n => `Klarfall: Ihre Unfallmeldung ${n} ist eingegangen. Wir melden uns kurzfristig.`, status: (n, s) => `Klarfall: Neuer Stand Ihres Falls ${n}: ${s}.`, msg: n => `Klarfall: Neue Nachricht zu Ihrem Fall ${n}.`, video: (n, t) => `Klarfall: Videotermin für Fall ${n}: ${t}.`, open: 'Öffnen' },
  tr: { received: n => `Klarfall: ${n} numaralı kaza bildiriminiz alındı. En kısa sürede size dönüş yapacağız.`, status: (n, s) => `Klarfall: ${n} numaralı dosyanızın yeni durumu: ${s}.`, msg: n => `Klarfall: ${n} numaralı dosyanız için yeni mesaj var.`, video: (n, t) => `Klarfall: ${n} dosyası için görüntülü görüşme: ${t}.`, open: 'Aç' },
  ar: { received: n => `Klarfall: تم استلام بلاغ الحادث رقم ${n}. سنتواصل معك قريبًا.`, status: (n, s) => `Klarfall: الحالة الجديدة لملفك ${n}: ${s}.`, msg: n => `Klarfall: رسالة جديدة بخصوص ملفك ${n}.`, video: (n, t) => `Klarfall: موعد مكالمة الفيديو للملف ${n}: ${t}.`, open: 'فتح' },
  en: { received: n => `Klarfall: Your accident report ${n} has been received. We will contact you shortly.`, status: (n, s) => `Klarfall: New status of your case ${n}: ${s}.`, msg: n => `Klarfall: New message about your case ${n}.`, video: (n, t) => `Klarfall: Video appointment for case ${n}: ${t}.`, open: 'Open' },
};

/**
 * Kunde benachrichtigen, auf dem Kanal, den er gewählt hat (Standard: E-Mail, sonst SMS).
 * contact = { name, email, phone, channel, lang }
 */
async function notifyCustomer(contact, kind, args, link) {
  if (!contact) return;
  const t = T[contact.lang] || T.de;
  const text = t[kind](...args) + (link ? `\n${t.open}: ${link}` : '');
  const subject = t[kind](...args).replace(/^Klarfall: /, '').slice(0, 120);
  const ch = contact.channel || (contact.email ? 'email' : 'sms');
  let sent = false;
  if (ch === 'whatsapp') sent = await sendWhatsApp(contact.phone, text, { no: args[0] });
  else if (ch === 'sms') sent = await sendSMS(contact.phone, text);
  if (!sent && contact.email) sent = await sendMail(contact.email, subject, text);
  if (!sent && ch === 'email' && contact.phone && channels().sms) sent = await sendSMS(contact.phone, text);
  return sent;
}

module.exports = { sendMail, sendSMS, sendWhatsApp, notifyCustomer, channels, e164 };
