import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';

/* The HTML is compiled at build time from repo-authored Markdown and raw HTML in the source is dropped, so no
   untrusted markup can reach here; links are handled on the rendered tree because they need the router and DOM. */

export default function ArticleProse({ html, resolveHref }) {
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
      } else if (resolveHref && href.startsWith('/')) {
        a.setAttribute('href', resolveHref(href));
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
  }, [html, navigate, resolveHref]);

  return (
    <div
      ref={ref}
      className="doc-prose"
      /* eslint-disable-next-line react/no-danger -- build-time compiled, in-repo Markdown; see file header */
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
