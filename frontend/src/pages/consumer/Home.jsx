import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import RotatingNoun from '../../components/RotatingNoun.jsx';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import { STATS, popularChipsFor } from '../../data/homeData.js';
import { getRecentSearches } from '../../lib/store.js';
import { useCity } from '../../context/CityContext.jsx';
import { cityHasData } from '../../lib/geoConfig.js';
import NewCityEmptyState from '../../components/city/NewCityEmptyState.jsx';
import HeroSearch from './home/HeroSearch.jsx';
import ActivityTicker from './home/ActivityTicker.jsx';
import Categories from './home/Categories.jsx';
import Featured from './home/Featured.jsx';
import SocietiesSection from './home/SocietiesSection.jsx';
import RecentlyViewed from './home/RecentlyViewed.jsx';
import ShareFlatSection from './home/ShareFlatSection.jsx';
import WhyChooseUs from './home/WhyChooseUs.jsx';
import Testimonials from './home/Testimonials.jsx';
import CtaSection from './home/CtaSection.jsx';
import FaqSection from './home/FaqSection.jsx';
import NotifyMe from '../../components/pmf/NotifyMe.jsx';

export default function Home() {
  const { t } = useTranslation();
  const rootRef = useScrollReveal();
  const navigate = useNavigate();
  // Active city drives all city-facing copy + which sections render. Cities we have no
  // inventory for (everything but Pune today) get city-aware copy and an honest empty
  // state instead of Pune content.
  const { city } = useCity();
  const hasData = cityHasData(city);
  const popularChips = popularChipsFor(city);
  // Return visitors see their own recent searches here; first-time visitors get
  // popular localities. One row, no redundant Recent + Popular stacking.
  const [recentSearches] = useState(() => getRecentSearches());
  const hasRecent = recentSearches.length > 0;

  return (
    <div ref={rootRef}>
      {/* HERO */}
      <section className="hero-bg relative min-h-[100dvh] flex items-center justify-center pt-[92px] sm:pt-[109px] pb-12 sm:pb-16">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="shape shape-1" />
          <div className="shape shape-2" />
          <div className="shape shape-3" />
          <div className="shape shape-4" />
          <div className="shape shape-5" />
        </div>
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: "url('data:image/svg+xml,%3Csvg viewBox=%220 0 256 256%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%224%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22/%3E%3C/svg%3E')" }} />

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold leading-tight mb-3 sm:mb-5">
            <span className="hero-word">Find</span>{' '}
            <span className="hero-word">Your</span>{' '}
            <span className="hero-word">Dream</span>{' '}
            <span className="hero-word align-baseline"><RotatingNoun /></span>{' '}
            <span className="hero-word">in</span>{' '}
            <span className="hero-word bg-gradient-to-r from-[#fb923c] to-[#f97316] bg-clip-text text-transparent">{city}</span>
          </h1>

          <p className="hero-sub text-base sm:text-lg md:text-xl text-gray-300 max-w-4xl lg:whitespace-nowrap mx-auto mb-6 leading-relaxed">
            {hasData ? (
              <>{t('home.hero.discoverLead')} <span className="text-white font-semibold">{STATS.properties}</span> {t('home.hero.discoverTail', { city })}</>
            ) : (
              <>{t('home.hero.launchedLead')} <span className="text-white font-semibold">{city}</span> {t('home.hero.launchedTail')}</>
            )}
          </p>

          <div className="hero-trust flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 mb-[30px]">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs sm:text-sm font-semibold"><Icon name="shield-check" className="w-4 h-4" /> {t('home.hero.trustAadhaar')}</span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/25 text-teal-300 text-xs sm:text-sm font-semibold"><Icon name="hand-coins" className="w-4 h-4" /> {t('home.hero.trustZeroBrokerage')}</span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/25 text-teal-300 text-xs sm:text-sm font-semibold"><Icon name="phone-off" className="w-4 h-4" /> {t('home.hero.trustNoSpam')}</span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs sm:text-sm font-semibold"><Icon name="badge-check" className="w-4 h-4" /> {t('home.hero.trustAssured')}</span>
          </div>

          <HeroSearch />

          {/* Map entry point — promoted to its own row so it reads as a clear
              alternative to text search instead of getting lost among recent chips.
              Negative offset trims HeroSearch's mb-8 so the gap matches the buy/rent → search-bar spacing. */}
          <div className="flex justify-center -mt-4">
            <button onClick={() => navigate('/listings?view=map')} className="group inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold text-teal-100 bg-teal-500/15 border border-teal-400/40 hover:bg-teal-500/25 hover:border-teal-400/60 hover:text-white transition-all shadow-sm shadow-teal-500/10">
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
                  <button key={r.url + r.label} onClick={() => navigate(r.url)} className={'px-3 py-1.5 rounded-full text-xs font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-teal-400/40 hover:text-white transition-all ' + (i >= 1 ? 'hidden sm:inline-flex' : '')}>{r.label}</button>
                ))}
              </>
            ) : popularChips.length ? (
              <>
                <span className="text-xs text-gray-500 mr-0.5">{t('home.hero.popular')}</span>
                {popularChips.map(([label, deal]) => (
                  <button key={label} onClick={() => navigate(`/listings?deal=${deal}&loc=${encodeURIComponent(label)}`)} className="px-3 py-1.5 rounded-full text-xs font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-teal-400/40 hover:text-white transition-all">{label}</button>
                ))}
              </>
            ) : null}
          </div>

          {hasData ? (
            <div className="hero-stats flex items-center justify-center flex-wrap gap-6 sm:gap-12 mt-[34px]">
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-extrabold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent" style={{ fontVariantNumeric: 'tabular-nums' }}>{STATS.properties}</div>
                <div className="text-xs sm:text-sm text-gray-400 mt-1">{t('home.hero.statProperties')}</div>
              </div>
              <div className="w-px h-10 bg-white/10 hidden sm:block" />
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-extrabold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent" style={{ fontVariantNumeric: 'tabular-nums' }}>{STATS.verifiedOwners}</div>
                <div className="text-xs sm:text-sm text-gray-400 mt-1">{t('home.hero.statVerifiedOwners')}</div>
              </div>
              <div className="w-px h-10 bg-white/10 hidden sm:block" />
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-extrabold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent" style={{ fontVariantNumeric: 'tabular-nums' }}>{STATS.localities}</div>
                <div className="text-xs sm:text-sm text-gray-400 mt-1">{t('home.hero.statLocalities')}</div>
              </div>
            </div>
          ) : null}

          {hasData ? <ActivityTicker /> : null}
        </div>

        <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-[#0f0d1a] to-transparent" />
      </section>

      {hasData ? (
        <>
          {/* CATEGORIES */}
          <Categories navigate={navigate} />

          {/* FEATURED */}
          <Featured navigate={navigate} />

          {/* EXPLORE SOCIETIES — society-first discovery entry point */}
          <SocietiesSection />

          {/* RECENTLY VIEWED — return-visitor rail (renders only if history exists) */}
          <RecentlyViewed />

          {/* SHARE A FLAT */}
          <ShareFlatSection navigate={navigate} />
        </>
      ) : (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
          <NewCityEmptyState city={city} context="home" />
        </section>
      )}

      {/* WHY CHOOSE US — asymmetric bento */}
      <WhyChooseUs navigate={navigate} />

      {/* TESTIMONIALS */}
      <Testimonials />

      {/* CTA */}
      <CtaSection navigate={navigate} />

      {/* PMF early-access capture (renders only when VITE_PMF_MODE=on) */}
      <NotifyMe />

      {/* FAQ */}
      <FaqSection />
    </div>
  );
}
