import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { STATS } from '../../../data/homeData.js';

export default function Testimonials() {
  const { t } = useTranslation();
  return (
    <section className="relative section-pb">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* heading — left-aligned */}
        <div className="section-head flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 sm:mb-8 reveal">
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs font-semibold mb-3">
              <Icon name="heart-handshake" className="w-3.5 h-3.5" /> {t('home.testimonials.badge')}
            </span>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold">{t('home.testimonials.title')}</h2>
          </div>
          {/* inline stats — pulled right on desktop */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Icon key={i} name="star" className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
              ))}
            </div>
            <span className="text-white font-bold text-sm tabular-nums">{STATS.rating}</span>
            <span className="text-gray-500 text-xs">· {STATS.reviews} {t('home.testimonials.reviews')}</span>
          </div>
        </div>

        {/* stats bar */}
        <div className="reveal glass rounded-2xl p-5 sm:p-6 mb-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <div className="flex items-center justify-center gap-1 mb-1">
              <span className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums">{STATS.rating}</span>
              <Icon name="star" className="w-5 h-5 text-amber-400 fill-amber-400" />
            </div>
            <div className="text-xs text-gray-400">{STATS.reviews} {t('home.testimonials.verifiedReviews')}</div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent mb-1 tabular-nums">{STATS.familiesHoused}</div>
            <div className="text-xs text-gray-400">{t('home.testimonials.familiesHoused')}</div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent mb-1 tabular-nums">{STATS.verifiedOwners}</div>
            <div className="text-xs text-gray-400">{t('home.testimonials.aadhaarVerifiedOwners')}</div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent mb-1">{STATS.brokerage}</div>
            <div className="text-xs text-gray-400">{t('home.testimonials.brokerageEver')}</div>
          </div>
        </div>

        {/* asymmetric quote layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">

          {/* ── Wide featured quote (7/12) ── */}
          <div className="reveal glass rounded-2xl p-7 sm:p-8 md:col-span-7 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-4 right-6 text-[96px] leading-none font-serif text-white/[0.04] select-none pointer-events-none">"</div>
            <div>
              <div className="flex items-center gap-1 mb-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Icon key={i} name="star" className="w-4 h-4 text-amber-400 fill-amber-400" />
                ))}
              </div>
              <p className="text-white text-base sm:text-lg leading-relaxed font-medium mb-6">
                Found a 2BHK in Baner in 3 days without a single broker call. The owner was Aadhaar-verified, so sharing my details felt completely safe. Saved ₹55,000 in brokerage.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-5 border-t border-white/8">
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-pink-500 to-rose-400 flex items-center justify-center text-white text-sm font-bold shrink-0">PD</div>
              <div>
                <p className="text-white text-sm font-semibold">Priya Deshpande</p>
                <p className="text-gray-500 text-xs">Rented in Baner · IT professional</p>
              </div>
              <div className="ml-auto shrink-0">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-semibold">
                  <Icon name="shield-check" className="w-3 h-3" /> {t('home.testimonials.verifiedRenter')}
                </span>
              </div>
            </div>
          </div>

          {/* ── Right column: two stacked cards (5/12) ── */}
          <div className="md:col-span-5 flex flex-col gap-5">

            {/* Quote 2 — slightly taller */}
            <div className="reveal glass rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden" style={{ transitionDelay: '.08s' }}>
              <div className="absolute top-3 right-5 text-[72px] leading-none font-serif text-white/[0.04] select-none pointer-events-none">"</div>
              <div>
                <div className="flex items-center gap-1 mb-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Icon key={i} name="star" className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-gray-300 text-sm leading-relaxed mb-5">
                  The ownership check flagged a disputed property before I paid a token. Draazy's verification is the real deal — it saved me from a huge mistake.
                </p>
              </div>
              <div className="flex items-center gap-3 pt-4 border-t border-white/8">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-400 flex items-center justify-center text-white text-xs font-bold shrink-0">RK</div>
                <div>
                  <p className="text-white text-sm font-semibold">Rohan Kulkarni</p>
                  <p className="text-gray-500 text-xs">Bought in Wakad</p>
                </div>
              </div>
            </div>

            {/* Quote 3 — compact */}
            <div className="reveal glass rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden" style={{ transitionDelay: '.16s' }}>
              <div className="absolute top-3 right-5 text-[72px] leading-none font-serif text-white/[0.04] select-none pointer-events-none">"</div>
              <p className="text-gray-300 text-sm leading-relaxed mb-5">
                The women-only flatmate filter helped me find a great roommate — safely and fast. Would never go back to broker listings.
              </p>
              <div className="flex items-center gap-3 pt-4 border-t border-white/8">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-500 to-emerald-400 flex items-center justify-center text-white text-xs font-bold shrink-0">SS</div>
                <div>
                  <p className="text-white text-sm font-semibold">Sana Shaikh</p>
                  <p className="text-gray-500 text-xs">Flatmate via Flatmates</p>
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
}
