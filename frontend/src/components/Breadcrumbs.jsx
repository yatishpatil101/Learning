import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from './Icon.jsx';

export default function Breadcrumbs({ trail, className = '' }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('nav.breadcrumb')} className={className}>
      <ol className="no-scrollbar flex items-center gap-1 overflow-x-auto whitespace-nowrap text-xs text-slate-400">
        {trail.map(([label, to, state], i) => (
          <li key={`${i}-${label}`} className="flex shrink-0 items-center gap-1">
            {i > 0 && <Icon name="chevron-right" className="h-3 w-3 text-slate-600" />}
            {i < trail.length - 1 ? (
              <Link to={to} state={state} className="tap-extend relative py-1 hover:text-brand-teal-3">{label}</Link>
            ) : (
              <span className="py-1 text-slate-300" aria-current="page">{label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Home › Services › the named service; `k` is its key in `services.hub.card`. */
export function ServiceBreadcrumbs({ k, className = 'mb-4' }) {
  const { t } = useTranslation();
  return <Breadcrumbs className={className} trail={[[t('nav.home'), '/'], [t('nav.services'), '/services'], [t(`services.hub.card.${k}.name`), null]]} />;
}
