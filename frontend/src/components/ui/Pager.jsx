import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';

/* Compact page-number model: always the first & last page plus the current one and its
   neighbours, with the rest collapsed to ellipses. */
function pageItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  const items = [1];
  if (start > 2) items.push('…');
  for (let i = start; i <= end; i++) items.push(i);
  if (end < total - 1) items.push('…');
  items.push(total);
  return items;
}

/** Page numbers for a server-paged result set. `page` is ONE-BASED, matching what the control says
    on screen; zero-based callers convert here. Shared by /listings and /flatmates. */
export default function Pager({ page, pageCount, onGoTo }) {
  const { t } = useTranslation();
  if (!(pageCount > 1)) return null;
  return (
    /* A landmark, not a bare `div`: paging is one of the few controls a keyboard user wants to
       reach directly rather than by tabbing past every card above it. */
    <nav className="flex items-center justify-center gap-2 mt-12" aria-label={t('common.pagination')}>
      <button
        onClick={() => onGoTo(page - 1)}
        disabled={page <= 1}
        aria-label={t('common.prevPage')}
        className="page-btn text-gray-500 border border-white/10 hover:border-teal-500/40 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-white/10"
      ><Icon name="chevron-left" className="w-4 h-4" /></button>
      {pageItems(page, pageCount).map((it, i) =>
        it === '…' ? (
          <span key={`gap-${i}`} className="text-gray-600 px-1">…</span>
        ) : (
          <button
            key={it}
            onClick={() => onGoTo(it)}
            aria-label={t('common.pageN', { n: it })}
            aria-current={it === page ? 'page' : undefined}
            className={it === page ? 'page-btn active border border-transparent' : 'page-btn text-gray-400 border border-white/10 hover:border-teal-500/40'}
          >{it}</button>
        ),
      )}
      <button
        onClick={() => onGoTo(page + 1)}
        disabled={page >= pageCount}
        aria-label={t('common.nextPage')}
        className="page-btn text-gray-500 border border-white/10 hover:border-teal-500/40 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-white/10"
      ><Icon name="chevron-right" className="w-4 h-4" /></button>
    </nav>
  );
}
