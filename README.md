# Klarfall – Digitale Unfallabwicklung

Webseite, Kunden-/Fahrer-App und Portal für Büro, Firmen und Partner in einem Projekt.
Node.js + Express + SQLite, ohne Build-Schritt.

| Adresse | Für wen | Was |
|---|---|---|
| `/` | alle | Webseite mit Unfallmeldung ohne Konto, Flotten-Rechner, FAQ – in 4 Sprachen |
| `/app/` | Kunden, Fahrer | Konto, Unfall melden (Fotos, Diktieren, GPS), digitale Vollmacht mit Unterschrift, Video-Gutachten, KI-Kostenschätzung, Status, Nachrichten, Dokumente nachreichen. Deutsch, Türkisch, Arabisch, Englisch. Als App installierbar (PWA) und für App Store / Google Play vorbereitet (`mobile/`) |
| `/portal/` | Büro, Firmen, Kanzleien, Sachverständige, Werkstätten, Vermieter | Fälle, Bearbeitung, Zuweisung, Beträge, Videotermine und Videocall, KI-Analyse, unterschriebene Vollmachten, Nachrichten, Dateien, CSV-Export, Benutzer- und Firmenverwaltung |

## Rollen

| Rolle | Sieht | Darf |
|---|---|---|
| `buero` | alle Fälle | alles: Status, Partner zuweisen, Beträge, interne Notizen, Benutzer und Firmen anlegen |
| `firma` | Fälle ihrer Firma | lesen, Nachrichten, Dateien, CSV-Export |
| `fahrer` | eigene Fälle | melden, Nachrichten, Dateien (Fall wird automatisch der Firma zugeordnet) |
| `kunde` | eigene Fälle | wie Fahrer, registriert sich selbst |
| `anwalt`, `gutachter`, `werkstatt`, `vermietung` | ihnen zugewiesene Fälle | lesen, Nachrichten, Dateien hochladen (z. B. Gutachten, Rechnung) |

Interne Notizen und als „intern“ markierte Nachrichten sieht nur das Büro.

## Lokal starten

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
cp .env.example .env          # Werte anpassen
npm run admin -- buero@firma.de "Vorname Name" EinSicheresPasswort
npm start                     # http://localhost:3000
npm test                      # automatischer Test aller Rollen
```

## Code auf GitHub

Der Code liegt in https://github.com/Elgendy5591/QUICKPAY (Branch `main`). Änderungen hochladen:

```bash
git add . && git commit -m "Beschreibung" && git push
```

`.env`, `data/` (Datenbank und Fotos) und `node_modules/` werden durch `.gitignore` nicht hochgeladen.

## Auf einen Server bringen

### Mit Docker (empfohlen) – inklusive HTTPS

Ihr braucht: einen Linux-Server (z. B. Hetzner CX22, ca. 5 € im Monat) mit Docker und eine Domain.

1. Im DNS der Domain zwei A-Einträge auf die Server-IP setzen: `eure-domain.de` und `www.eure-domain.de`.
2. Auf dem Server:

```bash
curl -fsSL https://get.docker.com | sh            # Docker installieren (einmalig)
git clone https://github.com/Elgendy5591/QUICKPAY.git klarfall && cd klarfall
cp .env.example .env
nano .env                                          # DOMAIN, BASE_URL, OFFICE_EMAIL, SMTP … eintragen
docker compose up -d --build
docker compose exec klarfall node scripts/create-admin.js buero@firma.de "Name" EinSicheresPasswort
```

Fertig: `https://eure-domain.de`. Caddy holt das HTTPS-Zertifikat automatisch (Ports 80 und 443 müssen offen sein).
HTTPS ist Pflicht: ohne HTTPS funktionieren Kamera, Standort und die App-Installation auf dem Handy nicht.

Updates einspielen:

```bash
cd klarfall && git pull && docker compose up -d --build
```

Logs ansehen: `docker compose logs -f klarfall`

### Ohne Docker

```bash
npm ci --omit=dev
NODE_ENV=production node server.js
```

Dauerhaft laufen lassen z. B. mit `pm2` oder einem systemd-Dienst.

