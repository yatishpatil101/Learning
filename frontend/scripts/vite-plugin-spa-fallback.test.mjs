import assert from 'node:assert/strict';
import { spaRedirects } from './vite-plugin-spa-fallback.mjs';

const app = `
  <Route path="/" /> <Route path="*" /> <Route path="analytics" />
  <Route path="/property/:id" /> <Route path="/listings" /> <Route path="/admin/*" />
  <Route path="/locality" /> <Route path="/locality/:slug" />`;
const rules = spaRedirects(app, ['/index.html', '/404.html', '/locality.html', '/locality/baner.html']).trim().split('\n');

assert.deepEqual(rules, [
  '/listings  /404  200',
  '/admin  /404  200',
  '/locality/baner  /locality/baner  200',
  '/property/:id  /404  200',
  '/admin/*  /404  200',
  '/locality/:slug  /404  200',
], 'static rules first, prerendered pages self-rewrite ahead of their route');
assert.throws(() => spaRedirects('<Route path={x} />', []), /no route paths/);
const many = Array.from({ length: 101 }, (_, i) => `<Route path="/r${i}/:id" />`).join('');
assert.throws(() => spaRedirects(many, []), /101 dynamic rules/);

console.log('vite-plugin-spa-fallback: ok');
