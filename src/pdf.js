// Erstellt die unterschriebene Vollmacht als PDF
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const FONT = fs.readFileSync(path.join(__dirname, 'fonts', 'DejaVuSans.ttf'));
const FONT_B = fs.readFileSync(path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf'));
const TPL = path.join(__dirname, '..', 'config', 'vollmacht.txt');

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : '–'));
}

function readTemplate() {
  const lines = fs.readFileSync(TPL, 'utf8').split(/\r?\n/).filter(l => !l.startsWith('#'));
  let title = 'Vollmacht';
  const body = [];
  for (const l of lines) {
    if (l.startsWith('TITEL:')) title = l.slice(6).trim();
    else body.push(l);
  }
  const paras = body.join('\n').trim().split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  return { title, paras };
}

function wrap(text, font, size, width) {
  const words = text.split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) > width && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * @param vars Platzhalter für die Vorlage
 * @param signaturePng Buffer mit PNG der Unterschrift
 * @param meta { ts, ip, ua, place }
 */
async function makeVollmacht(vars, signaturePng, meta) {
  const { title, paras } = readTemplate();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = await doc.embedFont(FONT, { subset: true });
  const fb = await doc.embedFont(FONT_B, { subset: true });
  doc.setTitle(title); doc.setAuthor(vars.name || ''); doc.setCreator('Klarfall'); doc.setCreationDate(new Date(meta.ts));

  const W = 595.28, H = 841.89, M = 56, TW = W - 2 * M;
  let page = doc.addPage([W, H]), y = H - M;
  const need = h => { if (y - h < M + 40) { page = doc.addPage([W, H]); y = H - M; } };
  const text = (t, font, size, color = rgb(0.06, 0.09, 0.16)) => {
    for (const l of wrap(t, font, size, TW)) { need(size * 1.5); page.drawText(l, { x: M, y, size, font, color }); y -= size * 1.45; }
  };

  text(title, fb, 16); y -= 8;
  text(`Fall ${vars.fall} · erstellt am ${new Date(meta.ts).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`, f, 9, rgb(0.35, 0.39, 0.45)); y -= 10;
  for (const p of paras) { text(fill(p, vars), f, 10.5); y -= 8; }

  // Unterschrift
  need(140); y -= 10;
  const img = await doc.embedPng(signaturePng);
  const sw = Math.min(220, img.width), sh = sw * img.height / img.width;
  page.drawImage(img, { x: M, y: y - sh, width: sw, height: sh });
  y -= sh + 4;
  page.drawLine({ start: { x: M, y }, end: { x: M + 260, y }, thickness: 0.8, color: rgb(0.4, 0.4, 0.45) });
  y -= 14;
  text(`${vars.name} · ${meta.place || 'digital unterschrieben'}, ${new Date(meta.ts).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`, f, 10);

  // Prüfvermerk
  const hash = crypto.createHash('sha256').update(JSON.stringify({ vars, paras, sig: crypto.createHash('sha256').update(signaturePng).digest('hex'), ts: meta.ts })).digest('hex');
  y -= 12;
  text(`Elektronisch unterschrieben über Klarfall. Zeitpunkt: ${new Date(meta.ts).toISOString()} · IP: ${meta.ip || '–'} · Gerät: ${(meta.ua || '–').slice(0, 120)}`, f, 7.5, rgb(0.35, 0.39, 0.45));
  text(`Prüfsumme (SHA-256): ${hash}`, f, 7.5, rgb(0.35, 0.39, 0.45));

  const bytes = await doc.save();
  return { buffer: Buffer.from(bytes), hash, title };
}

function previewText(vars) {
  const { title, paras } = readTemplate();
  return { title, paras: paras.map(p => fill(p, vars)) };
}

module.exports = { makeVollmacht, previewText };
