import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import RotatingNoun from '../../components/RotatingNoun.jsx';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import { useCity } from '../../context/CityContext.jsx';
import { cityHasData } from '../../lib/geoConfig.js';
import NewCityEmptyState from '../../components/city/NewCityEmptyState.jsx';
import HeroSearchPanel from './home/HeroSearchPanel.jsx';
import MobileTrustProof, { TrustChips, HeroStats } from './home/TrustProof.jsx';
import ActivityTicker from './home/ActivityTicker.jsx';
import Categories from './home/Categories.jsx';
import Featured from './home/Featured.jsx';
import SocietiesSection from './home/SocietiesSection.jsx';
import RecentlyViewed from './home/RecentlyViewed.jsx';
import FlatmatesSection from './home/FlatmatesSection.jsx';
import WhyChooseUs from './home/WhyChooseUs.jsx';
import CtaSection from './home/CtaSection.jsx';
import FaqSection from './home/FaqSection.jsx';
import NotifyMe from '../../components/pmf/NotifyMe.jsx';

const ExploreStrips = lazy(() => import('./home/ExploreStrips.jsx'));

const LG = '(min-width: 1024px)';

export default function Home() {
  const { t } = useTranslation();
  const rootRef = useScrollReveal();
  const navigate = useNavigate();
  // Cities without inventory (all but Pune) get city-aware copy and an honest empty state instead of Pune content.
  const { city } = useCity();
  const hasData = cityHasData(city);
  const [wide, setWide] = useState(() => window.matchMedia(LG).matches);
  useEffect(() => {
    const mq = window.matchMedia(LG);
    const onChange = (e) => setWide(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <div ref={rootRef}>
      {/* HERO: `min-h-[100dvh]` applies only at lg. Home is selfPadded, so it reserves the navbar itself. */}
      <section className="hero-bg relative lg:min-h-[100dvh] flex items-center justify-center pt-[calc(var(--dz-nav-h)+28px)] sm:pt-[calc(var(--dz-nav-h)+37px)] pb-7 sm:pb-16">
        <div className="absolute inset-0 overflow-hidden rounded-[inherit] pointer-events-none">
          <div className="shape shape-1" />
          <div className="shape shape-2" />
          <div className="shape shape-3" />
          <div className="shape shape-4" />
          <div className="shape shape-5" />
          <div className="hero-mist" />
        </div>
        <div className="absolute inset-0 rounded-[inherit] opacity-[0.03] pointer-events-none" style={{ backgroundImage: "url('data:image/svg+xml,%3Csvg viewBox=%220 0 256 256%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%224%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22/%3E%3C/svg%3E')        " }} />

                <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold leading-tight mb-3 sm:mb-5">
            <span className="hero-word">Find</span>{' '}
            <span className="hero-word">Your</span>{' '}
            <span className="hero-word">Dream</span>{' '}
            <span className="hero-word hero-noun align-baseline"><RotatingNoun /></span>{' '}
            <span className="hero-word">in</span>{' '}
            <span className="hero-word hero-city bg-gradient-to-r from-orange-400 to-orange-500 bg-clip-text text-transparent">{city}</span>
          </h1>

          {/* On mobile the four proof chips replace this sentence; a city with no stock has no chips,
              so it keeps this one at every width. */}
          <p className={'hero-sub text-base sm:text-lg md:text-xl text-gray-300 max-w-4xl lg:whitespace-nowrap mx-auto mb-6 leading-relaxed ' + (hasData ? 'hidden lg:block' : '')}>
            {hasData ? (
              <>{t('home.hero.discoverLead', { city })} {t('home.hero.discoverTail')}</>
            ) : (
              <>{t('home.hero.launchedLead')} <span className="text-white font-semibold">{city}</span> {t('home.hero.launchedTail')}</>
            )}
          </p>

          {hasData ? <TrustChips compact className="lg:hidden mb-6" /> : null}

          <TrustChips className="hidden lg:flex mb-[30px]" />

          {/* Desktop-only: on a phone the bottom nav's Search tab goes straight to /listings.
              Not mounted below lg, so a phone never fetches the panel's recent-searches rail. */}
          <div className="hidden lg:block">
            {wide ? <HeroSearchPanel /> : null}
          </div>

          {hasData ? <HeroStats className="hidden lg:flex mt-[34px]" /> : null}

          {hasData ? <ActivityTicker /> : null}
        </div>

        {/* Overhangs 1px because at fractional zoom/DPR this scrim and the section round to different pixels,
            leaving a teal hairline. */}
        <div className="hero-scrim absolute -bottom-px left-0 w-full h-[calc(8rem+1px)] bg-gradient-to-t from-page to-transparent" />
      </section>

      {hasData ? (
        <>
          {/* Mobile reorders these by CSS so real stock comes first; DOM
              order stays so the desktop tree and its assertions hold. */}
          <div className="flex flex-col">
            {/* CATEGORIES */}
            <div className="order-2 lg:order-none">
              <Categories navigate={navigate} />
            </div>

            {/* FEATURED */}
            <div className="order-1 lg:order-none">
              <Featured navigate={navigate} />
            </div>

            {/* Trust chips + stats, relocated out of the mobile hero. */}
            <div className="order-3 lg:order-none">
              <MobileTrustProof />
            </div>
          </div>

          {/* EXPLORE SOCIETIES — society-first discovery entry point */}
          <SocietiesSection />

          {/* RECENTLY VIEWED — return-visitor rail (renders only if history exists) */}
          <RecentlyViewed />

          {/* FLATMATES */}
          <FlatmatesSection navigate={navigate} />
        </>
      ) : (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
          <NewCityEmptyState city={city} context="home" />
        </section>
      )}

      {/* WHY CHOOSE US — asymmetric bento */}
      <WhyChooseUs navigate={navigate} hasData={hasData} />

      {/* CTA */}
      <CtaSection navigate={navigate} />

      {/* PMF early-access capture (renders only when VITE_PMF_MODE=on) */}
      <NotifyMe />

      {/* FAQ */}
      <FaqSection />

      {hasData ? <Suspense fallback={null}><ExploreStrips /></Suspense> : null}
    </div>
  );
}
