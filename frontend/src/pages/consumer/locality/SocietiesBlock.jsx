import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';

export default function SocietiesBlock({ localSocieties, activeName, activeSlug }) {
  const { t } = useTranslation();
  if (!localSocieties.length) return null;
  return (
    <div className="reveal">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-bold text-white flex items-center gap-2"><Icon name="building-2" className="w-5 h-5 text-teal-400" /> {t('locality.socTitle', { name: activeName })}</h2>
        <Link to={`/societies?loc=${activeSlug}`} className="text-sm font-semibold text-teal-400 hover:text-teal-300 inline-flex items-center gap-1">{t('locality.socViewAll')} <Icon name="arrow-right" className="w-4 h-4" /></Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {localSocieties.map((s) => {
          const verified = s.tier !== 'community' && s.registration && s.conveyance;
          return (
            <Link key={s.id} to={`/society/${s.slug}`} className="glass-card rounded-xl p-3.5 flex items-center gap-3 hover:border-teal-400/30 transition-all group">
              <span className="w-9 h-9 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0"><Icon name="building-2" className="w-4.5 h-4.5 text-teal-300" /></span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-white truncate group-hover:text-teal-300 transition-colors">{s.name}</span>
                <span className="block text-[11px] text-gray-400 truncate">{verified ? `${t('locality.socVerified')} · ` : ''}{s.builder}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
