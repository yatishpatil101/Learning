import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { STATS } from '../../../data/homeData.js';

export default function WhyChooseUs({ navigate }) {
  const { t } = useTranslation();
  return (
    <section className="relative section-pb">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* heading — left-aligned, not centered */}
        <div className="section-head sm:mb-10 reveal">
          <p className="text-teal-400 text-xs font-semibold tracking-widest uppercase mb-2">{t('home.why.eyebrow')}</p>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3">{t('home.why.headingLine1')}<br className="hidden sm:block" /> {t('home.why.headingLine2')}</h2>
        </div>

        {/* bento grid: hero card left + feature rows right */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

          {/* ── Hero card (spans 2/5 on desktop, full width on mobile) ── */}
          <div className="feature-card reveal glass rounded-2xl p-8 relative overflow-hidden group lg:col-span-2 flex flex-col justify-between min-h-[320px]">
            {/* ambient glow */}
            <div className="absolute -top-10 -left-10 w-56 h-56 rounded-full blur-3xl bg-teal-500/10 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-40 h-40 rounded-full blur-3xl bg-teal-400/8 pointer-events-none" />

            <div className="relative">
              <div className="w-14 h-14 mb-6 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/25">
                <Icon name="shield-check" className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-xl sm:text-2xl font-bold mb-3 leading-snug">{t('home.why.heroTitle')}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{t('home.why.heroBody')}</p>
            </div>

            <div className="relative mt-8 pt-6 border-t border-white/8 flex items-center gap-4">
              <div className="text-center">
                <p className="text-2xl font-extrabold text-white tabular-nums">{STATS.properties}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{t('home.why.statVerifiedListings')}</p>
              </div>
              <div className="w-px h-10 bg-white/10" />
              <div className="text-center">
                <p className="text-2xl font-extrabold text-white tabular-nums">{STATS.verifiedOwners}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{t('home.why.statVerifiedOwners')}</p>
              </div>
              <div className="w-px h-10 bg-white/10" />
              <div className="text-center">
                <p className="text-2xl font-extrabold text-teal-400 tabular-nums">{STATS.brokerage}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{t('home.why.statBrokerage')}</p>
              </div>
            </div>
          </div>

          {/* ── Feature rows (3/5 on desktop) ── */}
          <div className="lg:col-span-3 flex flex-col gap-5">

            {/* Row 1 — No Spam Calls */}
            <div className="feature-card reveal glass rounded-2xl p-6 relative overflow-hidden group flex items-start gap-5">
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl bg-teal-500/8 pointer-events-none" />
              <div className="relative w-12 h-12 shrink-0 rounded-xl bg-teal-500/15 flex items-center justify-center mt-0.5">
                <Icon name="phone-off" className="w-5 h-5 text-teal-400" />
              </div>
              <div className="relative min-w-0">
                <h3 className="text-base font-bold mb-1">{t('home.why.row1Title')}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{t('home.why.row1Body')}</p>
              </div>
            </div>

            {/* Row 2 — Zero Brokerage */}
            <div className="feature-card reveal glass rounded-2xl p-6 relative overflow-hidden group flex items-start gap-5">
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl bg-teal-500/8 pointer-events-none" />
              <div className="relative w-12 h-12 shrink-0 rounded-xl bg-teal-500/15 flex items-center justify-center mt-0.5">
                <Icon name="indian-rupee" className="w-5 h-5 text-teal-400" />
              </div>
              <div className="relative min-w-0">
                <h3 className="text-base font-bold mb-1">{t('home.why.row2Title')}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{t('home.why.row2Body')}</p>
              </div>
            </div>

            {/* Row 3 — End-to-End Services (CTA row) */}
            <button
              onClick={() => navigate('/services')}
              className="feature-card reveal glass rounded-2xl p-6 relative overflow-hidden group flex items-start gap-5 text-left w-full hover:border-[#fb923c]/30 transition-colors duration-300"
            >
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl bg-[#f97316]/8 pointer-events-none group-hover:bg-[#f97316]/15 transition-all duration-500" />
              <div className="relative w-12 h-12 shrink-0 rounded-xl bg-gradient-to-br from-[#f97316] to-[#fb923c] flex items-center justify-center mt-0.5 shadow-md shadow-orange-500/20">
                <Icon name="concierge-bell" className="w-5 h-5 text-white" />
              </div>
              <div className="relative min-w-0 flex-1">
                <h3 className="text-base font-bold mb-1">{t('home.why.row3Title')}</h3>
                <p className="text-sm text-gray-400 leading-relaxed mb-3">{t('home.why.row3Body')}</p>
                <span className="inline-flex items-center gap-1 text-[#fb923c] text-xs font-semibold group-hover:gap-2 transition-all duration-200">
                  {t('home.why.row3Link')} <Icon name="arrow-right" className="w-3.5 h-3.5" />
                </span>
              </div>
            </button>

          </div>
        </div>

      </div>
    </section>
  );
}
