/* Help Markdown is compiled at build time so no Markdown parser ships to the browser; staff runbooks
   compile into a separate chunk. Article HTML is injected raw on the client, so the renderer below
   drops raw HTML in Markdown deliberately. */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { Marked } from 'marked';

const VIRTUAL_ID = 'virtual:help-content';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
const STAFF_VIRTUAL_ID = 'virtual:help-content-staff';
const STAFF_RESOLVED_ID = '\0' + STAFF_VIRTUAL_ID;

// Adding a language here also obliges HelpFeedbackCreate's @Pattern("en|hi|mr") and the
// help_article_feedback lang CHECK, or feedback is rejected for that language alone.
const LANGS = ['hi', 'mr'];

/* GitHub-style callouts: > [!NOTE] / [!TIP] / [!WARNING] / [!IMPORTANT] */
const CALLOUTS = {
  NOTE: { icon: 'info', label: 'Note' },
  TIP: { icon: 'lightbulb', label: 'Tip' },
  WARNING: { icon: 'warning', label: 'Heads up' },
  IMPORTANT: { icon: 'shield-check', label: 'Important' },
};

/* Devanagari (U+0900–U+097F) is kept: stripping to [a-z0-9] reduced every Hindi and Marathi heading
   to an empty slug. Browsers percent-encode non-ASCII fragments and getElementById matches the raw string. */
const SLUG_KEEP = /[^a-z0-9\u0900-\u097F]+/g;

function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    // Drop apostrophes rather than turning them into separators, so "owner's"
    // becomes `owners` and not `owner-s`.
    .replace(/['’‘]/g, '')
    // Devanagari danda and double danda are sentence punctuation, not letters.
    .replace(/[।॥]/g, ' ')
    .replace(SLUG_KEEP, '-')
    .replace(/(^-|-$)/g, '');
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

/* Marked escapes text for HTML output, so the derived plain text has to be decoded again —
   otherwise a heading reads "I&#39;m" and anchors to `i-39-m`. */
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/* Supports only the frontmatter subset the help content uses; a full YAML parser would be
   another dependency for no gain. */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      value = value.replace(/^['"]|['"]$/g, '');
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (value !== '' && !Number.isNaN(Number(value))) value = Number(value);
    }
    data[key] = value;
  }
  return { data, body: match[2] };
}

/** Strip HTML tags, decode entities and collapse whitespace — the search haystack. */
function toPlainText(html) {
  return decodeEntities(
    html
      .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/* A fresh Marked instance per file keeps the heading collector isolated. */
function createRenderer(headings) {
  const marked = new Marked({ gfm: true, breaks: false });
  const seen = new Map();

  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const plain = toPlainText(text);
        let id = slugify(plain);
        const count = seen.get(id) || 0;
        seen.set(id, count + 1);
        if (count) id = `${id}-${count + 1}`;
        // Only h2/h3 land in the table of contents — deeper levels are detail.
        if (depth === 2 || depth === 3) headings.push({ id, text: plain, level: depth });
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      blockquote({ tokens }) {
        const inner = this.parser.parse(tokens);
        const alert = inner.match(/^\s*<p>\s*\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*(?:<br\s*\/?>)?\s*/i);
        if (!alert) return `<blockquote>${inner}</blockquote>\n`;
        const kind = alert[1].toUpperCase();
        const { icon, label } = CALLOUTS[kind];
        const body = inner.replace(alert[0], '<p>');
        return `<div class="doc-callout doc-callout--${kind.toLowerCase()}" data-icon="${icon}">`
          + `<p class="doc-callout__label">${label}</p>${body}</div>\n`;
      },
      // Raw HTML in Markdown is dropped so pasted untrusted text can never introduce a script tag.
      html() { return ''; },
      // marked v15 removed its built-in sanitizer, so an unguarded `[x](javascript:…)` would render
      // a live script-executing anchor. Anything outside the allowlist becomes an inert '#'.
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const safe = /^(https?:|mailto:|tel:|\/|#)/i.test(href || '') ? href : '#';
        return `<a href="${safe}"${title ? ` title="${title}"` : ''}>${text}</a>`;
      },
    },
  });

  return marked;
}

function walkMarkdown(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkMarkdown(full, base, out);
    else if (entry.endsWith('.md')) out.push({ full, rel: relative(base, full).split(sep).join('/') });
  }
  return out;
}

function compileMarkdown(full, rel) {
  const { data, body } = parseFrontmatter(readFileSync(full, 'utf-8'));
  const headings = [];
  const html = createRenderer(headings).parse(body.trim());
  const text = toPlainText(html);
  return { data, html, text, headings, rel };
}

/* English defines the article set; a `<slug>.<lang>.md` sibling contributes only title, summary, body
   and headings, so a translation can never re-categorise an article or expose a staff runbook. */
