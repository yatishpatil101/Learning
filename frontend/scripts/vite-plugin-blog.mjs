/* Each post is also written to dist/blog/<slug>.html with its head tags and article in the shell, so crawlers
   and link-preview bots get real content without JavaScript; Pages serves it ahead of the SPA fallback. */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRenderer, parseFrontmatter, toPlainText } from './vite-plugin-help-content.mjs';
import { esc, headTags, jsonLd, renderPage, byline, editorialAuthor, publisher, longDate } from './seo-html.mjs';
import { ogCard } from './og-card.mjs';

const VIRTUAL_ID = 'virtual:blog-posts';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
const REQUIRED = ['title', 'description', 'published', 'topic'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const TOPICS = { renting: 'Renting', buying: 'Buying', owners: 'For owners', localities: 'Localities' };

const BLOG = {
  title: 'Pune Property Guides: Renting, Buying & Localities | Draazy',
  description: 'Clear, checked guides to renting, buying and owning a home in Pune: rent agreements, deposits, stamp duty, RERA and localities.',
  heading: 'Pune property, explained',
  intro: 'Clear, checked answers on rent agreements, deposits, stamp duty and localities, so you can deal directly with owners and save the brokerage.',
};

const relatedTo = (post, posts) => [
  ...posts.filter((p) => p.slug !== post.slug && p.topic === post.topic),
  ...posts.filter((p) => p.topic !== post.topic),
].slice(0, 3).map((p) => p.slug);

const formatDate = (iso) => new Date(`${iso}T00:00:00Z`)
  .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function compilePosts(dir, { includeDrafts = false } = {}) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const slug = file.replace(/\.md$/, '');
      const { data, body } = parseFrontmatter(readFileSync(join(dir, file), 'utf-8'));
      const problems = [
        ...REQUIRED.filter((k) => !data[k]).map((k) => `missing "${k}"`),
        !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && 'file name must be a lowercase-hyphenated slug',
        [data.published, data.updated].some((d) => d && !DATE.test(String(d))) && 'dates must be YYYY-MM-DD',
        data.image && !data.imageAlt && 'an image needs imageAlt',
        data.dataset && !/^\/data\/[\w.-]+\.csv$/.test(data.dataset) && 'dataset must be a /data/<file>.csv path',
        data.topic && !Object.hasOwn(TOPICS, data.topic) && `topic must be one of: ${Object.keys(TOPICS).join(', ')}`,
      ].filter(Boolean);
      if (problems.length) throw new Error(`[blog] ${file}: ${problems.join('; ')}`);

      const title = String(data.title);
      const description = String(data.description);
      // Google cuts titles near 60 characters and descriptions near 160.
      if (title.length > 60) console.warn(`[blog] ${file}: title is ${title.length} chars; search results show about 60`);
      if (description.length > 160) console.warn(`[blog] ${file}: description is ${description.length} chars; search results show about 160`);

      const headings = [];
      const html = createRenderer(headings).parse(body.trim());
      return {
        slug,
        title,
        seoTitle: title.length <= 51 ? `${title} | Draazy` : title,
        description,
        topic: data.topic,
        topicLabel: TOPICS[data.topic],
        published: String(data.published),
        updated: String(data.updated || data.published),
        dateLabel: formatDate(String(data.published)),
        updatedLabel: longDate(String(data.updated || data.published)),
        dataset: data.dataset ? String(data.dataset) : '',
        period: data.period ? String(data.period) : '',
        license: data.license ? String(data.license) : '',
        image: data.image || '',
        imageAlt: data.imageAlt || '',
        tags: Array.isArray(data.tags) ? data.tags : [],
        draft: data.draft === true,
        readMinutes: Math.max(1, Math.round(toPlainText(html).split(' ').length / 200)),
        headings,
        html,
      };
    })
    .filter((p) => includeDrafts || !p.draft)
    .sort((a, b) => b.published.localeCompare(a.published) || a.title.localeCompare(b.title))
    .map((p, _, all) => ({ ...p, related: relatedTo(p, all) }));
}

const absolute = (src, siteUrl) => (src.startsWith('/') ? `${siteUrl}${src}` : src);

const shareImage = (root, post, siteUrl) => (post.image
  ? { image: absolute(post.image, siteUrl), imageAlt: post.imageAlt }
  : ogCard(root, 'blog', post.slug, post.title, siteUrl));

const datasetLd = (post, url, siteUrl) => ({
  '@type': 'Dataset',
  name: post.title,
  description: post.description,
  url,
  creator: publisher(siteUrl),
  dateModified: post.updated,
  isAccessibleForFree: true,
  ...(post.period && { temporalCoverage: post.period }),
  ...(post.license && { license: post.license }),
  distribution: { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: absolute(post.dataset, siteUrl) },
});

const postMeta = (p) => `<time datetime="${p.published}">${p.dateLabel}</time> · ${p.readMinutes} min read`;

