/* English help content is canonical; staff-only content loads after staff sign-in. */
import {
  sections as rawSections,
  categories as rawCategories,
  articles as rawArticles,
  changelog as rawChangelog,
} from 'virtual:help-content';

export const changelog = rawChangelog;

/** Roles allowed to see `access: 'staff'` content. */
const STAFF_ROLES = new Set(['admin', 'manager', 'staff']);

export function isStaff(user) {
  return !!user && STAFF_ROLES.has(user.role);
}

const NO_STAFF_CONTENT = { sections: [], categories: [], articles: [], loaded: false };

let staffContent = NO_STAFF_CONTENT;
let staffRequest = null;
const staffListeners = new Set();

/** Whatever staff content has arrived. One stable identity until the chunk lands. */
export function getStaffContent() {
  return staffContent;
}

/** Once per session. The caller establishes that the reader is staff; this only knows how to load. */
export function loadStaffContent() {
  // Cleared on failure so a later attempt can retry — a dropped connection during
  // one render should not make the runbooks unreachable for the rest of the session.
  staffRequest ??= import('virtual:help-content-staff')
    .then((mod) => {
      staffContent = {
        sections: mod.sections,
        categories: mod.categories,
        articles: mod.articles,
        loaded: true,
      };
      staffListeners.forEach((notify) => notify());
    })
    .catch(() => { staffRequest = null; });
  return staffRequest;
}

export function onStaffContent(notify) {
  staffListeners.add(notify);
  return () => staffListeners.delete(notify);
}

const byOrder = (items) => items.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

/* `staff` is passed in rather than read from a module global, so the "may this reader have it"
   decision stays at one visible call site (lib/useHelp.js). */
export function helpTree(staff = NO_STAFF_CONTENT) {
  const sections = byOrder([...rawSections, ...staff.sections]);
  const sectionIds = new Set(sections.map((s) => s.id));
  const categories = byOrder([...rawCategories, ...staff.categories])
    .filter((c) => sectionIds.has(c.section));
  const categoryIds = new Set(categories.map((c) => c.id));
  const articles = [...rawArticles, ...staff.articles]
    .filter((a) => categoryIds.has(a.category))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return { sections, categories, articles };
}

export function getCategory(id, staff) {
  return helpTree(staff).categories.find((c) => c.id === id) || null;
}

export function articlesInCategory(id, staff) {
  return helpTree(staff).articles.filter((a) => a.category === id);
}

/** Featured articles for the landing page's "Start here" row. */
export function featuredArticles(limit = 6, staff) {
  const { articles } = helpTree(staff);
  const featured = articles.filter((a) => a.featured);
  return (featured.length ? featured : articles).slice(0, limit);
}

/** Previous/next within the same category, ordered as the sidebar is. */
export function articleNeighbours(article, staff) {
  if (!article) return { prev: null, next: null };
  const siblings = articlesInCategory(article.category, staff);
  const i = siblings.findIndex((a) => a.slug === article.slug);
  return {
    prev: i > 0 ? siblings[i - 1] : null,
    next: i >= 0 && i < siblings.length - 1 ? siblings[i + 1] : null,
  };
}

/* A scored substring match rather than a fuzzy index: the corpus is a few dozen articles, and
   exact substrings are more predictable for a help centre. */

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

export function searchHelp(query, opts = {}) {
  const q = (query || '').trim().toLowerCase();
  if (q.length < 2) return [];

  const terms = q.split(/\s+/).filter(Boolean);
  const { articles } = helpTree(opts.staff);
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

const FEEDBACK_KEY = 'dz_help_feedback_v1';

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

const RECENT_KEY = 'dz_help_recent_v1';
const RECENT_MAX = 5;

export function markViewed(slug) {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
    const next = [slug, ...list.filter((s) => s !== slug)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage unavailable — recents are a nicety, not a requirement */ }
}

export function recentArticles(staff) {
  let slugs = [];
  try {
    slugs = JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
  } catch { /* ignore */ }
  const { articles } = helpTree(staff);
  return slugs.map((s) => articles.find((a) => a.slug === s)).filter(Boolean);
}