function compileArticles(contentDir) {
  const files = walkMarkdown(contentDir);
  const articles = [];
  const translations = Object.fromEntries(LANGS.map((l) => [l, {}]));

  const langOf = (rel) => {
    const m = rel.match(/\.([a-z]{2})\.md$/);
    return m && LANGS.includes(m[1]) ? m[1] : null;
  };
  const baseSlug = (rel) => rel.replace(/(\.[a-z]{2})?\.md$/, '').split('/').pop();

  for (const { full, rel } of files) {
    if (langOf(rel)) continue; // handled in the second pass
    const { data, html, text, headings } = compileMarkdown(full, rel);
    const fileSlug = baseSlug(rel);
    const dirCategory = rel.includes('/') ? rel.split('/')[0] : 'general';

    articles.push({
      slug: data.slug || fileSlug,
      title: data.title || fileSlug,
      summary: data.summary || text.slice(0, 160),
      category: data.category || dirCategory,
      audience: data.audience || 'everyone',
      access: data.access === 'staff' ? 'staff' : 'public',
      order: typeof data.order === 'number' ? data.order : 999,
      updated: data.updated ? String(data.updated) : '',
      readMinutes: Math.max(1, Math.round(text.split(' ').length / 200)),
      featured: data.featured === true,
      tags: Array.isArray(data.tags) ? data.tags : [],
      headings,
      html,
      text: text.slice(0, 4000),
    });
  }

  const bySlug = new Map(articles.map((a) => [a.slug, a]));

  for (const { full, rel } of files) {
    const lang = langOf(rel);
    if (!lang) continue;
    const slug = baseSlug(rel);
    const english = bySlug.get(slug);
    if (!english) {
      throw new Error(`help content: ${rel} translates "${slug}", which has no English source.`);
    }
    const { data, html, text, headings } = compileMarkdown(full, rel);
    const stale = data.sourceStale === true;
    if (!stale) assertInSync(rel, data, english);
    translations[lang][slug] = {
      title: data.title || english.title,
      summary: data.summary || text.slice(0, 160),
      // Translated tags let a Marathi reader find the article using Marathi words.
      tags: Array.isArray(data.tags) ? data.tags : english.tags,
      readMinutes: Math.max(1, Math.round(text.split(' ').length / 200)),
      stale,
      headings,
      html,
      text: text.slice(0, 4000),
    };
  }

  articles.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return { articles, translations };
}

/* The pin is a date rather than a body hash because `updated:` is the field authors already maintain;
   a guard nobody can satisfy by hand gets disabled. It makes drift visible, it cannot prove a retranslation. */
function assertInSync(rel, data, english) {
  const expected = english.updated;
  if (!expected) {
    throw new Error(
      `help content: ${rel} has a translation but "${english.slug}" has no \`updated:\` to pin it to. `
      + 'Add `updated: YYYY-MM-DD` to the English article.',
    );
  }
  const pinned = data.sourceUpdated ? String(data.sourceUpdated) : '';
  if (pinned === expected) return;
  throw new Error(
    `help content: ${rel} is pinned to \`sourceUpdated: ${pinned || '(missing)'}\` but its English `
    + `source was updated ${expected}. Re-read the English article, bring this one into line and set `
    + `\`sourceUpdated: ${expected}\` — or add \`sourceStale: true\` to ship it behind on purpose.`,
  );
}

/* Access is inherited downwards — a staff category makes its articles staff, a staff section its
   categories — because this flag decides which chunk the text is compiled into. */
function splitByAccess({ sections, categories, articles, translations }) {
  const staffSections = new Set(sections.filter((s) => s.access === 'staff').map((s) => s.id));
  const categoryIsStaff = (c) => c.access === 'staff' || staffSections.has(c.section);
  const staffCategories = new Set(categories.filter(categoryIsStaff).map((c) => c.id));
  const articleIsStaff = (a) => a.access === 'staff' || staffCategories.has(a.category);

  const side = (staff) => {
    const kept = articles.filter((a) => articleIsStaff(a) === staff);
    const slugs = new Set(kept.map((a) => a.slug));
    return {
      sections: sections.filter((s) => staffSections.has(s.id) === staff),
      categories: categories.filter((c) => categoryIsStaff(c) === staff),
      articles: kept,
      translations: Object.fromEntries(LANGS.map((l) => [
        l,
        Object.fromEntries(Object.entries(translations[l]).filter(([slug]) => slugs.has(slug))),
      ])),
    };
  };
  return { open: side(false), staff: side(true) };
}

function compileChangelog(file) {
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, 'utf-8');
  // Entries are separated by `## <version> — <date>` headings.
  const chunks = raw.split(/^##\s+/m).slice(1);
  return chunks.map((chunk) => {
    const [headingLine, ...rest] = chunk.split(/\r?\n/);
    const [version, date] = headingLine.split(/\s+[—–-]\s+/);
    const marked = createRenderer([]);
    return {
      version: (version || '').trim(),
      date: (date || '').trim(),
      html: marked.parse(rest.join('\n').trim()),
    };
  });
}

function loadTaxonomy(file) {
  if (!existsSync(file)) return { sections: [], categories: [] };
  const parsed = JSON.parse(readFileSync(file, 'utf-8'));
  const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999);
  return {
    sections: (parsed.sections || []).slice().sort(byOrder),
    categories: (parsed.categories || []).slice().sort(byOrder),
  };
}

