const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');

async function main() {
  const pluginUrl = pathToFileURL(path.join(ROOT, 'scripts', 'vite-plugin-help-content.mjs')).href;
  const { default: helpContentPlugin } = await import(pluginUrl);
  const plugin = helpContentPlugin({ root: ROOT });
  const code = plugin.load('\0virtual:help-content');
  const mod = await import(`data:text/javascript,${encodeURIComponent(code)}`);

  const { sections, categories, articles } = mod;
  const errors = [];

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

  for (const category of categories) {
    if (!sectionIds.has(category.section)) errors.push(`category "${category.id}" references unknown section "${category.section}"`);
  }

  for (const article of articles) {
    const label = article.slug;
    if (!categoryIds.has(article.category)) errors.push(`${label}: unknown category "${article.category}"`);
    if (!article.title) errors.push(`${label}: missing title`);
    if (!article.summary) errors.push(`${label}: missing summary`);
    checkHeadings(label, article.headings);
    checkLinks(label, article.html);
  }

  if (errors.length) {
    console.error(`\n${errors.length} help content error(s):`);
    errors.forEach((e) => console.error(`  ${e}`));
    process.exit(1);
  }

  console.log(`help content OK — ${articles.length} articles, ${categories.length} categories.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});