/* Pure string helpers shared by the build-time prerender plugins and the Pages Functions in
   functions/ (which cannot import node:fs), so a prerendered page and an edge-rendered one carry the same head. */

export const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// `<` escaped so post text can never close the script element.
export const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

const EDITORIAL_AUTHOR = 'Draazy Editorial Team';

export const longDate = (iso) => new Date(`${iso}T00:00:00Z`)
  .toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export const editorialAuthor = (siteUrl) => ({
  '@type': 'Organization', name: EDITORIAL_AUTHOR, url: `${siteUrl}/about`, parentOrganization: { '@id': `${siteUrl}/#organization` },
});

export const publisher = (siteUrl) => ({
  '@type': 'Organization', '@id': `${siteUrl}/#organization`, name: 'Draazy', url: `${siteUrl}/`, logo: { '@type': 'ImageObject', url: `${siteUrl}/icon-512.png` },
});

export const byline = (updated) => `By <a href="/about">${EDITORIAL_AUTHOR}</a> · Updated <time datetime="${updated}">${longDate(updated)}</time>`;

export function headTags({ title, description, url, image, imageAlt, imageSize, type, extra = [] }) {
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
    ...(imageSize ? [`<meta property="og:image:width" content="${imageSize[0]}" />`, `<meta property="og:image:height" content="${imageSize[1]}" />`] : []),
    ...(imageAlt ? [`<meta property="og:image:alt" content="${esc(imageAlt)}" />`] : []),
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="twitter:site" content="@draazyapp" />',
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    ...(imageAlt ? [`<meta name="twitter:image:alt" content="${esc(imageAlt)}" />`] : []),
    ...extra,
  ].map((t) => `    ${t}`).join('\n');
}

const SHELL_SEO = /\s*<title>[\s\S]*?<\/title>|\s*<meta\s+(?:name|property)="(?:description|og:[\w:]+|twitter:[\w:]+)"[^>]*>/g;
const attr = (s) => s.replace(/"/g, '&quot;');

/* `data-shell` carries the app-wide value each tag replaced, so src/lib/usePageHead.js can put it
   back when the reader navigates in-app away from a page that was loaded prerendered. */
export function renderPage(shell, head, body) {
  if (!shell.includes('<div id="root"></div>')) throw new Error('[seo-html] the shell has no empty #root to prerender into');
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
