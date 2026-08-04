/* Help centre data access and search.
 *
 * The content itself is compiled at build time by scripts/vite-plugin-help-content.mjs
 * and exposed as the `virtual:help-content` module. This file is the only place that
 * imports it, so the rest of the app talks to plain functions rather than to the
 * shape of the compiled bundle.
 *
 * Language: English is canonical — it defines which articles exist, their category,
 * ordering and access. A translation overlays only the readable surface (title,
 * summary, body, headings, tags). An article with no translation in the reader's
 * language falls back to English rather than disappearing, because a half-populated
 * help centre that hides its own articles is worse than one that admits an article
 * is only available in English. `translated: false` on the result is what the
 * article page uses to say so.
 *
 * Access model: articles and categories carry `access: 'public' | 'staff'`. Staff
 * content is filtered out for everyone except internal accounts. This is a UX
 * boundary, not a security one — the same caveat that applies to every guard in
 * this prototype (see components/RouteGuards.jsx). Once there is a real backend,
 * staff docs must be served from a separate, authorised endpoint rather than
 * shipped in the client bundle and hidden.
 */

import {
  sections as rawSections,
  categories as rawCategories,
  articles as rawArticles,
  translations as rawTranslations,
  changelog as rawChangelog,
} from 'virtual:help-content';

export const changelog = rawChangelog;

/** Roles allowed to see `access: 'staff'` content. */
const STAFF_ROLES = new Set(['admin', 'manager', 'staff']);

export function isStaff(user) {
  return !!user && STAFF_ROLES.has(user.role);
}

const visible = (item, staff) => item.access !== 'staff' || staff;

/** Normalise an i18next language tag (`mr-IN`, `HI`) to a content language. */
function normalizeLang(lang) {
  const short = String(lang || 'en').toLowerCase().split('-')[0];
  return rawTranslations[short] ? short : 'en';
}

/** Overlay the translated surface onto the canonical English article. */
function localize(article, lang) {
  if (lang === 'en') return { ...article, translated: true, lang: 'en' };
  const t = rawTranslations[lang]?.[article.slug];
  if (!t) return { ...article, translated: false, lang: 'en' };
  return { ...article, ...t, translated: true, lang };
}

/** Pick the translated label for a section or category, falling back to English. */
function localizeTaxonomy(item, lang) {
  const t = lang !== 'en' && item.i18n ? item.i18n[lang] : null;
  return t ? { ...item, ...t } : item;
}

/**
 * Sections, categories and articles the given user is allowed to see, in the
 * given language.
 *
 * @param {object} user
 * @param {string} [lang] i18next language tag; defaults to English.
 */
export function helpTree(user, lang) {
  const L = normalizeLang(lang);
  const staff = isStaff(user);
  const sections = rawSections.filter((s) => visible(s, staff)).map((s) => localizeTaxonomy(s, L));
  const sectionIds = new Set(sections.map((s) => s.id));
  const categories = rawCategories
    .filter((c) => visible(c, staff) && sectionIds.has(c.section))
    .map((c) => localizeTaxonomy(c, L));
  const categoryIds = new Set(categories.map((c) => c.id));
  const articles = rawArticles
    .filter((a) => visible(a, staff) && categoryIds.has(a.category))
    .map((a) => localize(a, L));
  return { sections, categories, articles, lang: L };
}

export function getCategory(id, user, lang) {
  return helpTree(user, lang).categories.find((c) => c.id === id) || null;
}

export function articlesInCategory(id, user, lang) {
  return helpTree(user, lang).articles.filter((a) => a.category === id);
}

/** Featured articles for the landing page's "Start here" row. */
export function featuredArticles(user, lang, limit = 6) {
  const { articles } = helpTree(user, lang);
  const featured = articles.filter((a) => a.featured);
  return (featured.length ? featured : articles).slice(0, limit);
}

/**
 * Previous/next within the same category, so an article always offers a next step.
 * Ordering matches the sidebar, which is what a reader expects "next" to mean.
 */
export function articleNeighbours(article, user, lang) {
  if (!article) return { prev: null, next: null };
  const siblings = articlesInCategory(article.category, user, lang);
  const i = siblings.findIndex((a) => a.slug === article.slug);
  return {
    prev: i > 0 ? siblings[i - 1] : null,
    next: i >= 0 && i < siblings.length - 1 ? siblings[i + 1] : null,
  };
}