## Daten und Backup

Alles liegt im Ordner `DATA_DIR` (Standard `./data`, bei Docker im Volume `klarfall-data`):
- `klarfall.db` – Datenbank
- `uploads/` – Fotos und Dokumente

Diesen Ordner täglich sichern, z. B.:

```bash
sqlite3 data/klarfall.db ".backup data/backup-$(date +%F).db"
tar czf backup-$(date +%F).tgz data/
```

## Zusatzfunktionen einschalten

Alles läuft auch ohne diese Konten. Jede Funktion schaltet sich ein, sobald die Werte in `.env` stehen (danach Server neu starten). Vorlage: `.env.example`.

| Funktion | Was ihr braucht | Werte in `.env` |
|---|---|---|
| **E-Mail** | SMTP-Zugang eures Mail-Anbieters | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` |
| **SMS** | Twilio-Konto mit Nummer oder Absendername | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` |
| **WhatsApp** | Twilio WhatsApp-Absender (Meta-Freigabe) und eine genehmigte Vorlage mit Variable `{{1}}` | `TWILIO_WHATSAPP_FROM`, `TWILIO_WA_TEMPLATE_SID` |
| **Video-Gutachten** | Jitsi (kostenlos, sofort), Daily.co oder Whereby | `VIDEO_PROVIDER` und `JITSI_DOMAIN` bzw. `DAILY_API_KEY` bzw. `WHEREBY_API_KEY` |
| **KI-Schadenerkennung** | API-Schlüssel von console.anthropic.com | `ANTHROPIC_API_KEY`, optional `AI_MODEL` |
| **Vollmacht** | nichts – Text in `config/vollmacht.txt` vor dem Start von eurem Anwalt prüfen lassen | `COMPANY_NAME` |

### Benachrichtigungen
- Büro: neuer Fall, Nachrichten von Kunden und Partnern (E-Mail).
- Kunden: Eingang der Meldung, Statusänderung, Nachricht vom Büro, Videotermin – **in ihrer Sprache** und über den Kanal, den sie in der App wählen (E-Mail, SMS oder WhatsApp). Klappt ein Kanal nicht, geht es per E-Mail, dann per SMS.
- Partner: Zuweisung eines Falls, Videotermin (E-Mail).

Ohne Zugangsdaten wird nur ins Log geschrieben. Code: `src/notify.js`.

### Digitale Vollmacht
Der Kunde unterschreibt in der App mit dem Finger – direkt beim Melden oder später im Fall. Der Server erzeugt daraus ein PDF mit Text, Unterschrift, Zeitpunkt, IP-Adresse, Gerät und einer Prüfsumme (SHA-256) und legt es beim Fall ab. Den Text ändert ihr in `config/vollmacht.txt` (Platzhalter in `{geschweiften Klammern}`, Erklärung oben in der Datei).

### Video-Gutachten
- **Jitsi**: `VIDEO_PROVIDER=jitsi`, `JITSI_DOMAIN=meet.jit.si` reicht zum Testen. Für den Betrieb eigener Jitsi-Server oder 8x8 JaaS mit `JITSI_APP_ID`/`JITSI_APP_SECRET` – dann bekommen Gutachter und Büro Moderatorrechte per Token.
- **Daily** / **Whereby**: Räume werden pro Fall automatisch angelegt.
- Büro trägt im Portal den Videotermin ein → Kunde und Gutachter werden benachrichtigt. Beide starten den Call mit einem Knopf im Fall.

### KI-Schadenerkennung
Sobald ein Fall Fotos hat, analysiert die KI sie im Hintergrund: betroffene Teile, Schwere, Kostenspanne, ob ein Video-Gutachten reicht, mögliche versteckte Schäden, Plausibilität zum Hergang, fehlende Fotos. Büro und Gutachter sehen alles im Portal und können die Analyse neu starten. Kunden sehen nur die Kostenspanne und welche Fotos noch fehlen. Die KI ist eine Ersteinschätzung und ersetzt kein Gutachten.