/** @param {{ root?: string, siteUrl?: string }} [options] */
export default function helpContentPlugin(options = {}) {
  const root = options.root || process.cwd();
  const siteUrl = (options.siteUrl || 'https://draazy.com').replace(/\/$/, '');
  const contentDir = join(root, 'src/content/help');
  const categoriesFile = join(contentDir, 'categories.json');
  const changelogFile = join(root, 'src/content/changelog.md');

  let server;
  let outDir = join(root, 'dist');

  const build = (audience) => {
    const { sections, categories } = loadTaxonomy(categoriesFile);
    const { articles, translations } = compileArticles(contentDir);
    const side = splitByAccess({ sections, categories, articles, translations })[audience];
    return `export const sections = ${JSON.stringify(side.sections)};\n`
      + `export const categories = ${JSON.stringify(side.categories)};\n`
      + `export const articles = ${JSON.stringify(side.articles)};\n`
      + `export const translations = ${JSON.stringify(side.translations)};\n`
      + (audience === 'open'
        ? `export const changelog = ${JSON.stringify(compileChangelog(changelogFile))};\n`
        : '');
  };

  return {
    name: 'vite-plugin-help-content',
    configResolved(config) { outDir = resolve(root, config.build?.outDir || 'dist'); },
    configureServer(s) { server = s; },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return id === STAFF_VIRTUAL_ID ? STAFF_RESOLVED_ID : null;
    },
    load(id) {
      if (id === RESOLVED_ID) return build('open');
      return id === STAFF_RESOLVED_ID ? build('staff') : null;
    },
    /* Editing a doc invalidates the virtual module so the dev server hot-reloads
       the compiled output instead of requiring a restart. */
    handleHotUpdate(ctx) {
      const changed = ctx.file.replace(/\\/g, '/');
      if (!changed.includes('/src/content/')) return;
      for (const id of [RESOLVED_ID, STAFF_RESOLVED_ID]) {
        const mod = server?.moduleGraph.getModuleById(id);
        if (mod) server.moduleGraph.invalidateModule(mod);
      }
      server?.ws.send({ type: 'full-reload' });
      return [];
    },
    /* Injected after the static sitemap is copied, so a hand-maintained list cannot drift.
       A language is listed as an alternate only where a translation genuinely exists — advertising
       /mr/help/a/x when it serves English is a duplicate-content signal. */
    writeBundle() {
      const sitemap = join(outDir, 'sitemap.xml');
      if (!existsSync(sitemap)) return;

      const { sections, categories } = loadTaxonomy(categoriesFile);
      const { articles, translations } = compileArticles(contentDir);
      const open = splitByAccess({ sections, categories, articles, translations }).open;
      const publicCategoryIds = new Set(open.categories.map((c) => c.id));
      const prefixOf = (lang) => (lang === 'en' ? '' : `/${lang}`);

      /** One <url> per language, each listing every language as an alternate. */
      const entriesFor = (path, langs, { changefreq, priority, lastmod }) => {
        const alternates = langs
          .map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${siteUrl}${prefixOf(l)}${path}"/>`)
          .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${siteUrl}${path}"/>`)
          .join('\n');
        return langs.map((l) => [
          '  <url>',
          `    <loc>${siteUrl}${prefixOf(l)}${path}</loc>`,
          lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
          `    <changefreq>${changefreq}</changefreq>`,
          `    <priority>${priority}</priority>`,
          alternates,
          '  </url>',
        ].filter(Boolean).join('\n'));
      };

      const allLangs = ['en', ...LANGS];
      const urls = [
        // Chrome pages are fully translated, so all three languages are listed.
        ...entriesFor('/help', allLangs, { changefreq: 'weekly', priority: '0.7' }),
        ...entriesFor('/help/faq', allLangs, { changefreq: 'weekly', priority: '0.6' }),
        // Release notes stay English-only by design; see HelpChangelog.jsx.
        ...entriesFor('/help/changelog', ['en'], { changefreq: 'weekly', priority: '0.4' }),
        ...open.categories.flatMap((c) =>
          entriesFor(`/help/c/${c.id}`, allLangs, { changefreq: 'weekly', priority: '0.6' })),
        ...open.articles
          .filter((a) => publicCategoryIds.has(a.category))
          .flatMap((a) => entriesFor(
            `/help/a/${a.slug}`,
            ['en', ...LANGS.filter((l) => open.translations[l]?.[a.slug])],
            { changefreq: 'monthly', priority: '0.5', lastmod: a.updated },
          )),
      ];

      const xml = readFileSync(sitemap, 'utf-8');
      if (xml.includes('/help/a/')) return; // already injected

      // hreflang alternates live in the xhtml namespace, which the existing
      // static sitemap does not declare.
      const withNs = xml.includes('xmlns:xhtml')
        ? xml
        : xml.replace('<urlset ', '<urlset xmlns:xhtml="http://www.w3.org/1999/xhtml" ');

      writeFileSync(sitemap, withNs.replace('</urlset>', `${urls.join('\n')}\n</urlset>`), 'utf-8');
    },
  };
}
