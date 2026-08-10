/* App-wide i18n foundation (react-i18next).

   Language is a single, device-level preference persisted under the `pnLang`
   localStorage key, so the choice is permanent and applies before login — the
   same class of pref as reduce-motion. The language detector reads/caches
   `pnLang`; `changeLanguage()` (wired to the Settings dropdown) re-renders every
   `useTranslation()` consumer instantly, app-wide.

   Translations live in `locales/<lang>/<namespace>.json`.

   Loading strategy — two axes, and they are separate on purpose.

   *Across languages*: English is the fallback for every user, so it must always
   be present. Marathi/Hindi are code-split and fetched whole on demand through
   the tiny in-module backend below, so a user only downloads the language they
   actually switch to. i18next awaits the backend before firing
   `languageChanged`, so switching never flashes untranslated keys.

   *Within English* (D129): English is 253 KB raw across twenty namespaces, and
   bundling it whole put `services.json` (61 KB, read by one route family) on
   every visitor's critical path — the entry chunk grew with every feature that
   added a string, however well that feature was itself code-split. So only the
   shell namespaces are bundled here, and the rest are fetched by `lazyPage()`
   alongside the route chunk that needs them, inside the Suspense boundary the
   route already has. The route does not mount until its strings are in the
   store, so no translated label can paint as a raw key.

   `namespaces.js` declares which namespaces are eager, and
   `scripts/check-i18n-route-namespaces.mjs` proves from the import graph that
   every route asks for what it actually uses — including the static imports
   just below, which must match `EAGER_NAMESPACES` exactly.

   New surfaces are migrated by dropping a JSON file into each `locales/<lang>/`
   folder and naming it on the route that uses it. Any not-yet-translated string
   falls back to English. */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import { EAGER_NAMESPACES } from './namespaces.js';

/* Eager English — the app shell, plus the pages App.jsx imports synchronously
   (Home, Signin/Signup/StaffLogin). Static imports rather than a glob because
   the set is a deliberate list, not a folder. */
import enAuth from './locales/en/auth.json';
import enChrome from './locales/en/chrome.json';
import enCommon from './locales/en/common.json';
import enHelp from './locales/en/help.json';
import enHome from './locales/en/home.json';
import enMisc1 from './locales/en/misc1.json';

export const SUPPORTED_LANGS = ['en', 'mr', 'hi'];
export const LANG_STORAGE_KEY = 'pnLang';

/* Shallow merge is correct and load-bearing: each namespace file owns a distinct
   set of top-level keys, and the check script fails the build if two eager files
   ever claim the same one. */
const enShell = {};
for (const mod of [enAuth, enChrome, enCommon, enHelp, enHome, enMisc1]) {
  Object.assign(enShell, mod.default || mod);
}

const EAGER = new Set(EAGER_NAMESPACES);

// Deferred English: one chunk per namespace, pulled in by loadNamespaces().
const enLazyModules = import.meta.glob('./locales/en/*.json');

// Non-English: code-split, loaded whole on demand. Each entry is a lazy import().
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

/* One promise per namespace, kept for the life of the page: a namespace already
   in the store is never fetched twice, however many routes ask for it or how
   often the user navigates back to one. */
const inflight = new Map();

/**
 * Ensure the given English namespaces are in the i18next store.
 *
 * Always English, whatever the active language, because that is the fallback
 * chain: a key Marathi has not translated yet resolves against English, and a
 * fallback that is not loaded is not a fallback. Marathi/Hindi themselves arrive
 * whole through the backend below, so they need nothing here.
 *
 * Never rejects. A missing locale chunk (a stale index against a fresh deploy)
 * degrades that namespace's labels to raw keys on a page that still works;
 * rejecting would take the whole route down with it instead. The cache entry is
 * dropped so the next navigation retries.
 *
 * @param {string[]} namespaces
 * @returns {Promise<void>}
 */
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

// Minimal i18next backend: serves the eager English shell synchronously, fetches
// the requested language's chunks otherwise.
const lazyBackend = {
  type: 'backend',
  init() {},
  read(language, _namespace, callback) {
    if (language === 'en') {
      callback(null, enShell);
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
    // The English shell is present immediately; `partialBundledLanguages` tells
    // i18next it may still use the backend to load the languages that aren't
    // bundled here.
    resources: { en: { translation: enShell } },
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

/* Keep <html lang> in step with the active language.
 *
 * index.html ships `lang="en"` and nothing was updating it, so a Marathi user
 * got a document that still claimed to be English. That is not cosmetic:
 *
 *   - Screen readers pick their pronunciation rules from `lang`, and read
 *     Devanagari with English phonetics when it is wrong.
 *   - The browser's font fallback and line-breaking are language-sensitive.
 *   - `:lang()` selectors — used below for Devanagari line-height — never match.
 *
 * Set once at startup and again on every change, because `languageChanged` does
 * not fire for the initial detected language. */
function syncDocumentLang(lng) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = (lng || 'en').split('-')[0];
}

syncDocumentLang(i18n.resolvedLanguage || i18n.language);
i18n.on('languageChanged', syncDocumentLang);

export default i18n;
