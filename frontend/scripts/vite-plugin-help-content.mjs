/**
 * Vite plugin: compiles the help centre's Markdown source into a single virtual
 * module at build time.
 *
 * Why build-time rather than runtime:
 *   - No Markdown parser ships to the browser. `marked` is a devDependency; the
 *     client receives finished HTML strings and metadata only.
 *   - Headings, the search index and prev/next ordering are all derived once,
 *     during the build, instead of on every page view.
 *
 * Authors write plain `.md` files under src/content/help/<category>/, with YAML-ish
 * frontmatter. Everything else — slugs, anchors, table of contents, section
 * grouping — is derived from the file and its frontmatter.
 *
 * Translations: a file named `<slug>.hi.md` or `<slug>.mr.md` beside the English
 * `<slug>.md` supplies that language's version of the same article. English is
 * canonical — it defines which articles exist, their category and their ordering
 * — so a missing translation degrades to the English body rather than to a 404.
 * The reader is told when that happens; see HelpArticle.jsx.
 *
 * Consumers import the virtual module:
 *
 *     import { sections, categories, articles, translations, changelog } from 'virtual:help-content';
 *
 * Security note: article HTML is rendered with dangerouslySetInnerHTML on the
 * client. The content is authored in-repo and compiled at build time, so it is
 * trusted — but raw HTML inside Markdown is deliberately dropped (see the
 * renderer overrides below) so that pasting untrusted text into a doc can never
 * introduce a script tag.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { Marked } from 'marked';

const VIRTUAL_ID = 'virtual:help-content';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

/** Languages an article may be translated into. English is the canonical source. */
const LANGS = ['hi', 'mr'];

/* GitHub-style callouts: > [!NOTE] / [!TIP] / [!WARNING] / [!IMPORTANT] */
const CALLOUTS = {
  NOTE: { icon: 'info', label: 'Note' },
  TIP: { icon: 'lightbulb', label: 'Tip' },
  WARNING: { icon: 'warning', label: 'Heads up' },
  IMPORTANT: { icon: 'shield-check', label: 'Important' },
};

/* Heading slugs.
 *
 * The character class deliberately keeps Devanagari (U+0900–U+097F) alongside
 * ASCII. Stripping to [a-z0-9] silently reduced every Hindi and Marathi heading
 * to an empty string, so a translated article's table of contents anchored to
 * "", "-2", "-3" and no heading link worked. Fragment identifiers are allowed to
 * carry non-ASCII — browsers percent-encode them in the address bar and
 * getElementById matches the raw string — so keeping the script is both simpler
 * and more useful than transliterating. */
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

/* Marked escapes text for HTML output, so the derived plain text (used for the
   table of contents, heading anchors and the search haystack) has to be decoded
   again — otherwise a heading reads "I&#39;m" and anchors to `i-39-m`. */
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Minimal frontmatter reader. Supports `key: value`, quoted strings, booleans,
 * numbers and inline `[a, b]` arrays — the subset the help content actually uses.
 * A full YAML parser would be another dependency for no gain.
 */
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

/**
 * Build a Marked instance that collects headings and rewrites blockquote
 * callouts. A fresh instance per file keeps the heading collector isolated.
 */
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
      // Raw HTML in Markdown is dropped rather than passed through — see the
      // security note at the top of this file.
      html() { return ''; },
      // marked v15 removed its built-in sanitizer, so an unguarded `[x](javascript:…)`
      // in any article (including a translation contributed under a narrower review
      // bar) would render a live script-executing anchor. Allowlist the schemes a
      // help article can legitimately need; anything else becomes an inert '#'.
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

/**
 * Compile every article, keyed by language.
 *
 * English defines the article set. A `<slug>.<lang>.md` sibling contributes only
 * the translatable surface — title, summary, body, headings — while category,
 * ordering, access and audience always come from the English file, so a
 * translation can never move an article into a different section or expose a
 * staff runbook publicly by getting its frontmatter wrong.
 */
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
    translations[lang][slug] = {
      title: data.title || english.title,
      summary: data.summary || text.slice(0, 160),
      // Tags feed search, so translated tags let a Marathi reader find the
      // article using Marathi words rather than only the English ones.
      tags: Array.isArray(data.tags) ? data.tags : english.tags,
      readMinutes: Math.max(1, Math.round(text.split(' ').length / 200)),
      headings,
      html,
      text: text.slice(0, 4000),
    };
  }

  articles.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return { articles, translations };
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

/**
 * @param {{ root?: string, siteUrl?: string }} [options]
 */
export default function helpContentPlugin(options = {}) {
  const root = options.root || process.cwd();
  const siteUrl = (options.siteUrl || 'https://punenest.com').replace(/\/$/, '');
  const contentDir = join(root, 'src/content/help');
  const categoriesFile = join(contentDir, 'categories.json');
  const changelogFile = join(root, 'src/content/changelog.md');

  let server;
  let outDir = join(root, 'dist');

  const build = () => {
    const { sections, categories } = loadTaxonomy(categoriesFile);
    const { articles, translations } = compileArticles(contentDir);
    const changelog = compileChangelog(changelogFile);
    return `export const sections = ${JSON.stringify(sections)};\n`
      + `export const categories = ${JSON.stringify(categories)};\n`
      + `export const articles = ${JSON.stringify(articles)};\n`
      + `export const translations = ${JSON.stringify(translations)};\n`
      + `export const changelog = ${JSON.stringify(changelog)};\n`;
  };

  return {
    name: 'vite-plugin-help-content',
    configResolved(config) { outDir = resolve(root, config.build?.outDir || 'dist'); },
    configureServer(s) { server = s; },
    resolveId(id) { return id === VIRTUAL_ID ? RESOLVED_ID : null; },
    load(id) { return id === RESOLVED_ID ? build() : null; },
    /* Editing a doc invalidates the virtual module so the dev server hot-reloads
       the compiled output instead of requiring a restart. */
    handleHotUpdate(ctx) {
      const changed = ctx.file.replace(/\\/g, '/');
      if (!changed.includes('/src/content/')) return;
      const mod = server?.moduleGraph.getModuleById(RESOLVED_ID);
      if (mod) {
        server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      }
      return [];
    },
    /* Help articles are public and worth indexing, and a hand-maintained sitemap
       would drift the moment anyone adds a doc. Inject the public URLs into the
       static sitemap after it has been copied to the output directory.

       Each entry carries xhtml:link alternates so a crawler treats the three
       language URLs as translations rather than duplicates. A language is only
       listed for an article that genuinely has a translation — advertising
       /mr/help/a/x when it serves English is a duplicate-content signal, and
       the opposite of what hreflang is for. */
    writeBundle() {
      const sitemap = join(outDir, 'sitemap.xml');
      if (!existsSync(sitemap)) return;

      const { categories } = loadTaxonomy(categoriesFile);
      const { articles, translations } = compileArticles(contentDir);
      const publicCategories = categories.filter((c) => c.access !== 'staff');
      const publicCategoryIds = new Set(publicCategories.map((c) => c.id));
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
        ...publicCategories.flatMap((c) =>
          entriesFor(`/help/c/${c.id}`, allLangs, { changefreq: 'weekly', priority: '0.6' })),
        ...articles
          .filter((a) => a.access !== 'staff' && publicCategoryIds.has(a.category))
          .flatMap((a) => entriesFor(
            `/help/a/${a.slug}`,
            ['en', ...LANGS.filter((l) => translations[l]?.[a.slug])],
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
