import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { useHelpPath } from '../../lib/useHelp.js';

/* Small presentational pieces shared across the help centre pages.
   Kept together because each is a handful of lines and they are always used
   in combination. */

export function Breadcrumbs({ trail }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('help.browseByTopic')} className="mb-4">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-gray-500">
        {trail.map(([label, to], i) => (
          <li key={label} className="flex items-center gap-1">
            {i > 0 && <Icon name="chevron-right" className="w-3 h-3 text-gray-700" />}
            {to ? (
              <Link to={to} className="transition-colors hover:text-teal-400">{label}</Link>
            ) : (
              <span className="text-gray-400" aria-current="page">{label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function CategoryCard({ category, count }) {
  const { t } = useTranslation();
  const hp = useHelpPath();
  return (
    <Link
      to={hp(`/help/c/${category.id}`)}
      className="group flex h-full flex-col rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-teal-400/40 hover:bg-white/[0.05]"
    >
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-teal-400/10">
        <Icon name={category.icon} className="w-5 h-5 text-teal-400" />
      </span>
      <h3 className="text-sm font-bold text-white group-hover:text-teal-300">{category.title}</h3>
      <p className="mt-1.5 flex-1 text-xs leading-relaxed text-gray-500">{category.description}</p>
      <span className="mt-3 text-[11px] font-medium text-gray-600">
        {t('help.articleCount', { count })}
      </span>
    </Link>
  );
}

export function ArticleCard({ article, categoryTitle }) {
  const { t } = useTranslation();
  const hp = useHelpPath();
  return (
    <Link
      to={hp(`/help/a/${article.slug}`)}
      className="group flex h-full flex-col rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-teal-400/40 hover:bg-white/[0.05]"
    >
      {categoryTitle && (
        <span className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-teal-400/80">{categoryTitle}</span>
      )}
      <h3 className="text-sm font-bold text-white group-hover:text-teal-300">{article.title}</h3>
      <p className="mt-1.5 flex-1 text-xs leading-relaxed text-gray-500">{article.summary}</p>
      <span className="mt-3 flex items-center gap-1 text-[11px] text-gray-600">
        <Icon name="clock" className="w-3 h-3" /> {t('help.minRead', { count: article.readMinutes })}
      </span>
    </Link>
  );
}

export function ArticleRow({ article }) {
  const hp = useHelpPath();
  return (
    <Link
      to={hp(`/help/a/${article.slug}`)}
      className="group flex items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-white/[0.04]"
    >
      <Icon name="file-text" className="mt-0.5 w-4 h-4 shrink-0 text-gray-600 group-hover:text-teal-400" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-200 group-hover:text-white">{article.title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{article.summary}</span>
      </span>
    </Link>
  );
}

/** Shown when a category, search or filter produces nothing. */
export function EmptyState({ icon = 'search', title, children }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center">
      <Icon name={icon} className="mx-auto mb-3 w-8 h-8 text-gray-700" />
      <p className="text-sm font-semibold text-white">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-gray-500">{children}</div>}
    </div>
  );
}
