/* Readable prerender of /compare/nobroker from src/data/compareNobroker.js, the copy the page itself renders. */
import { esc } from './seo-html.mjs';
import { AS_OF, CHECKED_ON, CORRECTIONS_EMAIL, SOURCES } from '../src/data/compareNobroker.js';

const out = (url, label) => `<a href="${esc(url)}" rel="noopener noreferrer" class="font-bold text-white">${esc(label)}</a>`;
const section = (title, inner) => `<section class="mt-10"><h2 class="text-2xl font-bold text-white">${esc(title)}</h2>${inner}</section>`;
const list = (items) => `<ul class="mt-4 list-disc pl-5 text-sm text-gray-300">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
const links = (pairs) => `<p class="mt-3 text-sm">${pairs.map(([l, to]) => `<a href="${esc(to)}" class="font-bold text-white">${esc(l)}</a>`).join(' &middot; ')}</p>`;

const nobrokerCell = (c) => `<td><p>${esc(c.text)}</p><p>Source: ${c.src.map((k) => out(SOURCES[k].url, SOURCES[k].label)).join(', ')}</p></td>`;
const draazyCell = (c) => `<td><p>${esc(c.text)}</p>${c.link ? links([c.link]) : ''}</td>`;

export function compareBody(c) {
  const rows = c.rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th>${nobrokerCell(r.nobroker)}${draazyCell(r.draazy)}</tr>`).join('');
  const table = `<table class="mt-4 w-full text-left text-sm text-gray-300"><thead><tr><th scope="col"></th><th scope="col">NoBroker</th><th scope="col">Draazy</th></tr></thead><tbody>${rows}</tbody></table>`;
  const sources = `<ul class="mt-4 list-disc pl-5 text-sm text-gray-300">${Object.values(SOURCES).map((s) => `<li>${out(s.url, s.label)}, checked ${esc(CHECKED_ON)}</li>`).join('')}</ul>`;
  return {
    faq: c.faq,
    body: `<main class="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
<h1 class="text-3xl font-extrabold leading-tight text-white sm:text-5xl">${esc(c.top)} <span class="gradient-text">${esc(c.accent)}</span></h1>
<p class="mt-5 max-w-2xl text-base text-gray-300 sm:text-lg">${esc(c.subtitle)}</p>
<p class="mt-3 text-sm text-gray-400">Facts as of ${esc(AS_OF)}, from NoBroker&rsquo;s published pages. To correct anything, write to <a href="mailto:${esc(CORRECTIONS_EMAIL)}" class="font-bold text-white">${esc(CORRECTIONS_EMAIL)}</a>.</p>
${c.summary.map((p) => `<p class="mt-4 max-w-2xl text-base text-gray-300">${esc(p)}</p>`).join('\n')}
${section('Plans and fees side by side', table)}
${section(c.nobrokerFit.title, list(c.nobrokerFit.list))}
${section(c.draazyFit.title, list(c.draazyFit.list) + links(c.draazyFit.links))}
${section('Frequently asked questions', `<dl class="mt-4 space-y-4">${c.faq.map((f) => `<dt class="font-medium text-white">${esc(f.q)}</dt><dd class="text-sm text-gray-400">${esc(f.a)}</dd>`).join('')}</dl>`)}
${section('Sources', sources)}
<p class="mt-8 text-xs text-gray-500">${esc(c.disclaimer)}</p>
</main>`,
  };
}
