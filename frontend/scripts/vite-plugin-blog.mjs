/* Each post is also written to dist/blog/<slug>.html with its head tags and article in the shell, so crawlers
   and link-preview bots get real content without JavaScript; Pages serves it ahead of the SPA fallback. */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRenderer, parseFrontmatter, toPlainText } from './vite-plugin-help-content.mjs';

const VIRTUAL_ID = 'virtual:blog-posts';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
const DEFAULT_AUTHOR = 'Draazy Team';
const REQUIRED = ['title', 'description', 'published', 'topic'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOPICS = { renting: 'Renting', buying: 'Buying', owners: 'For owners', localities: 'Localities' };

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
        author: data.author || DEFAULT_AUTHOR,
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

export const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// `<` escaped so post text can never close the script element.
export const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

const absolute = (src, siteUrl) => {
  if (!src) return `${siteUrl}/og-image.jpg`;
  return src.startsWith('/') ? `${siteUrl}${src}` : src;
};

export function headTags({ title, description, url, image, type, extra = [] }) {
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="${type}" />`,
    '<meta property="og:site_name" content="Draazy" />',
    '<meta property="og:locale" content="en_IN" />',
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="twitter:site" content="@draazy" />',
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    ...extra,
  ].map((t) => `    ${t}`).join('\n');
}

const SHELL_SEO = /\s*<title>[\s\S]*?<\/title>|\s*<meta\s+(?:name|property)="(?:description|og:[\w:]+|twitter:[\w:]+)"[^>]*>/g;
const attr = (s) => s.replace(/"/g, '&quot;');

/* `data-shell` carries the app-wide value each tag replaced, so src/lib/usePageHead.js can put it
   back when the reader navigates in-app away from a page that was loaded prerendered. */
export function renderPage(shell, head, body) {
  if (!shell.includes('<div id="root"></div>')) throw new Error('[blog] dist/index.html has no empty #root to prerender into');
  const shellTitle = shell.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
  const shellDescription = shell.match(/<meta\s+name="description"\s+content="([^"]*)"/)?.[1] ?? '';
  const taggedHead = head
    .replace('<title>', () => `<title data-shell="${attr(shellTitle)}">`)
    .replace('<meta name="description"', () => `<meta data-shell="${attr(shellDescription)}" name="description"`)
    .replace('<link rel="canonical"', '<link data-shell="" rel="canonical"');
  // Function replacements: a `$` in post text must not be read as a replacement pattern.
  return shell
    .replace(SHELL_SEO, '')
    .replace('</head>', () => `${taggedHead}\n  </head>`)
    .replace('<div id="root"></div>', () => `<div id="root">${body}</div>`);
}

const postMeta = (p) => `<time datetime="${p.published}">${p.dateLabel}</time> · ${p.readMinutes} min read`;

function postPage(shell, post, posts, siteUrl) {
  const url = `${siteUrl}/blog/${post.slug}`;
  const image = absolute(post.image, siteUrl);
  const more = post.related.map((slug) => posts.find((p) => p.slug === slug));
  const head = headTags({
    title: post.seoTitle,
    description: post.description,
    url,
    image,
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
            author: { '@type': post.author === DEFAULT_AUTHOR ? 'Organization' : 'Person', name: post.author },
            publisher: { '@type': 'Organization', name: 'Draazy', url: siteUrl, logo: { '@type': 'ImageObject', url: `${siteUrl}/icon-512.png` } },
            image,
            url,
            mainEntityOfPage: url,
            inLanguage: 'en-IN',
            ...(post.tags.length && { keywords: post.tags.join(', ') }),
          },
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
<p class="mt-4 text-xs text-gray-500">${esc(post.author)} · ${postMeta(post)}</p>
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
        writeFileSync(join(outDir, 'blog', `${post.slug}.html`), postPage(shell, post, posts, siteUrl), 'utf-8');
      }

      const sitemap = join(outDir, 'sitemap.xml');
      if (!existsSync(sitemap)) return;
      const xml = readFileSync(sitemap, 'utf-8');
      if (xml.includes('/blog</loc>')) return;
      const entry = (path, lastmod, changefreq, priority) => `  <url><loc>${siteUrl}${path}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
      const urls = [
        entry('/blog', posts[0]?.updated, 'weekly', '0.7'),
        ...posts.map((p) => entry(`/blog/${p.slug}`, p.updated, 'monthly', '0.6')),
      ];
      writeFileSync(sitemap, xml.replace('</urlset>', `${urls.join('\n')}\n</urlset>`), 'utf-8');
    },
  };
}
