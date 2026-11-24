// Gemeinsame Hilfsfunktionen für App und Portal
window.KF = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = n => (n == null || n === '' ? '–' : Number(n).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' €');
  const dt = ts => (ts ? new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
  const STATUS = ['Neu', 'In Prüfung', 'An Gutachter', 'An Anwalt', 'Versicherung prüft', 'Teilbezahlt', 'Bezahlt', 'Abgeschlossen', 'Eigene Schuld / Kasko', 'Abgelehnt'];
  const CLS = { 'Neu': 's0', 'In Prüfung': 's1', 'An Gutachter': 's2', 'An Anwalt': 's2', 'Versicherung prüft': 's1', 'Teilbezahlt': 's1', 'Bezahlt': 's3', 'Abgeschlossen': 's3', 'Eigene Schuld / Kasko': 's1', 'Abgelehnt': 's0' };
  const pill = s => `<span class="pill ${CLS[s] || 's1'}">${esc(s)}</span>`;
  async function api(url, opts = {}) {
    const o = { credentials: 'same-origin', ...opts };
    if (o.json !== undefined) { o.method = o.method || 'POST'; o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(o.json); delete o.json; }
    const res = await fetch(url, o);
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) { const e = new Error(data.error || 'Fehler ' + res.status); e.status = res.status; throw e; }
    return data;
  }
  // Fotos vor dem Hochladen verkleinern (spart Datenvolumen)
  const shrink = file => new Promise(res => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return res(file);
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 2000 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      c.toBlob(b => res(b ? new File([b], (file.name || 'foto').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(u); res(file); };
    img.src = u;
  });
  const fileGrid = (files, removable) => files.length ? `<div class="ph">${files.map((f, i) => {
    const isImg = /^image\//.test(f.mime || 'image/');
    const src = f.preview || `/files/${f.id}`;
    if (!f.id && !isImg) return `<figure><span class="doc">${esc(f.original || 'Datei')}</span><figcaption>${esc(f.label || '')}</figcaption>${removable ? `<button type="button" class="x" data-rm="${i}" aria-label="Entfernen">✕</button>` : ''}</figure>`;
    return `<figure>${isImg ?`<a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="${esc(f.label || 'Foto')}" loading="lazy"></a>` : `<a class="doc" href="/files/${f.id}?download=1">${esc(f.original || f.label || 'Datei')}</a>`}<figcaption>${esc(f.label || '')}</figcaption>${removable ? `<button type="button" class="x" data-rm="${i}" aria-label="Entfernen">✕</button>` : ''}</figure>`;
  }).join('')}</div>` : '';
  return { esc, eur, dt, STATUS, pill, api, shrink, fileGrid };
})();
