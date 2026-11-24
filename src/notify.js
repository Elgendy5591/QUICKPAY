// E-Mail-Benachrichtigungen. Ohne SMTP-Einstellungen wird nur ins Log geschrieben.
// Später erweiterbar um SMS / WhatsApp (z. B. Twilio, MessageBird) und Push.
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

async function sendMail(to, subject, text) {
  if (!to) return;
  if (!transport) {
    console.log(`[mail] an ${to}: ${subject}`);
    return;
  }
  try {
    await transport.sendMail({ from: process.env.MAIL_FROM || 'Klarfall <noreply@example.com>', to, subject, text });
  } catch (e) {
    console.error('[mail] Fehler:', e.message);
  }
}

module.exports = { sendMail };
