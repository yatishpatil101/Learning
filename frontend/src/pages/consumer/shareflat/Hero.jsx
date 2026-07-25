import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Button from '../../../components/ui/Button.jsx';

export default function Hero({ openPostModal, user, isVerified, openVerify }) {
  const { t } = useTranslation();
  return (
    <div className="glass rounded-3xl p-4 sm:p-6 mb-4 reveal relative overflow-hidden">
      <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full" style={{ background: 'radial-gradient(circle,rgba(20,184,166,.18),transparent 70%)' }} />
      <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-5">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-500/15 border border-teal-500/25 text-teal-300 text-xs font-semibold mb-2.5"><Icon name="users-round" className="w-3.5 h-3.5" /> {t('shareFlat.heroBadge')}</span>
          <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight">{t('shareFlat.heroTitle')} <span className="gradient-text">{t('shareFlat.heroTitleAccent')}</span></h1>
          <p className="text-gray-400 text-sm sm:text-base mt-1.5 sm:mt-2 leading-relaxed line-clamp-2 sm:line-clamp-none">{t('shareFlat.heroSubtitle')}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2 sm:mt-3 text-xs text-gray-400">
            <span className="flex items-center gap-1.5"><Icon name="shield-check" className="w-4 h-4 text-teal-400" /> {t('shareFlat.heroPillVerified')}</span>
            <span className="flex items-center gap-1.5"><Icon name="venus" className="w-4 h-4 text-pink-400" /> {t('shareFlat.heroPillWomen')}</span>
            <span className="flex items-center gap-1.5"><Icon name="phone-off" className="w-4 h-4 text-gray-400" /> {t('shareFlat.heroPillNoNumber')}</span>
          </div>
        </div>
        <div className="flex flex-row sm:flex-col items-stretch gap-2 flex-shrink-0 w-full sm:w-auto">
          <Button onClick={() => openPostModal()} variant="primary" icon="pen-line" className="flex-1 sm:flex-none">{t('shareFlat.postRequest')}</Button>
          {user && (isVerified
            ? <div className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25"><Icon name="badge-check" className="w-4 h-4" /> {t('shareFlat.verifiedSeeker')}</div>
            : <Button onClick={openVerify} variant="secondary" icon="shield-check" className="flex-1 sm:flex-none">{t('shareFlat.getVerified')}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
