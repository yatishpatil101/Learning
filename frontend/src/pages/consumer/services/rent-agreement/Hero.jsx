import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';

export default function Hero() {
  const { t } = useTranslation();
  return (
    <>
      {/* Hero */}
      <section className="hero relative overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%,rgba(255,255,255,.3) 0,transparent 40%),radial-gradient(circle at 80% 70%,rgba(20,184,166,.5) 0,transparent 40%)' }} />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/15 text-teal-200 text-sm font-medium mb-5"><Icon name="file-signature" className="w-4 h-4" /> {t('services.ra.hero.badge')}</div>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-white leading-tight">{t('services.ra.hero.title1')}<br /><span className="gradient-text">{t('services.ra.hero.titleAccent')}</span></h1>
          <p className="text-gray-200 text-base sm:text-lg mt-5 max-w-2xl mx-auto">{t('services.ra.hero.subtitle')}</p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-7 text-sm">
            <span className="px-4 py-2 rounded-full bg-white/10 border border-white/15 text-white flex items-center gap-2"><Icon name="shield-check" className="w-4 h-4 text-teal-300" /> {t('services.ra.hero.chip1')}</span>
            <span className="px-4 py-2 rounded-full bg-white/10 border border-white/15 text-white flex items-center gap-2"><Icon name="badge-indian-rupee" className="w-4 h-4 text-teal-300" /> {t('services.ra.hero.chip2')}</span>
            <span className="px-4 py-2 rounded-full bg-white/10 border border-white/15 text-white flex items-center gap-2"><Icon name="fingerprint" className="w-4 h-4 text-teal-300" /> {t('services.ra.hero.chip3')}</span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 relative z-10">
        <div className="glass-card rounded-2xl p-6 grid grid-cols-1 sm:grid-cols-3 gap-6 reveal">
          <div className="flex items-start gap-3"><div className="w-9 h-9 rounded-xl bg-teal-400/15 flex items-center justify-center flex-shrink-0 font-bold text-teal-400">1</div><div><p className="text-white font-semibold text-sm">{t('services.ra.hero.step1Title')}</p><p className="text-gray-400 text-xs mt-0.5">{t('services.ra.hero.step1Desc')}</p></div></div>
          <div className="flex items-start gap-3"><div className="w-9 h-9 rounded-xl bg-teal-400/15 flex items-center justify-center flex-shrink-0 font-bold text-teal-400">2</div><div><p className="text-white font-semibold text-sm">{t('services.ra.hero.step2Title')}</p><p className="text-gray-400 text-xs mt-0.5">{t('services.ra.hero.step2Desc')}</p></div></div>
          <div className="flex items-start gap-3"><div className="w-9 h-9 rounded-xl bg-emerald-400/15 flex items-center justify-center flex-shrink-0 font-bold text-emerald-400">3</div><div><p className="text-white font-semibold text-sm">{t('services.ra.hero.step3Title')}</p><p className="text-gray-400 text-xs mt-0.5">{t('services.ra.hero.step3Desc')}</p></div></div>
        </div>
      </section>
    </>
  );
}
