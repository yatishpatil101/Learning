import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';

/* Renders compiled article HTML.
 *
 * The HTML is produced at build time from Markdown authored in this repository
 * (see scripts/vite-plugin-help-content.mjs). It is trusted content, and raw HTML
 * inside the Markdown source is dropped by the compiler, so no untrusted markup
 * can reach this component.
 *
 * Two behaviours are attached to the rendered tree rather than baked into the
 * HTML, because they need the router and the DOM:
 *   1. Internal links are routed through react-router instead of triggering a
 *      full page load.
 *   2. External links get the usual rel/target hardening. */

export default function ArticleProse({ html }) {
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;

    root.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer nofollow');
      }
    });

    const onClick = (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a || !root.contains(a)) return;
      const href = a.getAttribute('href') || '';
      // Same-page anchors keep their native behaviour; absolute URLs open normally.
      if (!href.startsWith('/') || href.startsWith('//')) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(href);
    };

    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [html, navigate]);

  return (
    <div
      ref={ref}
      className="doc-prose"
      /* eslint-disable-next-line react/no-danger -- build-time compiled, in-repo Markdown; see file header */
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
