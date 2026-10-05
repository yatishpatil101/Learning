
/* English is the fallback for every user, so it is eager; Marathi/Hindi load on demand. */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { EAGER_NAMESPACES } from './namespaces.js';

/** Static imports keep the eager namespace list deliberate rather than folder-driven. */
import enAuth from './locales/en/auth.json';
import enChrome from './locales/en/chrome.json';
import enCommon from './locales/en/common.json';
import enHelp from './locales/en/help.json';
import enHome from './locales/en/home.json';
import enMisc1 from './locales/en/misc1.json';

const enShell = {};
for (const mod of [enAuth, enChrome, enCommon, enHelp, enHome, enMisc1]) {
  Object.assign(enShell, mod.default || mod);
}

const EAGER = new Set(EAGER_NAMESPACES);

const enLazyModules = import.meta.glob('./locales/en/*.json');

const inflight = new Map();

/** Ensure the given English namespaces are in the i18next store. */
export function loadNamespaces(namespaces) {
  const pending = [];
  for (const ns of namespaces) {
    if (EAGER.has(ns)) continue;
    let promise = inflight.get(ns);
    if (!promise) {
      const importer = enLazyModules[`./locales/en/${ns}.json`];
      if (!importer) {
        console.error(`[i18n] Unknown locale namespace "${ns}" — no locales/en/${ns}.json.`);
        continue;
      }
      promise = importer()
        .then((mod) => {
          // Deep merge, overwriting: namespaces may share a top-level key.
          i18n.addResourceBundle('en', 'translation', mod.default || mod, true, true);
        })
        .catch((err) => {
          console.error(`[i18n] Failed to load locale namespace "${ns}"`, err);
          inflight.delete(ns);
        });
      inflight.set(ns, promise);
    }
    pending.push(promise);
  }
  return Promise.all(pending).then(() => undefined);
}

i18n
  .use(initReactI18next)
  .init({
    resources: { en: { translation: enShell } },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });

export default i18n;
