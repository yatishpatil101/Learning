import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from './Icon.jsx';

const SHOWN = 2;

export default function MyPostsStrip({ items, viewAllHref }) {
  const { t } = useTranslation();
  if (!items?.length) return null;
  return (
    <section aria-label={t('common.myPostsAria')} className="mb-4 space-y-2" data-testid="my-posts-strip">
      {items.slice(0, SHOWN).map((it) => (
        <Link key={it.id} to={it.to} className={'my-post-tile flex items-center gap-3 rounded-xl border px-3 py-2.5 t-all ' + (it.pending ? 'border-amber-500/30 bg-amber-500/5' : 'border-teal-500/30 bg-teal-500/5')}>
          <span className={'w-8 h-8 rounded-full shrink-0 inline-flex items-center justify-center ' + (it.pending ? 'bg-amber-500/15 text-amber-300' : 'bg-teal-500/15 text-teal-300')}><Icon name={it.pending ? 'clock' : 'megaphone'} className="w-4 h-4" /></span>
          <span className="min-w-0 flex-1">
            <span className={'block text-[10px] font-semibold uppercase tracking-wider ' + (it.pending ? 'text-amber-300' : 'text-teal-300')}>{it.label}</span>
            <span className="block text-sm text-white font-semibold truncate">{it.title}</span>
            {it.sub && <span className="block text-xs text-gray-400 truncate">{it.sub}</span>}
          </span>
          <Icon name="chevron-right" className="w-4 h-4 text-gray-500 shrink-0" />
        </Link>
      ))}
      {items.length > SHOWN && viewAllHref && (
        <Link to={viewAllHref} className="inline-flex items-center gap-1 min-h-11 px-1 text-xs font-semibold text-teal-300">{t('common.myPostsViewAll', { count: items.length })} <Icon name="arrow-right" className="w-3.5 h-3.5" /></Link>
      )}
    </section>
  );
}
