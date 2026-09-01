/**
 * Mock provider for the admin CMS.
 *
 * Reads and writes the four `db.*` collections directly, translating between the browser store's
 * field names and the server's on every crossing. The translation lives here rather than in the
 * page for the usual reason: this is the side with an expiry date, so it is the side that should
 * carry the awkwardness.
 *
 * ## What the mock cannot represent, and why it is faked rather than omitted
 *
 * The browser store has no `translations` column, no `severity`, no schedule window, no banner
 * `position` and no `image`. Those are emitted as empty/null rather than left off, so the page
 * renders identically in both modes and a missing field is never mistaken for a rendering bug. The
 * reverse - the store's `sub`, `cta`, `theme` and `audience` - is simply dropped: those have no
 * server column, no consumer surface ever read them, and carrying them here would let the console
 * keep offering fields that vanish the day the domain goes live.
 *
 * `createdAt` is stamped on create; existing seeded rows have none, and null is honest about that.
 */
import { rawLoad, rawSave, delay } from '../../../lib/mockApi/core.js';

/** The four managed lists, and the `db` key each lives under. Same word in both, but say it once. */
const COLLECTION = {
  announcements: 'announcements',
  services: 'services',
  faqs: 'faqs',
  banners: 'banners',
};

const collectionOf = (type) => {
  const coll = COLLECTION[type];
  if (!coll) throw new Error(`[adminContent] unknown content type "${type}"`);
  return coll;
};

/** Store row -> server `ContentItem`. Fields belonging to other types stay null, as on the wire. */
function toItem(type, row) {
  const base = {
    id: String(row.id),
    type,
    archived: !!row.archived,
    createdAt: row.createdAt ?? null,
    title: null,
    body: null,
    severity: null,
    startsAt: null,
    endsAt: null,
    active: null,
    name: null,
    icon: null,
    description: null,
    link: null,
    question: null,
    answer: null,
    category: null,
    image: null,
    headline: null,
    position: null,
    translations: row.translations ?? {},
  };
  switch (type) {
    case 'announcements':
      return { ...base, title: row.title ?? null, body: row.body ?? null, severity: row.severity ?? null, startsAt: row.startsAt ?? null, endsAt: row.endsAt ?? null, active: row.active ?? true };
    case 'services':
      return { ...base, name: row.name ?? null, icon: row.icon ?? null, description: row.description ?? row.desc ?? null, link: row.link ?? row.href ?? null };
    case 'faqs':
      // `q`/`a`/`cat` are the store's abbreviations. They stop here.
      return { ...base, question: row.question ?? row.q ?? null, answer: row.answer ?? row.a ?? null, category: row.category ?? row.cat ?? null };
    case 'banners':
      // The store's `title` is the closest thing it has to a headline; `sub`, `cta` and `theme`
      // have no server column and are deliberately not carried across.
      return { ...base, headline: row.headline ?? row.title ?? null, image: row.image ?? null, link: row.link ?? row.href ?? null, position: row.position ?? null };
    default:
      throw new Error(`[adminContent] unknown content type "${type}"`);
  }
}

/** Server write body -> store row patch. Only defined keys are applied, matching PATCH semantics. */
function toRowPatch(type, body) {
  const b = body || {};
  const patch = {};
  const put = (key, value) => { if (value !== undefined) patch[key] = value; };
  put('translations', b.translations);
  switch (type) {
    case 'announcements':
      put('title', b.title); put('body', b.body); put('severity', b.severity);
      put('startsAt', b.startsAt); put('endsAt', b.endsAt); put('active', b.active);
      break;
    case 'services':
      put('name', b.name); put('icon', b.icon); put('description', b.description); put('link', b.link);
      break;
    case 'faqs':
      put('question', b.question); put('answer', b.answer); put('category', b.category);
      break;
    case 'banners':
      put('headline', b.headline); put('image', b.image); put('link', b.link); put('position', b.position);
      break;
    default:
      throw new Error(`[adminContent] unknown content type "${type}"`);
  }
  return patch;
}

export async function listContent(type) {
  const coll = collectionOf(type);
  const rows = rawLoad()[coll] || [];
  return delay(rows.map((r) => toItem(type, r)));
}

export async function createContent(type, body) {
  const coll = collectionOf(type);
  const db = rawLoad();
  if (!Array.isArray(db[coll])) db[coll] = [];
  const row = {
    id: `${type[0]}${Date.now()}`,
    archived: false,
    createdAt: new Date().toISOString(),
    ...toRowPatch(type, body),
  };
  db[coll].push(row);
  rawSave(db);
  return delay(toItem(type, row));
}

export async function updateContent(type, id, body) {
  return mutateOne(type, id, (row) => Object.assign(row, toRowPatch(type, body)));
}

export async function archiveContent(type, id) {
  return mutateOne(type, id, (row) => { row.archived = true; row.archivedAt = new Date().toISOString(); });
}

export async function restoreContent(type, id) {
  return mutateOne(type, id, (row) => { row.archived = false; delete row.archivedAt; });
}

/**
 * Apply a change to one row and return it in server shape.
 *
 * Throws on a missing id rather than resolving with null, because that is what the API does (404),
 * and a caller that only breaks against one of the two providers is worse than one that breaks
 * against both.
 */
function mutateOne(type, id, apply) {
  const coll = collectionOf(type);
  const db = rawLoad();
  const row = (db[coll] || []).find((x) => String(x.id) === String(id));
  if (!row) throw new Error(`[adminContent] no ${type} row with id ${id}`);
  apply(row);
  rawSave(db);
  return delay(toItem(type, row));
}
