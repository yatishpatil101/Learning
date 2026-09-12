import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { excerptFor } from '../../lib/help.js';
import { useHelpSearch, useHelpPath } from '../../lib/useHelp.js';

/* Search box for the help centre.
 *
 * Two modes:
 *   - `variant="hero"`  large, centred, used on the landing page
 *   - `variant="bar"`   compact, used in the sticky docs header
 *
 * Suggestions appear inline below the field. Enter goes to the full results
 * page so a query is always shareable as a URL, which a dropdown-only search
 * cannot offer. */

export default function HelpSearch({ variant = 'bar', initialQuery = '' }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const hp = useHelpPath();

  const results = useHelpSearch(query, 6);

  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // "/" focuses search from anywhere in the help centre, the convention every
  // docs site uses. Ignored while the user is typing in another field.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const go = (slug) => {
    setOpen(false);
    setQuery('');
    navigate(hp(`/help/a/${slug}`));
  };

  const submit = (e) => {
    e.preventDefault();
    if (active >= 0 && results[active]) return go(results[active].article.slug);
    const q = query.trim();
    if (q.length >= 2) {
      setOpen(false);
      navigate(hp(`/help/search?q=${encodeURIComponent(q)}`));
    }
  };

  const onKeyDown = (e) => {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? results.length - 1 : i - 1)); }
    else if (e.key === 'Escape') { setOpen(false); setActive(-1); }
  };

  const hero = variant === 'hero';

  return (
    <div ref={wrapRef} className="relative w-full">
      <form onSubmit={submit} role="search">
        <label htmlFor="help-search" className="sr-only">{t('help.searchLabel')}</label>
        <div className="relative">
          <Icon
            name="search"
            className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 ${hero ? 'w-5 h-5' : 'w-4 h-4'}`}
          />
          <input
            id="help-search"
            ref={inputRef}
            type="search"
            role="combobox"
            value={query}
            autoComplete="off"
            placeholder={hero ? t('help.searchHeroPlaceholder') : t('help.searchPlaceholder')}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(-1); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            aria-expanded={open && results.length > 0}
            aria-controls="help-search-suggestions"
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 && results[active] ? `help-suggestion-${results[active].article.slug}` : undefined}
            className={`w-full rounded-xl border border-white/10 bg-white/[0.04] pl-11 pr-4 text-white placeholder:text-gray-500
              focus:outline-none focus:border-teal-400/50 focus:bg-white/[0.06] transition-colors
              ${hero ? 'py-3.5 text-base' : 'py-2.5 text-sm'}`}
          />
          {!hero && (
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-500 lg:block">
              /
            </kbd>
          )}
        </div>
      </form>

      {open && query.trim().length >= 2 && (
        <div
          id="help-search-suggestions"
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#15122a] shadow-2xl shadow-black/50"
        >
          {results.length === 0 ? (
            <p className="px-4 py-5 text-sm text-gray-500">
              {t('help.noResultsFor', { query: query.trim() })}{' '}
              <Link to="/support" className="text-teal-400 hover:underline" onClick={() => setOpen(false)}>
                {t('help.contactSupport').toLowerCase()}
              </Link>.
            </p>
          ) : (
            <>
              <ul className="max-h-[22rem] overflow-y-auto py-1">
                {results.map(({ article }, i) => (
                  <li key={article.slug}>
                    <button
                      type="button"
                      id={`help-suggestion-${article.slug}`}
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(article.slug)}
                      className={`block w-full px-4 py-2.5 text-left transition-colors ${i === active ? 'bg-white/[0.06]' : ''}`}
                    >
                      <span className="block text-sm font-semibold text-white">{article.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500">{excerptFor(article, query.trim())}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => { setOpen(false); navigate(hp(`/help/search?q=${encodeURIComponent(query.trim())}`)); }}
                className="block w-full border-t border-white/5 px-4 py-2.5 text-left text-xs font-semibold text-teal-400 hover:bg-white/[0.04]"
              >
                {t('help.seeAllResults', { query: query.trim() })}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
