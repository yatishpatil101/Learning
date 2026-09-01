import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import HelpSearch from './HelpSearch.jsx';
import HelpSidebar from './HelpSidebar.jsx';
import { isStaff } from '../../lib/help.js';
import { useHelpTree, useHelpPath } from '../../lib/useHelp.js';
import { useAuth } from '../../context/AuthContext.jsx';

/* Shell shared by every help centre page.
 *
 * Layout follows the convention readers already know from documentation sites:
 * a persistent topic rail on the left, content in the middle, and a sticky utility
 * bar carrying search. Below `lg` the rail becomes a drawer, because a 40-item
 * nav above the article is worse than no nav at all on a phone.
 *
 * Pages pass `wide` when they render their own full-width composition (the
 * landing page), which drops the rail entirely for that route. */

/* `prefixed: false` marks a destination outside the help centre. /support is a
   normal app route with no language prefix, so passing it through the help path
   helper would produce /mr/support, which does not exist. */
const UTILITY_LINKS = [
  ['help.faq', '/help/faq', 'help-circle', true],
  ['help.changelog', '/help/changelog', 'megaphone', true],
  ['help.contactSupport', '/support', 'life-buoy', false],
];

export default function HelpLayout({ children, wide = false, title }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { sections, categories, articles } = useHelpTree();
  const hp = useHelpPath();

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // The drawer is a modal surface: lock the page behind it and let Escape close it.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!title) return undefined;
    const prev = document.title;
    document.title = `${title} · Draazy ${t('help.centre')}`;
    return () => { document.title = prev; };
  }, [title, t]);

  return (
    <div className="min-h-[60vh]">
      {/* Utility bar — search, section links, and the mobile drawer trigger. */}
      <div className="sticky top-[var(--dz-nav-h)] z-30 border-b border-white/10 bg-[#0f0d1a]/95 backdrop-blur supports-[backdrop-filter]:bg-[#0f0d1a]/80">
        <div className="mx-auto flex max-w-[88rem] items-center gap-3 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            aria-controls="help-drawer"
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 min-h-[44px] text-xs font-semibold text-gray-300 hover:text-white lg:hidden"
          >
            <Icon name="menu" className="w-4 h-4" /> {t('help.topics')}
          </button>

          <Link to={hp('/help')} className="hidden shrink-0 items-center gap-2 lg:flex">
            <Icon name="book-open" className="w-5 h-5 text-teal-400" />
            <span className="text-sm font-bold text-white">{t('help.centre')}</span>
          </Link>

          <div className="min-w-0 flex-1 lg:max-w-md">
            <HelpSearch variant="bar" />
          </div>

          <nav aria-label={t('help.searchSections')} className="hidden shrink-0 items-center gap-1 lg:flex">
            {UTILITY_LINKS.map(([key, to, icon, prefixed]) => (
              <Link
                key={to}
                to={prefixed ? hp(to) : to}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-gray-400 transition-colors hover:bg-white/[0.04] hover:text-white"
              >
                <Icon name={icon} className="w-3.5 h-3.5" /> {t(key)}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className={`mx-auto w-full px-4 sm:px-6 ${wide ? 'max-w-[88rem]' : 'max-w-[88rem] lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10'}`}>
        {!wide && (
          <aside className="hidden lg:block">
            <div className="sticky top-[calc(var(--dz-nav-h)+4.5rem)] max-h-[calc(100vh-var(--dz-nav-h)-6rem)] overflow-y-auto py-8 pr-2">
              <HelpSidebar sections={sections} categories={categories} articles={articles} />
              {isStaff(user) && (
                <p className="mt-8 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-relaxed text-amber-200/80">
                  {t('help.staffSidebarNote')}
                </p>
              )}
            </div>
          </aside>
        )}

        <div className="min-w-0 py-8 sm:py-10">{children}</div>
      </div>

      {/* Mobile topic drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <button
            type="button"
            aria-label={t('help.close')}
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/70"
          />
          <div
            id="help-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t('help.helpTopics')}
            className="absolute inset-y-0 left-0 flex w-[85vw] max-w-sm flex-col border-r border-white/10 bg-[#15122a]"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-bold text-white">
                <Icon name="book-open" className="w-4 h-4 text-teal-400" /> {t('help.helpTopics')}
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label={t('help.close')}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-white/5 hover:text-white"
              >
                <Icon name="x" className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-5">
              <HelpSidebar
                sections={sections}
                categories={categories}
                articles={articles}
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>

            <div className="grid grid-cols-3 gap-1 border-t border-white/10 p-3">
              {UTILITY_LINKS.map(([key, to, icon, prefixed]) => (
                <Link
                  key={to}
                  to={prefixed ? hp(to) : to}
                  className="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[11px] font-medium text-gray-400 hover:bg-white/5 hover:text-white"
                >
                  <Icon name={icon} className="w-4 h-4" /> {t(key)}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