/* ── Search ──────────────────────────────────────────────────────────────────
   A scored substring match rather than a fuzzy index. The corpus is a few dozen
   articles, so an index would be more machinery than the problem needs — and an
   exact-substring match is more predictable for a help centre, where people
   usually type a word that is literally in the article.

   Search runs over the *localized* article, so a Marathi reader searching Marathi
   words hits the Marathi text. Articles with no translation keep their English
   body, which means an English query still finds them from any language — the
   desirable direction of leakage. */

const FIELD_WEIGHTS = [
  { key: 'title', weight: 12 },
  { key: 'summary', weight: 5 },
  { key: 'tags', weight: 4 },
  { key: 'headings', weight: 3 },
  { key: 'text', weight: 1 },
];

function fieldValue(article, key) {
  if (key === 'tags') return article.tags.join(' ');
  if (key === 'headings') return article.headings.map((h) => h.text).join(' ');
  return article[key] || '';
}

/* JavaScript's \b is defined against [A-Za-z0-9_], so it never fires next to a
   Devanagari character — a Marathi query would silently lose the whole-word
   bonus that ranks a title match above a passing mention in the body. Testing
   for a separator character instead works for both scripts. */
const SEPARATOR = /[\s.,;:!?()[\]{}"'—–\-/\\|]/;

function hasWordStart(haystack, term) {
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(term, from);
    if (i < 0) return false;
    if (i === 0 || SEPARATOR.test(haystack[i - 1])) return true;
    from = i + 1;
  }
}

/** Short excerpt around the first match, for the results list. */
export function excerptFor(article, query) {
  const text = article.text || '';
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return article.summary;
  const start = Math.max(0, i - 60);
  const end = Math.min(text.length, i + query.length + 100);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

/**
 * @param {string} query
 * @param {object} user
 * @param {{ limit?: number, lang?: string }} [opts]
 * @returns {Array<{ article: object, score: number }>}
 */
export function searchHelp(query, user, opts = {}) {
  const q = (query || '').trim().toLowerCase();
  if (q.length < 2) return [];

  const terms = q.split(/\s+/).filter(Boolean);
  const { articles } = helpTree(user, opts.lang);
  const results = [];

  for (const article of articles) {
    let score = 0;
    const haystacks = FIELD_WEIGHTS.map(({ key, weight }) => ({
      weight,
      text: fieldValue(article, key).toLowerCase(),
    }));

    for (const { weight, text } of haystacks) {
      if (!text) continue;
      for (const term of terms) {
        if (!text.includes(term)) continue;
        score += weight;
        if (hasWordStart(text, term)) score += weight / 2;
      }
    }
    // Every term must appear somewhere, so multi-word queries narrow rather than widen.
    const matchesAll = terms.every((term) => haystacks.some(({ text }) => text.includes(term)));
    if (score > 0 && matchesAll) results.push({ article, score });
  }

  results.sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title));
  return opts.limit ? results.slice(0, opts.limit) : results;
}

/* ── Article feedback ────────────────────────────────────────────────────────
   Stored locally for now. When the backend lands this becomes a POST; the shape
   below is what that endpoint should accept. */

const FEEDBACK_KEY = 'pn_help_feedback_v1';

function readFeedback() {
  try {
    return JSON.parse(localStorage.getItem(FEEDBACK_KEY)) || {};
  } catch {
    return {};
  }
}

export function getFeedback(slug) {
  return readFeedback()[slug] || null;
}

export function saveFeedback(slug, helpful, comment = '') {
  try {
    const all = readFeedback();
    all[slug] = { helpful, comment: comment.slice(0, 500), at: new Date().toISOString() };
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/* ── Recently viewed ─────────────────────────────────────────────────────── */

const RECENT_KEY = 'pn_help_recent_v1';
const RECENT_MAX = 5;

export function markViewed(slug) {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
    const next = [slug, ...list.filter((s) => s !== slug)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage unavailable — recents are a nicety, not a requirement */ }
}

export function recentArticles(user, lang) {
  let slugs = [];
  try {
    slugs = JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
  } catch { /* ignore */ }
  const { articles } = helpTree(user, lang);
  return slugs.map((s) => articles.find((a) => a.slug === s)).filter(Boolean);
}
