import { Link } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { LOC } from '../../../data/localityIntel.js';
import { NAMES, fmtRs, slugifyLoc } from './helpers.js';

export default function EmergingPanel({ rootRef, emergingName, nearestIntel, invBar, alertBtn, mapCard, societiesBlock, reviewsBlock }) {
  const { t } = useTranslation();
  return (
    <div ref={rootRef} className="loc-page">
      <div className="pt-8 lg:pt-10 pb-20 min-h-[100dvh]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="reveal">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-sm font-medium mb-4"><Icon name="map-pin" className="w-4 h-4" /> {t('locality.emergingBadge')}</div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white">{emergingName}</h1>
            <p className="text-gray-400 text-sm mt-3 max-w-xl"><Trans i18nKey="locality.emergingIntro" values={{ name: emergingName }} components={{ 1: <span className="text-teal-400 font-semibold" /> }} /></p>
            <div className="flex flex-wrap items-center gap-3 mt-6">
              <Link to={`/listings?q=${encodeURIComponent(emergingName)}`} className="btn-teal px-5 py-3 rounded-xl text-white text-sm font-semibold flex items-center gap-2"><Icon name="search" className="w-4 h-4" /> {t('locality.emergingView', { name: emergingName })}</Link>
              {alertBtn}
            </div>
          </div>

          <div className="reveal">{invBar}</div>

          {mapCard}

          {/* Nearby localities with a full insight dashboard — an honest benchmark */}
          {nearestIntel.length ? (
            <div className="reveal">
              <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-1"><Icon name="trending-up" className="w-5 h-5 text-teal-400" /> {t('locality.nearbyTitle')}</h2>
              <p className="text-gray-500 text-xs mb-3">{t('locality.nearbySub', { name: emergingName })}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {nearestIntel.map((g) => (
                  <Link key={g.slug} to={`/locality/${g.slug}`} className="glass-card rounded-2xl p-4 hover:border-teal-400/30 transition-all group">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white group-hover:text-teal-300 transition-colors">{g.name}</span>
                      <span className="text-[11px] text-gray-500">{g.km.toFixed(1)} km</span>
                    </div>
                    <p className="text-xl font-bold text-white mt-2">{fmtRs(LOC[g.name].price)}<span className="text-gray-500 text-xs font-normal"> {t('locality.perSqft')}</span></p>
                    <p className="text-emerald-400 text-xs font-semibold mt-0.5">{t('locality.yoySuffix', { value: LOC[g.name].yoy.toFixed(1) })}</p>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          {societiesBlock}

          {reviewsBlock}

          <div className="reveal">
            <p className="text-xs text-gray-500 mb-2">{t('locality.fullDashList')}</p>
            <div className="flex flex-wrap gap-2">
              {NAMES.map((n) => <Link key={n} to={`/locality/${slugifyLoc(n)}`} className="chip text-xs font-medium px-3.5 py-1.5 rounded-full text-gray-300">{n}</Link>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
