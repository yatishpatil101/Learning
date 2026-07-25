import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';

export default function CtaSection({ navigate }) {
  const { t } = useTranslation();
  return (
    <section className="relative section-pb">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="reveal relative rounded-3xl overflow-hidden p-8 sm:p-12 md:p-16" style={{ background: 'linear-gradient(135deg,#0f172a 0%,#134e4a 30%,#115e59 70%,#0d9488 100%)' }}>
          <div className="absolute top-6 right-10 w-28 h-28 rounded-full border border-white/10" style={{ animation: 'ctaFloat1 8s ease-in-out infinite' }} />
          <div className="absolute bottom-8 right-1/4 w-16 h-16 rounded-full bg-white/5" style={{ animation: 'ctaFloat2 6s ease-in-out infinite' }} />
          <div className="absolute top-1/2 left-8 w-10 h-10 rounded-xl bg-white/5 rotate-45" style={{ animation: 'ctaFloat1 10s ease-in-out infinite reverse' }} />
          <div className="absolute bottom-4 left-1/3 w-20 h-20 rounded-full border border-white/5" style={{ animation: 'ctaFloat2 12s ease-in-out infinite' }} />
          <div className="relative z-10 text-center max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 text-sm font-medium text-white/80 mb-6">
              <Icon name="sparkles" className="w-4 h-4 text-[#fdba74]" /> {t('home.cta.badge')}
            </div>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4">{t('home.cta.headingLead')} <span className="text-[#2dd4bf]">{t('home.cta.headingHighlight')}</span></h2>
            <p className="text-gray-300 text-sm sm:text-base mb-8 leading-relaxed">{t('home.cta.body')}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button onClick={() => navigate('/dashboard#owner-hub')} className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-white text-[#0f172a] font-bold text-sm hover:bg-gray-100 transition-all duration-300 hover:scale-105 shadow-2xl shadow-black/20">
                <Icon name="gauge" className="w-5 h-5" /> {t('home.cta.worth')}
              </button>
              <button onClick={() => navigate('/list-property')} className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-white/10 text-white font-semibold text-sm border border-white/20 hover:bg-white/15 transition-all duration-300">
                <Icon name="plus-circle" className="w-5 h-5" /> {t('home.cta.listFree')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