### Sprachen
App und Webseite: Deutsch, Türkisch, Arabisch (von rechts nach links), Englisch. Texte: `public/assets/i18n-app.js` und `public/assets/i18n-site.js`. Das Portal ist auf Deutsch. Die Vollmacht ist rechtlich auf Deutsch; Kunden sehen dazu einen Hinweis in ihrer Sprache.

### App Store und Google Play
Siehe `mobile/README.md`. Kurz: `cd mobile && npm install`, Domain setzen, `npm run add:android` und/oder `npm run add:ios`, dann in Android Studio bzw. Xcode bauen und hochladen.

## Erste Schritte nach dem Start

1. Mit dem Büro-Zugang unter `/portal/` anmelden.
2. **Firmen** anlegen (z. B. eure eigene Flotte).
3. **Benutzer** anlegen: Fahrer (mit Firma), Firmen-Zugang, Kanzleien, Sachverständige, Werkstätten, Vermieter. Das Startpasswort wird angezeigt (und mit SMTP per E-Mail geschickt).
4. Fahrer öffnen `/app/` auf dem Handy, melden sich an und tippen im Browser „Zum Startbildschirm hinzufügen“ – oder installieren die Store-App.
5. Vor dem öffentlichen Start: Platzhalter ersetzen (Telefon, E-Mail, Adresse in `public/index.html`), `public/impressum.html`, `public/datenschutz.html`, `public/garantie.html` ausfüllen und `config/vollmacht.txt` anpassen.

## Projektstruktur

```
server.js              Server und komplette API
src/db.js              Datenbank-Schema
src/notify.js          E-Mail, SMS, WhatsApp (Texte in 4 Sprachen)
src/pdf.js             Vollmacht als PDF mit Unterschrift
src/video.js           Videoräume (Jitsi, Daily, Whereby)
src/ai.js              KI-Schadenerkennung
src/env.js             liest .env
config/vollmacht.txt   Text der Vollmacht
src/fonts/             Schrift für das PDF (DejaVu, freie Lizenz)
scripts/create-admin.js  Büro-Zugang anlegen
scripts/smoke-test.js    automatischer Test
public/index.html      Webseite
public/app/            Kunden-/Fahrer-App (PWA)
public/portal/         Portal Büro/Firma/Partner
public/assets/         gemeinsames CSS, JS, Übersetzungen, Icons
mobile/                App-Store-/Play-Store-Projekt (Capacitor)
```

## API (Kurzüberblick)

| Methode | Pfad | Wer |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | alle |
| GET | `/api/me` | angemeldet |
| POST | `/api/cases` (multipart, Feld `photos`) | Gast oder angemeldet |
| GET | `/api/cases`, `/api/cases/:id`, `/api/stats` | je nach Rolle gefiltert |
| PATCH | `/api/cases/:id` | Büro |
| POST | `/api/cases/:id/events`, `/api/cases/:id/files` | Beteiligte |
| GET | `/files/:id` | Beteiligte |
| GET | `/api/export.csv` | Büro, Firma |
| GET/POST/PATCH | `/api/users`, `/api/companies`, `/api/partners` | Büro |
| PATCH | `/api/me` (Sprache, Kanal, Telefon) | angemeldet |
| GET | `/api/config` (welche Zusatzfunktionen aktiv sind) | alle |
| GET | `/api/vollmacht-vorlage`, `/api/cases/:id/vollmacht` | Vorschau des Textes |
| POST | `/api/cases/:id/sign` (`signature` als PNG-Data-URL) | Kunde, Fahrer, Büro |
| POST | `/api/cases/:id/video` | Kunde, Fahrer, Büro, Gutachter, Anwalt |
| POST | `/api/cases/:id/ai` | Büro, Gutachter |

## Tests

```bash
npm test
```
Auf GitHub laufen die Tests und ein Docker-Build automatisch bei jedem Upload (Reiter *Actions*).
Startet den Server mit einer Testdatenbank und prüft Anmeldung, Rechte, Fälle, Dateien, Vollmacht-PDF, Video, KI und SMS/WhatsApp (externe Dienste werden dabei simuliert).
