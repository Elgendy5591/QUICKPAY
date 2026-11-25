// Die App lädt die Web-App direkt von eurem Server. So kommen Updates ohne neuen Store-Upload an.
// Vor dem Bauen setzen:  KLARFALL_URL=https://eure-domain.de  (ohne / am Ende)
const url = process.env.KLARFALL_URL || 'https://klarfall.example';

/** @type {import('@capacitor/cli').CapacitorConfig} */
module.exports = {
  appId: process.env.KLARFALL_APP_ID || 'de.klarfall.app',
  appName: 'Klarfall',
  webDir: 'www',
  server: {
    url: url + '/app/',
    cleartext: false,
    allowNavigation: [new URL(url).host],
    errorPath: 'offline.html',
  },
  android: { allowMixedContent: false },
  ios: { contentInset: 'always' },
};
