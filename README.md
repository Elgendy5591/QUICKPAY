# Klarfall – Digitale Unfallabwicklung

Webseite, Kunden-/Fahrer-App und Portal für Büro, Firmen und Partner in einem Projekt.
Node.js + Express + SQLite, ohne Build-Schritt.

| Adresse | Für wen | Was |
|---|---|---|
| `/` | alle | Webseite mit Unfallmeldung ohne Konto, Flotten-Rechner, FAQ |
| `/app/` | Kunden, Fahrer | Konto, Unfall melden (Fotos, Sprache, GPS), Status, Nachrichten, Dokumente nachreichen. Als App auf dem Handy installierbar (PWA) |
| `/portal/` | Büro, Firmen, Kanzleien, Sachverständige, Werkstätten, Vermieter | Fälle, Bearbeitung, Zuweisung, Beträge, Nachrichten, Dateien, CSV-Export, Benutzer- und Firmenverwaltung |

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

## Auf GitHub hochladen

```bash
git init
git add .
git commit -m "Klarfall erste Version"
git branch -M main
git remote add origin https://github.com/<EUER-KONTO>/klarfall.git
git push -u origin main
```

`.env`, `data/` (Datenbank und Fotos) und `node_modules/` werden durch `.gitignore` nicht hochgeladen.

## Auf einen Server bringen

### Mit Docker (empfohlen)

```bash
git clone https://github.com/<EUER-KONTO>/klarfall.git && cd klarfall
cp .env.example .env          # BASE_URL, OFFICE_EMAIL, SMTP setzen
docker compose up -d --build
docker compose exec klarfall node scripts/create-admin.js buero@firma.de "Name" Passwort123
```

### HTTPS und Domain

Die App läuft auf Port 3000. Davor einen Reverse-Proxy mit HTTPS setzen, z. B. Caddy (`/etc/caddy/Caddyfile`):

```
klarfall.de, www.klarfall.de {
    reverse_proxy localhost:3000
}
```

Caddy holt das HTTPS-Zertifikat automatisch. Im DNS der Domain einen A-Eintrag auf die Server-IP setzen.
HTTPS ist Pflicht: ohne HTTPS funktionieren Kamera, Standort und die App-Installation auf dem Handy nicht.

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

## E-Mail-Benachrichtigungen

Mit SMTP-Daten in `.env` gehen automatisch E-Mails raus:
- an das Büro bei neuem Fall und bei Nachrichten von Kunden oder Partnern
- an Kunden bei Statusänderung und Nachrichten vom Büro
- an Partner bei Zuweisung eines Falls
- an neue Nutzer mit ihren Zugangsdaten

Ohne SMTP wird nur ins Log geschrieben. Code: `src/notify.js` (dort lassen sich auch SMS/WhatsApp ergänzen).

## Erste Schritte nach dem Start

1. Mit dem Büro-Zugang unter `/portal/` anmelden.
2. **Firmen** anlegen (z. B. eure eigene Flotte).
3. **Benutzer** anlegen: Fahrer (mit Firma), Firmen-Zugang, Kanzleien, Sachverständige, Werkstätten, Vermieter. Das Startpasswort wird angezeigt (und mit SMTP per E-Mail geschickt).
4. Fahrer öffnen `/app/` auf dem Handy, melden sich an und tippen im Browser „Zum Startbildschirm hinzufügen“.
5. Vor dem öffentlichen Start: Platzhalter ersetzen (Telefon, E-Mail, Adresse in `public/index.html`) und `public/impressum.html`, `public/datenschutz.html`, `public/garantie.html` ausfüllen.

## Projektstruktur

```
server.js              Server und komplette API
src/db.js              Datenbank-Schema
src/notify.js          E-Mail-Versand
src/env.js             liest .env
scripts/create-admin.js  Büro-Zugang anlegen
scripts/smoke-test.js    automatischer Test
public/index.html      Webseite
public/app/            Kunden-/Fahrer-App (PWA)
public/portal/         Portal Büro/Firma/Partner
public/assets/         gemeinsames CSS, JS, Icon
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

## Noch nicht enthalten (nächste Ausbaustufen)

- **Video-Gutachten live**: Anbieter wie Daily, Whereby oder Twilio Video einbinden. Bis dahin wählt der Kunde „Video“, das Büro vereinbart den Termin.
- **KI-Schadenerkennung**: Schnittstelle zu Audatex, DAT oder Tractable; Bilder liegen bereits strukturiert pro Fall vor.
- **SMS/WhatsApp, Push**: in `src/notify.js` ergänzen.
- **Digitale Vollmacht mit Signatur**: als nächster Schritt in der App.
- **Native Apps im App Store / Google Play**: die PWA kann z. B. mit Capacitor verpackt werden.
- **Mehrsprachigkeit**: Texte liegen bisher auf Deutsch vor.
