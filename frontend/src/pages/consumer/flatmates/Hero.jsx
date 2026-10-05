import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Button from '../../../components/ui/Button.jsx';

const HERO_IMG = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=70&auto=format';

export default function Hero({ user, isVerified, openVerify }) {
  const { t } = useTranslation();
  return (
    <div className="sf-hero rounded-2xl px-4 py-5 sm:p-6 mb-3 sm:mb-4 reveal relative overflow-hidden">
      <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('${HERO_IMG}')` }} />

      <div aria-hidden="true" className="absolute inset-0" style={{ background: 'linear-gradient(90deg,rgba(15,13,26,.94) 0%,rgba(15,13,26,.78) 55%,rgba(15,13,26,.25) 100%)' }} />
      <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-5">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-500/20 text-teal-200 text-xs font-semibold mb-2.5"><Icon name="users-round" className="w-3.5 h-3.5" /> {t('flatmates.heroBadge')}</span>
          <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight">{t('flatmates.heroTitle')} <span className="gradient-text">{t('flatmates.heroTitleAccent')}</span></h1>
          <p className="text-gray-300 text-sm sm:text-base mt-1.5 sm:mt-2 leading-relaxed line-clamp-2 sm:line-clamp-none">{t('flatmates.heroSubtitle')}</p>

          <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 sm:gap-y-1.5 mt-2 sm:mt-3 text-xs text-gray-300">
            <span className="flex items-center gap-1.5"><Icon name="shield-check" className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-teal-400" /> {t('flatmates.heroPillVerified')}</span>
            <span className="flex items-center gap-1.5"><Icon name="venus" className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-pink-400" /> {t('flatmates.heroPillWomen')}</span>
            <span className="flex items-center gap-1.5"><Icon name="phone-off" className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400" /> {t('flatmates.heroPillNoNumber')}</span>
          </div>
        </div>

        {user && (
          <div className="flex flex-row flex-wrap sm:flex-nowrap sm:flex-col items-stretch sm:items-start lg:items-stretch gap-2 flex-shrink-0 w-full sm:w-auto">
            {isVerified
              ? <div className="flex-none inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-emerald-200 bg-emerald-900/70 border border-emerald-400/30"><Icon name="badge-check" className="w-4 h-4" /> {t('flatmates.verifiedSeeker')}</div>
              : <Button onClick={openVerify} variant="primary" icon="shield-check" className="flex-none">{t('flatmates.getVerified')}</Button>
            }
          </div>
        )}
      </div>
    </div>
  );
}
