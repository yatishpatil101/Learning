/* Titles and slugs without the Markdown bodies, so home and property pages can link to posts
   at a few hundred bytes. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './vite-plugin-help-content.mjs';
import { TOPICS } from './vite-plugin-blog.mjs';
import { GUIDE_LOCALITIES } from '../src/lib/guideLocalities.js';

const VIRTUAL_ID = 'virtual:blog-index';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

const markdown = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : []);

export function compileIndex(root) {
  const guides = markdown(join(root, 'src/content/localities')).map((f) => f.replace(/\.md$/, '')).sort();
  const listed = Object.keys(GUIDE_LOCALITIES).sort();
  if (guides.join() !== listed.join()) {
    throw new Error(`[content-index] src/lib/guideLocalities.js must list exactly the guides in src/content/localities (files: ${guides.join(', ')})`);
  }

  const dir = join(root, 'src/content/blog');
  return markdown(dir)
    .map((file) => {
      const { data } = parseFrontmatter(readFileSync(join(dir, file), 'utf-8'));
      const text = `${data.title} ${data.description} ${Array.isArray(data.tags) ? data.tags.join(' ') : ''}`;
      return {
        slug: file.replace(/\.md$/, ''),
        title: String(data.title),
        topic: data.topic,
        topicLabel: TOPICS[data.topic] || '',
        published: String(data.published),
        draft: data.draft === true,
        near: Object.entries(GUIDE_LOCALITIES).filter(([, name]) => new RegExp(`\\b${name}\\b`, 'i').test(text)).map(([slug]) => slug),
      };
    })
    .filter((p) => !p.draft)
    .sort((a, b) => b.published.localeCompare(a.published) || a.title.localeCompare(b.title))
    .map(({ draft, ...post }) => post);
}

export default function contentIndexPlugin(options = {}) {
  const root = options.root || process.cwd();
  return {
    name: 'vite-plugin-content-index',
    configureServer(server) {
      server.watcher.on('all', () => {
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
      });
    },
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    load: (id) => (id === RESOLVED_ID ? `export const posts = ${JSON.stringify(compileIndex(root))};\n` : null),
  };
}
