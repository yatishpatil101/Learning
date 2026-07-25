/* App-wide i18n foundation (react-i18next).

   Language is a single, device-level preference persisted under the `pnLang`
   localStorage key, so the choice is permanent and applies before login — the
   same class of pref as reduce-motion. The language detector reads/caches
   `pnLang`; `changeLanguage()` (wired to the Settings dropdown) re-renders every
   `useTranslation()` consumer instantly, app-wide.

   Translations live in `locales/<lang>/<namespace>.json`.

   Loading strategy — English is bundled eagerly (it is the fallback for every
   user, so it must always be present and shouldn't cost an extra request on
   first paint). Marathi/Hindi are code-split and fetched on demand through a
   tiny in-module i18next backend, so a user only downloads the language they
   actually switch to. i18next awaits the backend before firing
   `languageChanged`, so switching never flashes untranslated keys. New surfaces
   are migrated by dropping a JSON file into each `locales/<lang>/` folder — no
   change needed here. Any not-yet-translated string falls back to English. */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

export const SUPPORTED_LANGS = ['en', 'mr', 'hi'];
export const LANG_STORAGE_KEY = 'pnLang';

// English: bundled eagerly (fallback for everyone) and merged into one namespace.
const enModules = import.meta.glob('./locales/en/*.json', { eager: true });
const enTranslation = {};
for (const mod of Object.values(enModules)) {
  Object.assign(enTranslation, mod.default || mod);
}

// Non-English: code-split, loaded on demand. Each entry is a lazy import().
const lazyModules = import.meta.glob(['./locales/*/*.json', '!./locales/en/*.json']);
const lazyByLang = {};
for (const [path, importer] of Object.entries(lazyModules)) {
  const match = path.match(/\.\/locales\/([^/]+)\/[^/]+\.json$/);
  if (!match) continue;
  const lang = match[1];
  (lazyByLang[lang] || (lazyByLang[lang] = [])).push(importer);
}

async function loadLanguage(lang) {
  const importers = lazyByLang[lang] || [];
  const mods = await Promise.all(importers.map((fn) => fn()));
  const merged = {};
  for (const mod of mods) Object.assign(merged, mod.default || mod);
  return merged;
}

// Minimal i18next backend: serves eager English synchronously, fetches the
// requested language's chunks otherwise.
const lazyBackend = {
  type: 'backend',
  init() {},
  read(language, _namespace, callback) {
    if (language === 'en') {
      callback(null, enTranslation);
      return;
    }
    loadLanguage(language)
      .then((data) => callback(null, data))
      .catch((err) => callback(err, false));
  },
};

i18n
  .use(lazyBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // English is present immediately; `partialBundledLanguages` tells i18next it
    // may still use the backend to load the languages that aren't bundled here.
    resources: { en: { translation: enTranslation } },
    partialBundledLanguages: true,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGS,
    nonExplicitSupportedLngs: true,
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANG_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });

export default i18n;