function postPage(shell, post, posts, siteUrl, root) {
  const url = `${siteUrl}/blog/${post.slug}`;
  const card = shareImage(root, post, siteUrl);
  const more = post.related.map((slug) => posts.find((p) => p.slug === slug));
  const head = headTags({
    title: post.seoTitle,
    description: post.description,
    url,
    ...card,
    type: 'article',
    extra: [
      `<meta property="article:published_time" content="${post.published}" />`,
      `<meta property="article:modified_time" content="${post.updated}" />`,
      ...post.tags.map((t) => `<meta property="article:tag" content="${esc(t)}" />`),
      jsonLd({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'BlogPosting',
            headline: post.title,
            description: post.description,
            datePublished: post.published,
            dateModified: post.updated,
            author: editorialAuthor(siteUrl),
            publisher: publisher(siteUrl),
            image: card.image,
            url,
            mainEntityOfPage: url,
            inLanguage: 'en-IN',
            ...(post.tags.length && { keywords: post.tags.join(', ') }),
          },
          ...(post.dataset ? [datasetLd(post, url, siteUrl)] : []),
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
              { '@type': 'ListItem', position: 2, name: 'Blog', item: `${siteUrl}/blog` },
              { '@type': 'ListItem', position: 3, name: post.title, item: url },
            ],
          },
        ],
      }),
    ],
  });
  const body = `<main class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
<nav aria-label="Breadcrumb" class="mb-4 text-xs text-gray-500"><a href="/">Home</a> › <a href="/blog">Blog</a> › ${esc(post.topicLabel)}</nav>
<article>
<h1 class="text-[1.65rem] font-extrabold leading-tight text-white sm:text-4xl">${esc(post.title)}</h1>
<p class="mt-3 text-base leading-relaxed text-gray-400">${esc(post.description)}</p>
<p class="mt-4 text-xs text-gray-500">${byline(post.updated)} · ${post.readMinutes} min read</p>${post.dataset ? `\n<p class="mt-3 text-sm"><a href="${post.dataset}" download>Download the data (CSV)</a></p>` : ''}
<div class="doc-prose mt-7">${post.html}</div>
</article>
${more.length ? `<nav aria-label="More from the blog" class="mt-12"><h2 class="text-lg font-bold text-white">Keep reading</h2><ul>${more.map((p) => `<li><a href="/blog/${p.slug}">${esc(p.title)}</a></li>`).join('')}</ul></nav>` : ''}
</main>`;
  return renderPage(shell, head, body);
}

function indexPage(shell, posts, siteUrl) {
  const url = `${siteUrl}/blog`;
  const head = headTags({
    title: BLOG.title,
    description: BLOG.description,
    url,
    image: `${siteUrl}/og-image.jpg`,
    type: 'website',
    extra: [jsonLd({
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: 'Draazy Pune Property Guides',
      description: BLOG.description,
      url,
      inLanguage: 'en-IN',
      publisher: { '@type': 'Organization', name: 'Draazy', url: siteUrl },
      blogPost: posts.map((p) => ({
        '@type': 'BlogPosting', headline: p.title, url: `${siteUrl}/blog/${p.slug}`, datePublished: p.published, dateModified: p.updated,
      })),
    })],
  });
  const body = `<main class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-12">
<p class="text-[11px] font-semibold uppercase tracking-widest text-teal-300">Draazy Guides</p>
<h1 class="mt-3 text-[1.85rem] font-extrabold leading-tight text-white sm:text-5xl">${esc(BLOG.heading)}</h1>
<p class="mt-3 max-w-2xl text-[15px] leading-relaxed text-gray-400 sm:text-lg">${esc(BLOG.intro)}</p>
<ul class="mt-8">${posts.map((p) => `<li class="mt-6"><p class="text-[11px] font-semibold uppercase tracking-widest text-gray-500">${esc(p.topicLabel)}</p><h2 class="mt-1 text-base font-bold text-white"><a href="/blog/${p.slug}">${esc(p.title)}</a></h2><p class="mt-1.5 text-sm text-gray-400">${esc(p.description)}</p><p class="mt-2 text-xs text-gray-500">${postMeta(p)}</p></li>`).join('')}</ul>
</main>`;
  return renderPage(shell, head, body);
}

/** @param {{ root?: string, siteUrl?: string }} [options] */
export default function blogPlugin(options = {}) {
  const root = options.root || process.cwd();
  const siteUrl = (options.siteUrl || 'https://draazy.com').replace(/\/$/, '');
  const contentDir = join(root, 'src/content/blog');
  let outDir = join(root, 'dist');
  let includeDrafts = false;

  return {
    name: 'vite-plugin-blog',
    configResolved(config) {
      outDir = resolve(root, config.build?.outDir || 'dist');
      includeDrafts = config.command === 'serve';
    },
    configureServer(server) {
      server.watcher.on('all', (_event, file) => {
        if (!file.replace(/\\/g, '/').includes('/src/content/blog/')) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      });
    },
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    load(id) {
      if (id !== RESOLVED_ID) return null;
      return `export const blog = ${JSON.stringify(BLOG)};\n`
        + `export const topics = ${JSON.stringify(TOPICS)};\n`
        + `export const posts = ${JSON.stringify(compilePosts(contentDir, { includeDrafts }))};\n`;
    },
    writeBundle() {
      const shellFile = join(outDir, 'index.html');
      if (!existsSync(shellFile)) return;
      const shell = readFileSync(shellFile, 'utf-8');
      const posts = compilePosts(contentDir);

      mkdirSync(join(outDir, 'blog'), { recursive: true });
      writeFileSync(join(outDir, 'blog.html'), indexPage(shell, posts, siteUrl), 'utf-8');
      for (const post of posts) {
        writeFileSync(join(outDir, 'blog', `${post.slug}.html`), postPage(shell, post, posts, siteUrl, root), 'utf-8');
      }

      const sitemap = join(outDir, 'sitemap.xml');
      if (!existsSync(sitemap)) return;
      const xml = readFileSync(sitemap, 'utf-8');
      if (xml.includes('/blog</loc>')) return;
      const entry = (path, lastmod, changefreq, priority) => `  <url><loc>${siteUrl}${path}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
      const urls = [
        entry('/blog', posts.map((p) => p.updated).sort().at(-1), 'weekly', '0.7'),
        ...posts.map((p) => entry(`/blog/${p.slug}`, p.updated, 'monthly', '0.6')),
      ];
      writeFileSync(sitemap, xml.replace('</urlset>', `${urls.join('\n')}\n</urlset>`), 'utf-8');
    },
  };
}
