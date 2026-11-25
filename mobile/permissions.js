// Trägt Kamera-, Standort- und Mikrofon-Berechtigungen in die nativen Projekte ein.
// Aufruf nach "npm run add:android" / "npm run add:ios":  npm run permissions
const fs = require('fs');
const path = require('path');

const am = path.join(__dirname, 'android/app/src/main/AndroidManifest.xml');
if (fs.existsSync(am)) {
  let x = fs.readFileSync(am, 'utf8');
  const perms = ['CAMERA', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS'];
  const add = perms.filter(p => !x.includes(`android.permission.${p}"`)).map(p => `    <uses-permission android:name="android.permission.${p}" />`).join('\n');
  if (add) { x = x.replace(/<\/manifest>\s*$/, add + '\n</manifest>\n'); fs.writeFileSync(am, x); }
  console.log('Android: Berechtigungen eingetragen.');
}

const plist = path.join(__dirname, 'ios/App/App/Info.plist');
if (fs.existsSync(plist)) {
  let x = fs.readFileSync(plist, 'utf8');
  const keys = {
    NSCameraUsageDescription: 'Für Fotos vom Unfallschaden und den Video-Gutachter.',
    NSPhotoLibraryUsageDescription: 'Um vorhandene Fotos zum Unfall hochzuladen.',
    NSLocationWhenInUseUsageDescription: 'Um den Unfallort automatisch einzutragen.',
    NSMicrophoneUsageDescription: 'Für das Video-Gutachten.',
  };
  const add = Object.entries(keys).filter(([k]) => !x.includes(`<key>${k}</key>`)).map(([k, v]) => `\t<key>${k}</key>\n\t<string>${v}</string>`).join('\n');
  if (add) { x = x.replace(/<dict>/, '<dict>\n' + add); fs.writeFileSync(plist, x); }
  console.log('iOS: Berechtigungstexte eingetragen.');
}
