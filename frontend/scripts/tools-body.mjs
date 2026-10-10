/* Readable prerender of /tools and the four tools from src/data/freeTools.js, the copy the pages themselves render. */
import { esc } from './seo-html.mjs';
import { FREE_TOOLS, SOURCES, TOOLS_AS_OF, TOOLS_HUB } from '../src/data/freeTools.js';

const section = (title, inner) => `<section class="mt-10"><h2 class="text-2xl font-bold text-white">${esc(title)}</h2>${inner}</section>`;
const link = (to, label) => `<a href="${esc(to)}" class="font-bold text-white">${esc(label)}</a>`;
const main = (top, accent, sub, ...parts) => `<main class="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
<h1 class="text-3xl font-extrabold leading-tight text-white sm:text-5xl">${esc(top)} <span class="gradient-text">${esc(accent)}</span></h1>
<p class="mt-5 max-w-2xl text-base text-gray-300 sm:text-lg">${esc(sub)}</p>
${parts.join('\n')}
</main>`;
const cta = (c) => `<p class="mt-10 text-sm text-gray-300">${esc(c.text)} ${link(c.to, c.label)}</p>`;

function toolBody(t) {
  const sources = t.sources.length
    ? `<ul class="mt-2 list-disc pl-5 text-sm text-gray-300">${t.sources.map((k) => `<li><a href="${esc(SOURCES[k].url)}" rel="noopener noreferrer" class="font-bold text-white">${esc(SOURCES[k].label)}</a></li>`).join('')}</ul>`
    : `<p class="mt-2 text-sm text-gray-300">${esc(t.noSources)}</p>`;
  return {
    faq: t.faq,
    body: main(t.top, t.accent, t.subtitle,
      section('How it\'s calculated', `${t.how.map((p) => `<p class="mt-3 text-sm text-gray-300">${esc(p)}</p>`).join('')}<p class="mt-3 text-sm text-gray-400">Rates and rules as of ${esc(TOOLS_AS_OF)}.</p>${sources}`),
      section('Frequently asked questions', `<dl class="mt-4 space-y-4">${t.faq.map((f) => `<dt class="font-medium text-white">${esc(f.q)}</dt><dd class="text-sm text-gray-400">${esc(f.a)}</dd>`).join('')}</dl>`),
      cta(t.cta)),
  };
}

const hubBody = () => ({
  body: main(TOOLS_HUB.top, TOOLS_HUB.accent, TOOLS_HUB.subtitle,
    `<ul class="mt-8 space-y-4">${FREE_TOOLS.map((t) => `<li>${link(t.path, t.name)}<p class="text-sm text-gray-400">${esc(t.summary)}</p></li>`).join('')}</ul>`,
    cta(TOOLS_HUB.cta)),
});

export const toolBodies = () => ({
  [TOOLS_HUB.path]: hubBody(),
  ...Object.fromEntries(FREE_TOOLS.map((t) => [t.path, toolBody(t)])),
});

export const toolsItemList = (site) => ({
  '@type': 'ItemList',
  name: TOOLS_HUB.top + ' ' + TOOLS_HUB.accent,
  itemListElement: FREE_TOOLS.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, url: `${site}${t.path}` })),
});
