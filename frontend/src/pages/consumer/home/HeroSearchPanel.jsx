import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import HeroSearch from './HeroSearch.jsx';
import { popularChipsFor } from '../../../data/homeData.js';
import { getRecentSearches } from '../../../lib/localPrefs.js';
import { useCity } from '../../../context/CityContext.jsx';

/* The whole search surface: the Buy/Rent + query + Type + BHK panel, the map
   entry point, and the popular/recent locality chips.

   Extracted from Home so the desktop hero and the mobile search sheet render
   one source of truth instead of two drifting copies. Exactly one of the two is
   ever displayed (the hero copy is `display: none` below lg), so the
   accessibility tree never sees a duplicate. */
export default function HeroSearchPanel({ idPrefix = '' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { city } = useCity();
  const popularChips = popularChipsFor(city);
  // Return visitors see their own recent searches here; first-time visitors get
  // popular localities. One row, no redundant Recent + Popular stacking.
  const [recentSearches] = useState(() => getRecentSearches());
  const hasRecent = recentSearches.length > 0;

  return (
    <>
      <HeroSearch idPrefix={idPrefix} />

      {/* Map entry point — promoted to its own row so it reads as a clear
          alternative to text search instead of getting lost among recent chips.
          Negative offset trims HeroSearch's mb-8 so the gap matches the buy/rent → search-bar spacing. */}
      <div className="flex justify-center -mt-4">
        <button onClick={() => navigate('/listings?view=map')} className="group inline-flex items-center gap-2 px-4 py-2 min-h-[44px] lg:min-h-0 rounded-full text-sm font-semibold text-teal-100 bg-teal-500/15 border border-teal-400/40 hover:bg-teal-500/25 hover:border-teal-400/60 hover:text-white transition-all shadow-sm shadow-teal-500/10">
          <Icon name="map" className="w-4 h-4 text-teal-300 group-hover:text-teal-200" />
          {t('home.hero.exploreMap')}
          <Icon name="arrow-right" className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>

      <div className="hero-chips flex items-center justify-center flex-wrap gap-2 mt-4">
        {hasRecent ? (
          <>
            <span className="inline-flex items-center gap-1 text-xs text-gray-500 mr-0.5"><Icon name="history" className="w-3.5 h-3.5" /> {t('home.hero.recent')}</span>
            {recentSearches.slice(0, 2).map((r, i) => (
              <button key={r.url + r.label} onClick={() => navigate(r.url)} className={'px-3 py-1.5 min-h-[44px] lg:min-h-0 rounded-full text-xs font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-teal-400/40 hover:text-white transition-all ' + (i >= 1 ? 'hidden sm:inline-flex' : '')}>{r.label}</button>
            ))}
          </>
        ) : popularChips.length ? (
          <>
            <span className="text-xs text-gray-500 mr-0.5">{t('home.hero.popular')}</span>
            {popularChips.map(([label, deal]) => (
              <button key={label} onClick={() => navigate(`/listings?deal=${deal}&loc=${encodeURIComponent(label)}`)} className="px-3 py-1.5 min-h-[44px] lg:min-h-0 rounded-full text-xs font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-teal-400/40 hover:text-white transition-all">{label}</button>
            ))}
          </>
        ) : null}
      </div>
    </>
  );
}
