import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import useSwipeDismiss from '../../../lib/useSwipeDismiss.js';
import useBackToClose from '../../../hooks/useBackToClose.js';
import Filters from './Filters.jsx';

export default function MobileFilterDrawer({ drawer, setDrawer, f, set, localities, onAddLocality, clearAll, total = 0, triggerRef, onBackClose }) {
  const { t } = useTranslation();
  const closeRef = useRef(null);
  const wasOpenRef = useRef(false);
  useBackToClose(drawer, () => setDrawer(false), { key: '__dzFilterSheet', onPopClose: onBackClose });
  const swipe = useSwipeDismiss(() => setDrawer(false), { axis: 'y', query: '(max-width: 1023.98px) and (pointer: coarse)', allowScrollableTop: true });

  useEffect(() => {
    if (drawer) {
      wasOpenRef.current = true;
      closeRef.current?.focus();
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef?.current?.focus();
    }
  }, [drawer, triggerRef]);

  useEffect(() => {
    if (!drawer) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setDrawer(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawer, setDrawer]);

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div className={'filter-overlay lg:hidden ' + (drawer ? 'open' : '')} onClick={() => setDrawer(false)} />
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div {...swipe} className={'filter-panel lg:hidden flex flex-col ' + (drawer ? 'open' : '')} role="dialog" aria-modal={drawer ? 'true' : undefined} aria-label={t('listings.filters')} inert={!drawer}>
        <div className="filter-panel__grabber" aria-hidden="true" />
        <div className="filter-panel__drag-zone flex items-center justify-between px-5 pt-3 pb-3 shrink-0">
          <h3 className="text-lg font-bold text-white">{t('listings.filters')}</h3>
          <button ref={closeRef} onClick={() => setDrawer(false)} aria-label={t('listings.closeFilters')} className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-white/10 t-all">
            <Icon name="x" className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 pb-6 filter-scroll">
          <Filters f={f} set={set} localities={localities} onAddLocality={onAddLocality} clearAll={clearAll} idp="m-" showClear={false} />
        </div>
        <div data-testid="filter-drawer-actions" className="shrink-0 flex items-center gap-2 border-t border-white/10 px-3 pt-3 pb-[calc(0.75rem+var(--dz-safe-b))]" style={{ background: 'rgb(var(--dz-c-ink-card))' }}>
          <span className="sr-only" aria-live="polite">
            {total === 0 ? t('listings.noMatchesSr') : t('listings.resultsMatch', { count: total })}
          </span>
          <button onClick={clearAll} className="btn btn-secondary shrink-0">{t('listings.clear')}</button>
          <button
            onClick={() => setDrawer(false)}
            className={'btn flex-1 min-w-0 ' + (total === 0 ? 'btn-secondary' : 'btn-primary')}
          >
            <span className="truncate">
              {total === 0
                ? t('listings.noMatchesShort')
                : <>{t('listings.showBtn')} <span className="font-extrabold tabular-nums">{total}</span> {t('listings.resultNoun', { count: total })}</>}
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
