import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Filters from './Filters.jsx';

export default function MobileFilterDrawer({ drawer, setDrawer, f, set, localities, onAddLocality, clearAll, total = 0 }) {
  const { t } = useTranslation();
  return (
    <>
      {/* Mobile filter drawer */}
      <div className={'filter-overlay lg:hidden ' + (drawer ? 'open' : '')} onClick={() => setDrawer(false)} />
      <div className={'filter-panel lg:hidden flex flex-col ' + (drawer ? 'open' : '')} aria-label={t('listings.filters')}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <h3 className="text-lg font-bold text-white">{t('listings.filters')}</h3>
          <button onClick={() => setDrawer(false)} aria-label={t('listings.closeFilters')} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 t-all">
            <Icon name="x" className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 pb-6 filter-scroll">
          <Filters f={f} set={set} localities={localities} onAddLocality={onAddLocality} clearAll={clearAll} idp="m-" showClear={false} />
        </div>
        <div className="shrink-0 flex items-center gap-2 border-t border-white/10 p-3" style={{ background: '#1a1730' }}>
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
