import { Children, cloneElement, isValidElement, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import Icon from './Icon.jsx';

/* Shared shell for legal/policy pages — renders a centred prose column with a
   consistent header, an auto-generated "On this page" table of contents built
   from the page's <h2> headings, cross-links to the other policies, a back-to-top
   control, and the document <title>. Pages only author their prose; this shell
   handles navigation, anchors, and chrome so all four stay consistent. */

const POLICIES = [
  ['Privacy Policy', '/privacy', 'privacy'],
  ['Terms of Service', '/terms', 'terms'],
  ['Refund Policy', '/refund-policy', 'refund-policy'],
  ['Disclaimer', '/disclaimer', 'disclaimer'],
];

function textOf(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf(node.props.children);
  return '';
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/^\s*\d+[.)]\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches;
const isMobile = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;

export default function LegalPage({ title, lastUpdated, current, children }) {
  const [showTop, setShowTop] = useState(false);
  // TOC is a scanning aid, not the content. On phones a 10–13 item list buries
  // the policy below the fold, so start collapsed there and open on desktop.
  const [tocOpen, setTocOpen] = useState(isDesktop);

  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · PuneNest`;
    return () => { document.title = prev; };
  }, [title]);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Build the TOC from top-level <h2> headings and inject matching anchor ids.
  const { toc, enhanced } = useMemo(() => {
    const items = [];
    const seen = new Map();
    const mapped = Children.map(children, (child) => {
      if (isValidElement(child) && child.type === 'h2') {
        const label = textOf(child.props.children).trim();
        let id = slugify(label);
        const count = seen.get(id) || 0;
        seen.set(id, count + 1);
        if (count) id = `${id}-${count + 1}`;
        items.push({ id, label });
        return cloneElement(child, { id, style: { ...(child.props.style || {}), scrollMarginTop: '96px' } });
      }
      return child;
    });
    return { toc: items, enhanced: mapped };
  }, [children]);

  const jump = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (isMobile()) setTocOpen(false);
  };

  const related = POLICIES.filter(([, , slug]) => slug !== current);

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-20">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-teal-400 transition-colors mb-6 sm:mb-8">
        <Icon name="arrow-left" className="w-4 h-4" /> Back to home
      </Link>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-white mb-2">{title}</h1>
      {lastUpdated && <p className="text-xs text-gray-500 mb-6 sm:mb-8">Last updated: {lastUpdated}</p>}

      {toc.length > 1 && (
        <details
          open={tocOpen}
          onToggle={(e) => setTocOpen(e.currentTarget.open)}
          className="legal-toc mb-8 sm:mb-10 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5"
        >
          <summary className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold uppercase tracking-widest text-gray-400">
            <Icon name="list" className="w-4 h-4 text-teal-400" /> On this page
            <span className="text-gray-600 normal-case tracking-normal font-normal">({toc.length})</span>
            <Icon name="chevron-down" className="legal-toc-caret ml-auto w-4 h-4 text-gray-500 transition-transform" />
          </summary>
          <ul className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-0.5">
            {toc.map(({ id, label }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => jump(id)}
                  className="block w-full text-left text-sm text-gray-400 hover:text-teal-400 transition-colors py-1.5"
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="legal-prose space-y-6">
        {enhanced}
      </div>

      <div className="mt-14 pt-8 border-t border-white/5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Related policies</p>
        <nav aria-label="Related policies" className="flex flex-wrap gap-2 mb-6">
          {related.map(([label, to]) => (
            <Link
              key={to}
              to={to}
              className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs text-gray-400 hover:text-teal-400 hover:border-teal-400/40 transition-colors"
            >
              {label}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-gray-600">
          If you have questions about this policy, contact us at{' '}
          <a href="mailto:legal@punenest.com" className="text-teal-400 hover:underline">legal@punenest.com</a>.
        </p>
      </div>

      {showTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          className="fixed bottom-[calc(var(--pn-bottom-inset)+1rem)] left-4 z-[60] w-11 h-11 rounded-full bg-teal-500 text-white shadow-lg shadow-teal-500/25 flex items-center justify-center hover:bg-teal-400 transition-colors lg:bottom-24 lg:left-auto lg:right-6 lg:z-40"
        >
          <Icon name="arrow-up" className="w-5 h-5" />
        </button>
      )}
    </article>
  );
}
