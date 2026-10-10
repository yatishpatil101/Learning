import { useEffect } from 'react';

const SITE = 'https://draazy.com';

/* A prerendered page's tags hold that page's values, not the app's. `data-shell` (set by
   scripts/vite-plugin-blog.mjs) is the app-wide value to restore; empty means the shell had none. */
function previousValue(el, attr) {
  const shell = el.getAttribute('data-shell');
  el.removeAttribute('data-shell');
  return shell ?? el.getAttribute(attr);
}

function upsert(tag, match, attr, value) {
  const selector = `${tag}${Object.entries(match).map(([k, v]) => `[${k}="${v}"]`).join('')}`;
  let el = document.head.querySelector(selector);
  const created = !el;
  if (created) {
    el = document.createElement(tag);
    Object.entries(match).forEach(([k, v]) => el.setAttribute(k, v));
    document.head.appendChild(el);
  }
  const prev = created ? null : previousValue(el, attr);
  el.setAttribute(attr, value);
  return () => (created || !prev ? el.remove() : el.setAttribute(attr, prev));
}

/** Mirrors the prerendered head (scripts/vite-plugin-blog.mjs) after client-side navigation. */
export default function usePageHead({ title, description, path, noindex = false }) {
  useEffect(() => {
    // Nothing to say yet (a page still loading its record): leave the head as it is.
    if (!title) return undefined;
    const titleEl = document.querySelector('title');
    const prevTitle = (titleEl && titleEl.getAttribute('data-shell')) ?? document.title;
    titleEl?.removeAttribute('data-shell');
    document.title = title;
    const restores = [
      description && upsert('meta', { name: 'description' }, 'content', description),
      path && upsert('link', { rel: 'canonical' }, 'href', `${SITE}${path}`),
      noindex && upsert('meta', { name: 'robots' }, 'content', 'noindex'),
    ].filter(Boolean);
    return () => {
      document.title = prevTitle;
      restores.forEach((restore) => restore());
    };
  }, [title, description, path, noindex]);
}
