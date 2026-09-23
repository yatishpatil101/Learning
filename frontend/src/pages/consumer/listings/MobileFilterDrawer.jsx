import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import useSwipeDismiss from '../../../lib/useSwipeDismiss.js';
import Filters from './Filters.jsx';

export default function MobileFilterDrawer({ drawer, setDrawer, f, set, localities, onAddLocality, clearAll, total = 0 }) {
  const { t } = useTranslation();
  /* The panel enters from the left, so the gesture that dismisses it is a drag
     back the way it came. Its content scrolls vertically, which leaves the
     horizontal axis free and unambiguous.

     Matched to the panel's own `lg:hidden`, but gated on a coarse pointer: the hook arms on any
     pointerdown in the panel, so on a mouse-driven window narrowed below 1024px a leftward
     drag to select a locality name would otherwise close the drawer mid-selection. */
  const swipe = useSwipeDismiss(() => setDrawer(false), { axis: 'x', query: '(max-width: 1023.98px) and (pointer: coarse)' });
  return (
    <>
      {/* Mobile filter drawer */}
      <div className={'filter-overlay lg:hidden ' + (drawer ? 'open' : '')} onClick={() => setDrawer(false)} />
      {/* The close button and the backdrop stay the accessible ways out; the drag
          is an additive touch affordance. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div {...swipe} className={'filter-panel lg:hidden flex flex-col ' + (drawer ? 'open' : '')} aria-label={t('listings.filters')}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <h3 className="text-lg font-bold text-white">{t('listings.filters')}</h3>
          <button onClick={() => setDrawer(false)} aria-label={t('listings.closeFilters')} className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-white/10 t-all">
            <Icon name="x" className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 pb-6 filter-scroll">
          <Filters f={f} set={set} localities={localities} onAddLocality={onAddLocality} clearAll={clearAll} idp="m-" showClear={false} />
        </div>
        {/* The drawer is pinned to the viewport bottom, so the action that is the whole point of it
            would otherwise sit inside the home-indicator zone on a gesture-bar phone. */}
        <div data-testid="filter-drawer-actions" className="shrink-0 flex items-center gap-2 border-t border-white/10 px-3 pt-3 pb-[calc(0.75rem+var(--dz-safe-b))]" style={{ background: '#1a1730' }}>
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
