import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import RotatingNoun from '../../components/RotatingNoun.jsx';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import { STATS } from '../../data/homeData.js';
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

  return (
    <div ref={rootRef}>
      {/* HERO — on mobile this is deliberately just the headline, the inventory
          count and the live ticker. min-h-[100dvh] is restored at lg: on a phone
          it guaranteed a full empty screen before any stock could appear, which
          no amount of content trimming could beat.

          Home is selfPadded in ConsumerLayout, so it reserves the fixed navbar itself:
          --pn-nav-h plus this section's own gap. The gaps are chosen so that ≥768px
          resolves to exactly the 109px this used to hardcode — desktop is unchanged —
          while phones inherit the shorter bar and gain the difference. */}
      <section className="hero-bg relative lg:min-h-[100dvh] flex items-center justify-center pt-[calc(var(--pn-nav-h)+28px)] sm:pt-[calc(var(--pn-nav-h)+37px)] pb-7 sm:pb-16">
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

          {/* On mobile the four proof chips replace this sentence — a phone
              visitor gets the objections answered instead of a marketing line.
              Restored at lg. A city with no stock has no chips to show, so it
              keeps the "just launched" sentence at every width. */}
          <p className={'hero-sub text-base sm:text-lg md:text-xl text-gray-300 max-w-4xl lg:whitespace-nowrap mx-auto mb-6 leading-relaxed ' + (hasData ? 'hidden lg:block' : '')}>
            {hasData ? (
              <>{t('home.hero.discoverLead')} <span className="text-white font-semibold">{STATS.properties}</span> {t('home.hero.discoverTail', { city })}</>
            ) : (
              <>{t('home.hero.launchedLead')} <span className="text-white font-semibold">{city}</span> {t('home.hero.launchedTail')}</>
            )}
          </p>

          {hasData ? <TrustChips compact className="lg:hidden mb-6" /> : null}

          <TrustChips className="hidden lg:flex mb-[30px]" />

          {/* Desktop-only. On a phone this panel cost 286px of the first screen and
              pushed real inventory 1.5 screens down; the bottom nav's Search tab goes
              straight to /listings, which carries the same controls above live
              results. Unchanged at lg and up. */}
          <div className="hidden lg:block">
            <HeroSearchPanel />
          </div>

          {hasData ? <HeroStats className="hidden lg:flex mt-[34px]" /> : null}

          {hasData ? <ActivityTicker /> : null}
        </div>

        {/* Scrim that lands the animated hero gradient on the page colour.

            It overhangs the section by 1px on purpose. The gradient underneath
            runs through teal (#0d9488), and at fractional zoom / DPR the section
            box and this absolutely-positioned child round to different device
            pixels — leaving a bright teal hairline along the seam with the
            section below. Overhanging guarantees the scrim always covers the
            last row, and the 1px it spills is the same colour as the page. */}
        <div className="absolute -bottom-px left-0 w-full h-[calc(8rem+1px)] bg-gradient-to-t from-[#0f0d1a] to-transparent" />
      </section>

      {hasData ? (
        <>
          {/* Mobile reorders these three by CSS so real stock is the first thing
              a visitor sees, then how to browse, then why to trust us. The DOM
              order is left alone, so the desktop tree — and every desktop
              assertion written against it — is untouched. */}
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
