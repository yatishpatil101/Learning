// node scripts/vite-plugin-content-index.test.mjs
import assert from 'node:assert/strict';
import { compileIndex } from './vite-plugin-content-index.mjs';

const posts = compileIndex(process.cwd());
assert.ok(posts.length > 0);
assert.deepEqual(posts.map((p) => p.published), posts.map((p) => p.published).sort().reverse(), 'newest first');
assert.deepEqual(Object.keys(posts[0]).sort(), ['near', 'published', 'slug', 'title', 'topic', 'topicLabel'], 'titles only, no body');
assert.deepEqual(posts.find((p) => p.slug === 'kharadi-vs-viman-nagar').near.sort(), ['kharadi', 'viman-nagar']);
console.log('content-index: all checks passed');
