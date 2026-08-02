import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';

export default function FlatmatesSection({ navigate }) {
  const { t } = useTranslation();
  return (
    <section className="relative section-pb">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="reveal relative rounded-3xl overflow-hidden p-8 sm:p-10 md:p-14" style={{ background: 'linear-gradient(135deg,#134e4a 0%,#0f172a 45%,#115e59 100%)' }}>
          <div className="absolute -top-10 -right-8 w-44 h-44 rounded-full" style={{ background: 'radial-gradient(circle,rgba(20,184,166,.25),transparent 70%)' }} />
          <div className="absolute bottom-0 left-1/4 w-32 h-32 rounded-full" style={{ background: 'radial-gradient(circle,rgba(236,72,153,.18),transparent 70%)' }} />
          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-10 items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-teal-200 text-xs font-semibold mb-3 sm:mb-4"><Icon name="users-round" className="w-3.5 h-3.5" /> {t('home.flatmates.badge')}</span>
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold leading-tight mb-3">{t('home.flatmates.headingLead')} <span className="text-[#2dd4bf]">{t('home.flatmates.headingHighlight')}</span></h2>
              <p className="text-gray-300 text-sm sm:text-base leading-relaxed mb-4 sm:mb-6 max-w-xl">{t('home.flatmates.body')}</p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-5 sm:mb-7 text-xs sm:text-sm text-gray-200">
                <span className="flex items-center gap-1.5"><Icon name="shield-check" className="w-4 h-4 text-teal-300" /> {t('home.flatmates.featVerified')}</span>
                <span className="flex items-center gap-1.5"><Icon name="venus" className="w-4 h-4 text-pink-300" /> {t('home.flatmates.featWomen')}</span>
                <span className="flex items-center gap-1.5"><Icon name="phone-off" className="w-4 h-4 text-teal-300" /> {t('home.flatmates.featNoNumber')}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => navigate('/flatmates?view=team-up')} className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-white text-[#134e4a] font-bold text-sm hover:bg-gray-100 transition-all duration-300 hover:scale-105 shadow-2xl shadow-black/20">
                  <Icon name="hand-heart" className="w-5 h-5" /> {t('home.flatmates.ctaFind')}
                </button>
                <button onClick={() => navigate('/flatmates?post=1')} className="inline-flex items-center gap-1.5 px-5 py-3.5 rounded-full border border-white/20 text-white font-semibold text-sm hover:bg-white/10 transition-all duration-300">
                  {t('home.flatmates.ctaPost')} <Icon name="arrow-right" className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="glass rounded-2xl p-6 sm:p-7 border border-white/10" style={{ background: 'rgba(255,255,255,.06)' }}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0d9488] to-[#14b8a6] flex items-center justify-center shadow-lg shadow-teal-500/20"><Icon name="home" className="w-6 h-6 text-white" /></div>
                  <div>
                    <p className="text-xs text-gray-400">2 BHK in Baner</p>
                    <p className="font-bold text-white">₹34,000<span className="text-gray-400 text-xs font-normal">{t('home.flatmates.perMonthWhole')}</span></p>
                  </div>
                </div>
                <Icon name="arrow-right" className="w-5 h-5 text-teal-300" />
                <div className="text-right">
                  <p className="text-xs text-gray-400">{t('home.flatmates.yourShare')}</p>
                  <p className="text-2xl font-extrabold text-[#2dd4bf]">₹17,000<span className="text-gray-400 text-xs font-normal">{t('home.flatmates.perMonth')}</span></p>
                </div>
              </div>
              <div className="h-px bg-white/10 mb-5" />
              <div className="flex items-center">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-rose-400 flex items-center justify-center text-white text-xs font-bold ring-2 ring-[#0f172a]">RI</div>
                <div className="w-10 h-10 -ml-3 rounded-full bg-gradient-to-br from-blue-500 to-indigo-400 flex items-center justify-center text-white text-xs font-bold ring-2 ring-[#0f172a]">SN</div>
                <div className="w-10 h-10 -ml-3 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center text-white text-xs font-bold ring-2 ring-[#0f172a]">AM</div>
                <span className="ml-3 text-sm text-gray-300"><b className="text-white">120+</b> {t('home.flatmates.lookingForFlatmate')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
