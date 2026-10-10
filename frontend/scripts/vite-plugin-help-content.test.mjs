import assert from 'node:assert/strict';
import { helpPages } from './vite-plugin-help-content.mjs';

const copy = {
  centre: 'Help centre', faq: 'FAQ', faqTitle: 'FAQs', faqSubtitle: 'Quick answers.',
  changelogTitle: "What's new", changelogSubtitle: 'Shipped.', heroTitle: 'How can we help?', heroSubtitle: 'Guides.',
};
const pages = helpPages({
  sections: [{ id: 's', title: 'Start' }],
  categories: [{ id: 'c', section: 's', title: 'Cat', description: 'About cat.' }],
  articles: [{ slug: 'a', category: 'c', title: 'Art & co', summary: 'Sum.', html: '<p>Body</p>', updated: '2026-01-02' }],
  changelog: [{ version: '1.0', date: '2026-01-01', html: '<p>First</p>' }],
}, copy, 'https://draazy.com');
const byPath = Object.fromEntries(pages.map((p) => [p.path, p]));

assert.deepEqual(Object.keys(byPath), ['/help', '/help/faq', '/help/changelog', '/help/c/c', '/help/a/a']);
assert.match(byPath['/help'].head, /<title>Draazy Help centre<\/title>/);
assert.match(byPath['/help/a/a'].head, /<title>Art &amp; co · Draazy Help centre<\/title>/);
assert.match(byPath['/help/a/a'].head, /rel="canonical" href="https:\/\/draazy.com\/help\/a\/a"/);
assert.match(byPath['/help/a/a'].head, /"@type":"Article".*"dateModified":"2026-01-02".*"@type":"BreadcrumbList"/);
assert.match(byPath['/help/a/a'].body, /<div class="doc-prose mt-7"><p>Body<\/p><\/div>/);
assert.match(byPath['/help/c/c'].body, /<a href="\/help\/a\/a">Art &amp; co<\/a>/);
assert.match(byPath['/help'].body, /<a href="\/help\/c\/c">Cat<\/a>/);
assert.match(byPath['/help/changelog'].body, /1\.0 — 2026-01-01/);

console.log('vite-plugin-help-content: ok');
