# Klarfall als Store-App (Android & iPhone)

Diese App ist eine Hülle (Capacitor) um die Web-App `/app/` auf eurem Server. Alles, was ihr am Server
ändert, ist sofort auch in der App – ein neuer Store-Upload ist nur für neue Icons, Namen oder Berechtigungen nötig.

Voraussetzung: Der Server läuft unter eurer Domain mit HTTPS (siehe Haupt-README).

## Einmalig einrichten

```bash
cd mobile
npm install
export KLARFALL_URL=https://eure-domain.de     # Windows: set KLARFALL_URL=...
export KLARFALL_APP_ID=de.eurefirma.klarfall    # eindeutige ID, später nicht mehr ändern
npm run add:android        # erzeugt Ordner android/
npm run add:ios            # nur auf einem Mac mit Xcode
npm run permissions        # Kamera, Standort, Mikrofon eintragen
npm run assets             # Icons und Startbild aus resources/ erzeugen
npm run sync
```

## Berechtigungen (macht `npm run permissions` automatisch)

Zur Kontrolle, das wird eingetragen:

**Android** – `android/app/src/main/AndroidManifest.xml`, innerhalb von `<manifest>`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

**iPhone** – `ios/App/App/Info.plist`, Texte nach Bedarf anpassen:

```xml
<key>NSCameraUsageDescription</key><string>Für Fotos vom Unfallschaden und den Video-Gutachter.</string>
<key>NSPhotoLibraryUsageDescription</key><string>Um vorhandene Fotos zum Unfall hochzuladen.</string>
<key>NSLocationWhenInUseUsageDescription</key><string>Um den Unfallort automatisch einzutragen.</string>
<key>NSMicrophoneUsageDescription</key><string>Für das Video-Gutachten.</string>
```

## Bauen und hochladen

- **Android:** `npm run android` öffnet Android Studio → *Build → Generate Signed Bundle* → `.aab` in der Google Play Console hochladen (Entwicklerkonto einmalig 25 $).
- **iPhone:** `npm run ios` öffnet Xcode → Team wählen → *Product → Archive* → *Distribute App* → App Store Connect (Apple-Entwicklerkonto 99 $/Jahr, Mac nötig).

## Gut zu wissen

- Der Videocall öffnet sich im Browser des Handys (Jitsi/Daily/Whereby funktionieren dort am zuverlässigsten).
- Spracheingabe (Diktieren) funktioniert in der Android-App; auf dem iPhone nutzen Kunden die Diktiertaste der Tastatur.
- Apple prüft Apps, die nur eine Webseite anzeigen, strenger. Klarfall nutzt Kamera, Standort, Unterschrift und Video – beschreibt diese Funktionen in der Store-Beschreibung und gebt Apple einen Test-Zugang (Kunden-Konto) für die Prüfung.
- Ohne Store geht es auch: Kunden öffnen `https://eure-domain.de/app/` und tippen auf „Zum Startbildschirm hinzufügen“. Das ist bereits eingerichtet (PWA).
