/* Integrity check for compiled help content.
 *
 * Guards the failure modes that are invisible in review because they only show
 * up once the Markdown has been compiled:
 *
 *   1. Empty or degenerate heading anchors. Devanagari headings slugged to ""
 *      and "-2" before the slug character class was widened, so every Hindi and
 *      Marathi table of contents pointed at nothing.
 *   2. Duplicate anchors within an article, which make deep links ambiguous.
 *   3. Translations whose heading count diverges from English, usually meaning a
 *      section was dropped in translation.
 *   4. Orphan translations — a `.hi.md` with no English source.
 *   5. Internal links pointing at articles or categories that do not exist.
 *   6. Hardcoded `/help/...` links in help components. These work in English and
 *      silently drop a Hindi or Marathi reader back into English, which is
 *      invisible unless you test in another language — so it is checked rather
 *      than trusted.
 *
 * Usage: node scripts/check-help-content.cjs
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');

/** Files that legitimately mention the unprefixed path. */
const HELP_LINK_ALLOWED = new Set([
  'src/lib/helpUrl.js',      // owns the prefix rule
  'src/lib/useHelpSeo.js',   // builds absolute URLs for canonical/hreflang
  'src/lib/useHelp.js',      // exposes the helper
]);

/**
 * Scan help components for `to=`/`navigate()` targets that skip the language
 * helper. Matches a literal or template `/help/...` that is not wrapped in
 * `hp(` — the convention every call site uses.
 */
function findHardcodedHelpLinks() {
  const dirs = ['src/components/help', 'src/pages/consumer/help'];
  const offenders = [];

  for (const dir of dirs) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (!name.endsWith('.jsx')) continue;
      const rel = `${dir}/${name}`;
      if (HELP_LINK_ALLOWED.has(rel)) continue;
      const src = fs.readFileSync(path.join(abs, name), 'utf8');

      for (const m of src.matchAll(/(?:to=|navigate\()\s*\{?\s*(['"`])(\/help[^'"`]*)\1/g)) {
        offenders.push(`${rel}: ${m[0].trim()} — wrap in hp() from useHelpPath()`);
      }
      for (const m of src.matchAll(/(?:to=|navigate\()\s*\{?\s*`(\/help[^`]*)`/g)) {
        offenders.push(`${rel}: \`${m[1]}\` — wrap in hp() from useHelpPath()`);
      }
    }
  }
  return offenders;
}

async function main() {
  const pluginUrl = pathToFileURL(path.join(ROOT, 'scripts', 'vite-plugin-help-content.mjs')).href;
  const { default: helpContentPlugin } = await import(pluginUrl);
  const plugin = helpContentPlugin({ root: ROOT });
  const code = plugin.load('\0virtual:help-content');
  const mod = await import(`data:text/javascript,${encodeURIComponent(code)}`);

  const { sections, categories, articles, translations } = mod;
  const errors = findHardcodedHelpLinks();
  const warnings = [];

  const categoryIds = new Set(categories.map((c) => c.id));
  const sectionIds = new Set(sections.map((s) => s.id));
  const slugs = new Set(articles.map((a) => a.slug));

  const checkHeadings = (label, headings) => {
    const ids = headings.map((h) => h.id);
    for (const id of ids) {
      if (!id || /^-?\d*$/.test(id)) {
        errors.push(`${label}: degenerate heading anchor ${JSON.stringify(id)} — the slug lost every character`);
      }
    }
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    for (const id of new Set(dupes)) errors.push(`${label}: duplicate heading anchor "${id}"`);
  };

  /* Internal links are authored by hand in Markdown, so a renamed slug leaves a
     dead link that nothing else would catch until a reader hits it. */
  const checkLinks = (label, html) => {
    for (const m of html.matchAll(/href="\/help\/(a|c)\/([^"#?]+)/g)) {
      const [, kind, id] = m;
      const known = kind === 'a' ? slugs.has(id) : categoryIds.has(id);
      if (!known) errors.push(`${label}: link to /help/${kind}/${id} — no such ${kind === 'a' ? 'article' : 'category'}`);
    }
  };

  for (const section of sections) {
    if (!section.i18n) warnings.push(`section "${section.id}" has no translated labels`);
  }
  for (const category of categories) {
    if (!sectionIds.has(category.section)) errors.push(`category "${category.id}" references unknown section "${category.section}"`);
    if (!category.i18n) warnings.push(`category "${category.id}" has no translated labels`);
  }

  for (const article of articles) {
    const label = `en/${article.slug}`;
    if (!categoryIds.has(article.category)) errors.push(`${label}: unknown category "${article.category}"`);
    if (!article.title) errors.push(`${label}: missing title`);
    if (!article.summary) errors.push(`${label}: missing summary`);
    checkHeadings(label, article.headings);
    checkLinks(label, article.html);
  }

  for (const [lang, byslug] of Object.entries(translations)) {
    for (const [slug, t] of Object.entries(byslug)) {
      const label = `${lang}/${slug}`;
      const english = articles.find((a) => a.slug === slug);
      if (!english) {
        errors.push(`${label}: translation has no English source`);
        continue;
      }
      if (!t.title) errors.push(`${label}: missing title`);
      checkHeadings(label, t.headings);
      checkLinks(label, t.html);

      const delta = Math.abs(t.headings.length - english.headings.length);
      if (delta > 0) {
        warnings.push(`${label}: ${t.headings.length} headings vs ${english.headings.length} in English — a section may have been dropped`);
      }
    }
  }

  const langs = Object.keys(translations);
  const coverage = langs
    .map((l) => `${l} ${Object.keys(translations[l]).length}/${articles.length}`)
    .join(', ');

  if (warnings.length) {
    console.warn(`\n${warnings.length} warning(s):`);
    warnings.forEach((w) => console.warn(`  ${w}`));
  }

  if (errors.length) {
    console.error(`\n${errors.length} help content error(s):`);
    errors.forEach((e) => console.error(`  ${e}`));
    process.exit(1);
  }

  console.log(`help content OK — ${articles.length} articles, ${categories.length} categories, translated: ${coverage}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
