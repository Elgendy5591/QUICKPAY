// KI-Ersteinschätzung aus den Unfallfotos (Claude von Anthropic, Bild-Analyse).
// Ergebnis ist eine Hilfe für Büro und Gutachter – das Gutachten erstellt immer der Sachverständige.
const fs = require('fs');
const path = require('path');

const enabled = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.AI_MODEL || 'claude-sonnet-5-5';
const API = () => (process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com').replace(/\/$/, '');

const PROMPT = `Du unterstützt ein Unfallabwicklungs-Büro in Deutschland. Dir liegen Fotos eines Pkw-Unfallschadens und die Angaben des Kunden vor.
Erstelle eine vorsichtige Ersteinschätzung für den Sachverständigen. Erfinde nichts, was auf den Fotos nicht zu sehen ist.
Antworte NUR mit JSON in genau diesem Format:
{
 "teile": [{"teil": "z. B. Stoßfänger hinten", "schaden": "z. B. Riss, Delle, Kratzer", "massnahme": "erneuern | instandsetzen | lackieren | prüfen"}],
 "schwere": "gering | mittel | schwer",
 "kosten_von": Zahl in Euro (Reparatur netto, grobe Schätzung),
 "kosten_bis": Zahl in Euro,
 "totalschaden_moeglich": true/false,
 "video_reicht": true/false (reicht ein Video-Gutachten oder ist ein Vor-Ort-Termin nötig?),
 "versteckte_schaeden": "kurzer Hinweis, was nur vor Ort geprüft werden kann",
 "plausibel": true/false (passt der Schaden zur Unfallbeschreibung?),
 "auffaelligkeiten": ["z. B. Rost/Altschaden sichtbar, Fotos zeigen verschiedene Fahrzeuge, Bildbearbeitung vermutet"],
 "foto_qualitaet": "gut | ausreichend | schlecht",
 "fehlende_fotos": ["z. B. Kennzeichen Gegner, Gesamtansicht"],
 "zusammenfassung": "3–5 Sätze für Anwalt und Gutachter: Hergang laut Kunde und sichtbarer Schaden, sachlich."
}`;

async function analyse(c, files, uploadDir) {
  const imgs = files.filter(f => /^image\/(jpeg|png|webp|gif)$/.test(f.mime || '')).slice(0, 8);
  if (!imgs.length) throw new Error('Keine Fotos für die KI-Analyse.');
  const content = [];
  for (const f of imgs) {
    const buf = fs.readFileSync(path.join(uploadDir, path.basename(f.filename)));
    if (buf.length > 4.5 * 1024 * 1024) continue;
    content.push({ type: 'text', text: `Foto: ${f.label || 'ohne Bezeichnung'}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: f.mime, data: buf.toString('base64') } });
  }
  if (!content.length) throw new Error('Fotos zu groß für die KI-Analyse.');
  content.push({ type: 'text', text: `Angaben des Kunden:\nUnfallart: ${c.type}\nOrt: ${c.place || '–'}\nHergang: ${c.text || '–'}\nSchuld laut Kunde: ${c.fault || '–'}\n\n${PROMPT}` });

  const r = await fetch(`${API()}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL(), max_tokens: 1500, messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) throw new Error(`KI-Dienst ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('KI-Antwort ohne Ergebnis.');
  const out = JSON.parse(m[0]);
  out.modell = MODEL();
  return out;
}

module.exports = { enabled, analyse };
