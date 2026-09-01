import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';

/* "On this page" navigation.
 *
 * Two variants, because the same list needs two very different shapes:
 *   - `rail`   sticky right-hand column with scroll-spy, wide screens only
 *   - `inline` collapsed <details> above the article on narrower screens
 *
 * The inline variant starts closed for the same reason LegalPage.jsx collapses
 * its TOC on phones: a long link list between the title and the first paragraph
 * pushes the content the reader came for below the fold.
 *
 * The page renders both and lets CSS pick one, so only the rail runs scroll-spy. */

export default function ArticleToc({ headings, variant = 'inline' }) {
  const { t } = useTranslation();
  const isRail = variant === 'rail';
  const [activeId, setActiveId] = useState('');

  useEffect(() => {
    if (!isRail || !headings.length) return undefined;

    // Trigger the highlight when a heading crosses the upper third of the
    // viewport, so the marker tracks what is being read rather than what has
    // just scrolled past the very top.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-96px 0px -66% 0px', threshold: 0 },
    );

    headings.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [headings, isRail]);

  if (headings.length < 2) return null;

  const jump = (e, id) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
    // Keep the URL shareable without the jump-then-scroll flash a plain hash causes.
    window.history.replaceState(null, '', `#${id}`);
  };

  const links = (
    <ul className="space-y-0.5">
      {headings.map(({ id, text, level }) => (
        <li key={id}>
          <a
            href={`#${id}`}
            onClick={(e) => jump(e, id)}
            aria-current={isRail && activeId === id ? 'location' : undefined}
            className={`block border-l-2 py-1.5 text-[13px] leading-snug transition-colors ${
              level === 3 ? 'pl-6' : 'pl-3'
            } ${
              isRail && activeId === id
                ? 'border-teal-400 text-teal-300'
                : 'border-white/10 text-gray-500 hover:border-white/30 hover:text-gray-300'
            }`}
          >
            {text}
          </a>
        </li>
      ))}
    </ul>
  );

  if (isRail) {
    return (
      <nav aria-label={t('help.onThisPage')} className="hidden xl:block">
        <div className="sticky top-[calc(var(--dz-nav-h)+4.5rem)] max-h-[calc(100vh-var(--dz-nav-h)-6rem)] overflow-y-auto py-1">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-gray-500">{t('help.onThisPage')}</p>
          {links}
        </div>
      </nav>
    );
  }

  return (
    <details className="doc-toc mb-8 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 xl:hidden">
      <summary className="flex cursor-pointer select-none items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
        <Icon name="list" className="w-4 h-4 text-teal-400" /> {t('help.onThisPage')}
        <span className="font-normal normal-case tracking-normal text-gray-600">({headings.length})</span>
        <Icon name="chevron-down" className="doc-toc-caret ml-auto w-4 h-4 text-gray-500 transition-transform" />
      </summary>
      <div className="mt-3">{links}</div>
    </details>
  );
}
